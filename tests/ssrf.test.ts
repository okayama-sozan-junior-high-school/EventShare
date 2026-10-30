import { describe, expect, it, vi } from "vitest";
import { safeFetch } from "~/.server/url-import/fetcher";
import {
  checkResolvedHost,
  checkUrl,
  isPrivateAddress,
} from "~/.server/url-import/ssrf";

describe("checkUrl", () => {
  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://intranet/",
    "http://printer.local/",
    "http://metadata.google.internal/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "https://example.com:8080/",
    "https://8.8.8.8/",
  ])("rejects %s", (url) => {
    expect(checkUrl(url).ok).toBe(false);
  });

  it.each(["https://example.com/events/1", "http://www.example.jp/", "https://example.com:443/"])(
    "accepts %s",
    (url) => {
      expect(checkUrl(url).ok).toBe(true);
    },
  );
});

describe("isPrivateAddress", () => {
  it.each([
    "10.0.0.1",
    "172.16.5.4",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
  ])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["93.184.216.34", "2606:4700::1111", "::ffff:8.8.8.8"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("checkResolvedHost", () => {
  it("rejects hosts that resolve to private addresses (DNS rebinding)", async () => {
    const r = await checkResolvedHost("evil.example", async () => ["93.184.216.34", "10.0.0.5"]);
    expect(r.ok).toBe(false);
  });

  it("rejects unresolvable hosts", async () => {
    const r = await checkResolvedHost("nx.example", async () => []);
    expect(r.ok).toBe(false);
  });
});

describe("safeFetch", () => {
  const publicResolver = async () => ["93.184.216.34"];
  const html = { accept: "text/html", allowedTypes: /text\/html/, maxBytes: 1000 };

  it("re-validates redirect targets", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
    );
    await expect(
      safeFetch("https://example.com/", { ...html, resolver: publicResolver, fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces the size limit while streaming", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("x".repeat(5000), { headers: { "content-type": "text/html" } }),
    );
    await expect(
      safeFetch("https://example.com/", { ...html, resolver: publicResolver, fetchImpl }),
    ).rejects.toThrow("大きすぎます");
  });

  it("rejects unexpected content types", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", { headers: { "content-type": "application/json" } }),
    );
    await expect(
      safeFetch("https://example.com/", { ...html, resolver: publicResolver, fetchImpl }),
    ).rejects.toThrow();
  });

  it("returns the body for allowed pages", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    const res = await safeFetch("https://example.com/", {
      ...html,
      resolver: publicResolver,
      fetchImpl,
    });
    expect(new TextDecoder().decode(res.bytes)).toBe("<html></html>");
  });
});
