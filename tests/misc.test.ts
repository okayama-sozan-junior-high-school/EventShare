import { describe, expect, it } from "vitest";
import { validateMedia } from "~/.server/media/validate";
import { canSignUp, isSchoolEmail } from "~/.server/school";
import { isCrossSiteMutation } from "~/.server/security";
import { normalizeUrl, safeExternalUrl } from "~/lib/url";
import { escapeLike, normalizeForMatch } from "~/lib/text";

describe("url helpers", () => {
  it("only allows http(s) links", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("data:text/html,hi")).toBeNull();
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  it("normalizes URLs for comparison", () => {
    expect(normalizeUrl("https://WWW.Example.com/event/?utm_source=x&b=2&a=1#top")).toBe(
      "example.com/event?a=1&b=2",
    );
    expect(normalizeUrl("http://example.com/event")).toBe(normalizeUrl("https://example.com/event/"));
  });
});

describe("text helpers", () => {
  it("normalizes full-width and punctuation", () => {
    expect(normalizeForMatch("ＡＩ ハッカソン！２０２６")).toBe("aiハッカソン2026");
  });

  it("escapes LIKE wildcards", () => {
    expect(escapeLike("100%_\\")).toBe("100\\%\\_\\\\");
  });
});

describe("school email policy", () => {
  it("matches the domain and subdomains", () => {
    expect(isSchoolEmail("a@school.ed.jp", ["school.ed.jp"])).toBe(true);
    expect(isSchoolEmail("a@st.school.ed.jp", ["school.ed.jp"])).toBe(true);
    expect(isSchoolEmail("a@evilschool.ed.jp", ["school.ed.jp"])).toBe(false);
  });

  it("restricts sign-up only in domain mode", () => {
    expect(canSignUp("a@gmail.com", "open", [])).toBe(true);
    expect(canSignUp("a@gmail.com", "domain", ["school.ed.jp"])).toBe(false);
    expect(canSignUp("a@gmail.com", "domain", [])).toBe(false);
  });
});

describe("media validation", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

  it("detects images by magic bytes", () => {
    const r = validateMedia(png, ["image"]);
    expect(r.ok && r.detected.contentType).toBe("image/png");
  });

  it("rejects SVG and unknown content", () => {
    expect(validateMedia(svg, ["image"]).ok).toBe(false);
  });

  it("rejects videos where only images are allowed", () => {
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0]);
    expect(validateMedia(webm, ["image"]).ok).toBe(false);
    expect(validateMedia(webm, ["image", "video"]).ok).toBe(true);
  });

  it("enforces size limits", () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(png);
    expect(validateMedia(big, ["image"]).ok).toBe(false);
  });
});

describe("CSRF origin check", () => {
  const req = (headers: Record<string, string>, method = "POST") =>
    new Request("https://app.example/events/new", { method, headers });

  it("allows same-origin posts", () => {
    expect(isCrossSiteMutation(req({ origin: "https://app.example" }))).toBe(false);
  });

  it("rejects cross-origin posts", () => {
    expect(isCrossSiteMutation(req({ origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSiteMutation(req({ "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("ignores safe methods", () => {
    expect(isCrossSiteMutation(req({ origin: "https://evil.example" }, "GET"))).toBe(false);
  });
});
