import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUPLICATE_CONFIG,
  scoreDuplicate,
  type DuplicateComparable,
} from "~/.server/duplicates/score";

const base: DuplicateComparable = {
  title: "高校生AIハッカソン 2026",
  description: "高校生がチームでAIを使ったアプリを開発するハッカソンです。",
  startAt: new Date("2026-12-05T01:00:00Z"),
  organizer: "未来テック財団",
  location: "岡山県立図書館",
  format: "offline",
  officialUrl: "https://example.org/hackathon2026",
};

describe("scoreDuplicate", () => {
  it("scores identical events as high", () => {
    const r = scoreDuplicate(base, { ...base });
    expect(r.score).toBe(100);
    expect(r.level).toBe("high");
    expect(r.urlMatch).toBe(true);
  });

  it("tolerates full-width / spacing differences in the title", () => {
    const r = scoreDuplicate(base, {
      ...base,
      title: "高校生ＡＩハッカソン２０２６",
      officialUrl: null,
    });
    expect(r.breakdown.title).toBe(40);
    expect(r.level).toBe("high");
  });

  it("needs review when only some fields match", () => {
    const r = scoreDuplicate(base, {
      title: "高校生AIハッカソン 2026 本選",
      startAt: new Date("2026-12-05T05:00:00Z"),
      organizer: null,
      location: null,
      description: null,
      officialUrl: null,
    });
    expect(r.level).toBe("review");
    expect(r.score).toBeGreaterThanOrEqual(55);
    expect(r.score).toBeLessThan(80);
  });

  it("treats the same name in a different year as another edition", () => {
    const r = scoreDuplicate(base, {
      ...base,
      title: "高校生AIハッカソン 2027",
      startAt: new Date("2027-12-04T01:00:00Z"),
    });
    expect(r.differentEdition).toBe(true);
    expect(r.level).toBe("low");
  });

  it("treats far-apart dates as another edition even with the same URL", () => {
    const r = scoreDuplicate(
      { ...base, title: "高校生AIハッカソン" },
      { ...base, title: "高校生AIハッカソン", startAt: new Date("2027-06-01T01:00:00Z") },
    );
    expect(r.urlMatch).toBe(true);
    expect(r.differentEdition).toBe(true);
    expect(r.level).not.toBe("high");
  });

  it("does not treat a URL match alone as a duplicate", () => {
    const r = scoreDuplicate(base, {
      title: "全く別の説明会",
      startAt: null,
      officialUrl: "https://www.example.org/hackathon2026/?utm_source=x",
    });
    expect(r.urlMatch).toBe(true);
    expect(r.level).toBe("low");
  });

  it("is low for unrelated events", () => {
    const r = scoreDuplicate(base, {
      title: "地域清掃ボランティア",
      startAt: new Date("2026-08-01T00:00:00Z"),
      organizer: "市役所",
      location: "駅前広場",
      description: "地域をきれいにしましょう",
    });
    expect(r.level).toBe("low");
    expect(r.score).toBeLessThan(30);
  });

  it("respects custom weights and thresholds", () => {
    const config = {
      ...DEFAULT_DUPLICATE_CONFIG,
      weights: { title: 100, date: 0, organizer: 0, location: 0, description: 0 },
      thresholds: { high: 95, review: 50 },
    };
    const r = scoreDuplicate(base, { title: base.title }, config);
    expect(r.score).toBe(100);
    expect(r.level).toBe("high");
  });
});
