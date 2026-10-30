import { describe, expect, it } from "vitest";
import {
  extractEventFromHtml,
  parseJapaneseDate,
} from "~/.server/url-import/extract";
import { isAllowedByRobots } from "~/.server/url-import/robots";

const TZ = "Asia/Tokyo";
const now = new Date("2026-10-30T00:00:00Z");
const pageUrl = new URL("https://example.org/events/ai-camp");

describe("extractEventFromHtml", () => {
  it("prefers schema.org Event JSON-LD", () => {
    const html = `<!doctype html><html><head>
      <title>ページタイトル</title>
      <meta property="og:title" content="OGタイトル">
      <meta property="og:image" content="/img/cover.png">
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "EducationEvent",
        name: "中高生のためのAIキャンプ &amp; 発表会",
        description: "AIを使って作品を作る2日間のキャンプです。",
        startDate: "2026-12-12T10:00:00+09:00",
        endDate: "2026-12-13T17:00",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: {
          "@type": "Place",
          name: "岡山イノベーションセンター",
          address: { addressRegion: "岡山県", addressLocality: "岡山市" },
        },
        organizer: { "@type": "Organization", name: "AI教育協会" },
        offers: { price: "0", priceCurrency: "JPY", url: "https://forms.example.org/apply" },
      })}</script></head><body></body></html>`;

    const { draft, sources } = extractEventFromHtml(html, pageUrl, { timeZone: TZ, now });
    expect(draft.title).toBe("中高生のためのAIキャンプ & 発表会");
    expect(draft.startAt?.toISOString()).toBe("2026-12-12T01:00:00.000Z");
    expect(draft.endAt?.toISOString()).toBe("2026-12-13T08:00:00.000Z");
    expect(draft.format).toBe("offline");
    expect(draft.location).toBe("岡山イノベーションセンター 岡山県 岡山市");
    expect(draft.organizer).toBe("AI教育協会");
    expect(draft.feeType).toBe("free");
    expect(draft.applicationUrl).toBe("https://forms.example.org/apply");
    expect(draft.imageUrl).toBe("https://example.org/img/cover.png");
    expect(draft.officialUrl).toBe(pageUrl.toString());
    expect(sources.title).toBe("structured");
    expect(sources.imageUrl).toBe("meta");
  });

  it("falls back to OGP and labeled text", () => {
    const html = `<html><head>
      <meta property="og:title" content="プログラミング勉強会 vol.5">
      <meta name="description" content="初心者向けのPython勉強会です。">
      </head><body>
      <h2>開催概要</h2>
      <dl><dt>日時：</dt><dd>2026年11月21日(土) 13:30〜16:00</dd></dl>
      <p>会場：岡山市立中央図書館 3F 会議室</p>
      <p>主催：岡山Python会</p>
      <p>対象：中学生・高校生</p>
      <p>参加費：無料</p>
      <p>申込締切：11月14日</p>
      <script>var ignored = "締切：1月1日";</script>
      </body></html>`;
    const { draft, sources } = extractEventFromHtml(html, pageUrl, { timeZone: TZ, now });
    expect(draft.title).toBe("プログラミング勉強会 vol.5");
    expect(draft.description).toBe("初心者向けのPython勉強会です。");
    expect(draft.startAt?.toISOString()).toBe("2026-11-21T04:30:00.000Z");
    expect(draft.location).toBe("岡山市立中央図書館 3F 会議室");
    expect(draft.organizer).toBe("岡山Python会");
    expect(draft.targetAudience).toBe("中学生・高校生");
    expect(draft.feeType).toBe("free");
    expect(draft.applicationDeadline?.toISOString()).toBe("2026-11-14T14:59:00.000Z");
    expect(sources.startAt).toBe("text");
  });

  it("leaves unknown fields empty instead of guessing", () => {
    const html = `<html><head><title>お知らせ</title></head><body><p>近日公開</p></body></html>`;
    const { draft } = extractEventFromHtml(html, pageUrl, { timeZone: TZ, now });
    expect(draft.title).toBe("お知らせ");
    expect(draft.startAt).toBeNull();
    expect(draft.location).toBeNull();
    expect(draft.feeType).toBeNull();
  });
});

describe("parseJapaneseDate", () => {
  it("rolls the year forward for month/day without a year", () => {
    const d = parseJapaneseDate("1月10日", { timeZone: TZ, reference: now });
    expect(d?.toISOString()).toBe("2027-01-09T15:00:00.000Z");
  });

  it("parses full-width digits", () => {
    const d = parseJapaneseDate("２０２６年１２月１日 １０:００", { timeZone: TZ, reference: now });
    expect(d?.toISOString()).toBe("2026-12-01T01:00:00.000Z");
  });
});

describe("isAllowedByRobots", () => {
  const robots = `
User-agent: *
Disallow: /private/
Allow: /private/public-events

User-agent: BadBot
Disallow: /
`;
  it("applies the wildcard group", () => {
    expect(isAllowedByRobots(robots, "/events/1")).toBe(true);
    expect(isAllowedByRobots(robots, "/private/x")).toBe(false);
    expect(isAllowedByRobots(robots, "/private/public-events")).toBe(true);
  });

  it("applies a group targeting our bot", () => {
    expect(isAllowedByRobots("User-agent: EventShareBot\nDisallow: /", "/a")).toBe(false);
  });
});
