import { describe, expect, it } from "vitest";
import { seriesStats, type SeriesEdition } from "~/lib/series-stats";

const TZ = "Asia/Tokyo";

let seq = 0;
function edition(
  startAt: string | null,
  applicationDeadline: string | null = null,
  status = "published",
): SeriesEdition {
  return {
    id: `e${++seq}`,
    startAt: startAt ? new Date(startAt) : null,
    applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : null,
    status,
  };
}

describe("seriesStats: count and latest", () => {
  it("counts only published editions", () => {
    const stats = seriesStats(
      [edition("2024-08-10T01:00:00Z"), edition("2025-08-10T01:00:00Z", null, "hidden")],
      TZ,
    );
    expect(stats.count).toBe(1);
  });

  it("picks the newest start date and puts undated editions last", () => {
    const old = edition("2024-08-10T01:00:00Z");
    const recent = edition("2025-08-10T01:00:00Z");
    const undated = edition(null);
    expect(seriesStats([undated, old, recent], TZ).latest).toBe(recent);
    expect(seriesStats([undated], TZ).latest).toBe(undated);
    expect(seriesStats([], TZ).latest).toBeNull();
  });
});

describe("seriesStats: cadence", () => {
  it("detects a yearly series", () => {
    const stats = seriesStats(
      [edition("2023-08-05T01:00:00Z"), edition("2024-08-10T01:00:00Z"), edition("2025-07-20T01:00:00Z")],
      TZ,
    );
    expect(stats.cadence).toBe("yearly");
  });

  it("detects a twice-yearly series", () => {
    const stats = seriesStats(
      [edition("2024-03-20T01:00:00Z"), edition("2024-09-20T01:00:00Z"), edition("2025-03-22T01:00:00Z")],
      TZ,
    );
    expect(stats.cadence).toBe("twice_yearly");
  });

  it("returns null for irregular or single editions", () => {
    expect(
      seriesStats([edition("2024-03-20T01:00:00Z"), edition("2024-12-20T01:00:00Z")], TZ).cadence,
    ).toBeNull();
    expect(
      seriesStats(
        [edition("2023-08-01T01:00:00Z"), edition("2024-08-01T01:00:00Z"), edition("2025-02-01T01:00:00Z")],
        TZ,
      ).cadence,
    ).toBeNull();
    expect(seriesStats([edition("2025-08-10T01:00:00Z")], TZ).cadence).toBeNull();
    expect(seriesStats([edition("2025-08-10T01:00:00Z"), edition(null)], TZ).cadence).toBeNull();
  });
});

describe("seriesStats: typical months", () => {
  it("uses the most frequent month", () => {
    const stats = seriesStats(
      [
        edition("2022-07-20T01:00:00Z", "2022-06-01T01:00:00Z"),
        edition("2023-08-10T01:00:00Z", "2023-06-30T01:00:00Z"),
        edition("2024-08-10T01:00:00Z", "2024-05-31T01:00:00Z"),
      ],
      TZ,
    );
    expect(stats.typicalStartMonth).toBe(8);
    expect(stats.typicalDeadlineMonth).toBe(6);
  });

  it("breaks ties with the most recent edition", () => {
    const stats = seriesStats([edition("2023-07-20T01:00:00Z"), edition("2024-08-10T01:00:00Z")], TZ);
    expect(stats.typicalStartMonth).toBe(8);
    const reversed = seriesStats([edition("2023-08-20T01:00:00Z"), edition("2024-07-10T01:00:00Z")], TZ);
    expect(reversed.typicalStartMonth).toBe(7);
  });

  it("computes months in the given time zone (month-end boundary)", () => {
    // 2025-07-31 23:30 JST is still July.
    expect(seriesStats([edition("2025-07-31T14:30:00Z")], TZ).typicalStartMonth).toBe(7);
    // 2025-08-01 00:30 JST is August in Tokyo but still July in UTC.
    expect(seriesStats([edition("2025-07-31T15:30:00Z")], TZ).typicalStartMonth).toBe(8);
    expect(seriesStats([edition("2025-07-31T15:30:00Z")], "UTC").typicalStartMonth).toBe(7);
  });

  it("is null without dates", () => {
    const stats = seriesStats([edition(null)], TZ);
    expect(stats.typicalStartMonth).toBeNull();
    expect(stats.typicalDeadlineMonth).toBeNull();
  });
});

describe("seriesStats: isRecurringSoon", () => {
  // Yearly: deadline end of June, held in August.
  const history = [
    edition("2024-08-10T01:00:00Z", "2024-06-30T05:00:00Z"),
    edition("2025-08-09T01:00:00Z", "2025-06-30T05:00:00Z"),
  ];
  const stats = seriesStats(history, TZ);

  it("is true from two months before the typical deadline month", () => {
    expect(stats.isRecurringSoon(new Date("2026-04-01T00:00:00+09:00"))).toBe(true);
    expect(stats.isRecurringSoon(new Date("2026-06-30T23:00:00+09:00"))).toBe(true);
  });

  it("is false three months before and after the deadline month", () => {
    expect(stats.isRecurringSoon(new Date("2026-03-31T23:30:00+09:00"))).toBe(false);
    expect(stats.isRecurringSoon(new Date("2026-07-01T00:30:00+09:00"))).toBe(false);
  });

  it("is false once this year's edition has been posted", () => {
    const withNext = seriesStats([...history, edition("2026-08-08T01:00:00Z")], TZ);
    expect(withNext.isRecurringSoon(new Date("2026-05-01T00:00:00+09:00"))).toBe(false);
  });

  it("is false right after an edition was held", () => {
    const justHeld = seriesStats(
      [
        edition("2024-06-20T01:00:00Z", "2024-06-01T01:00:00Z"),
        edition("2025-05-25T01:00:00Z", "2025-06-01T01:00:00Z"),
      ],
      TZ,
    );
    expect(justHeld.isRecurringSoon(new Date("2025-06-10T00:00:00+09:00"))).toBe(false);
  });

  it("needs at least two published editions", () => {
    const single = seriesStats([edition("2025-08-09T01:00:00Z", "2025-06-30T05:00:00Z")], TZ);
    expect(single.isRecurringSoon(new Date("2026-05-01T00:00:00+09:00"))).toBe(false);
    const hidden = seriesStats(
      [history[0], edition("2025-08-09T01:00:00Z", "2025-06-30T05:00:00Z", "hidden")],
      TZ,
    );
    expect(hidden.isRecurringSoon(new Date("2026-05-01T00:00:00+09:00"))).toBe(false);
  });
});
