import { describe, expect, it } from "vitest";
import { endorsementSchema } from "~/.server/validation/endorsement";
import {
  canEndorse,
  pickRecurringSoon,
  type RecurringSoonEdition,
} from "~/lib/endorsement";
import type { EventPhase } from "~/lib/event-phase";
import { seriesStats } from "~/lib/series-stats";

const TZ = "Asia/Tokyo";

describe("canEndorse", () => {
  it("allows an ended event without participation", () => {
    expect(canEndorse("ended", false)).toBe(true);
    expect(canEndorse("ended", true)).toBe(true);
  });

  it("allows an upcoming event when the user has participated", () => {
    const upcoming: EventPhase[] = ["open", "closing", "closed", "ongoing", "unknown"];
    for (const phase of upcoming) {
      expect(canEndorse(phase, true)).toBe(true);
    }
  });

  it("rejects an upcoming event without participation", () => {
    const upcoming: EventPhase[] = ["open", "closing", "closed", "ongoing", "unknown"];
    for (const phase of upcoming) {
      expect(canEndorse(phase, false)).toBe(false);
    }
  });

  // EventPhase has no "cancelled" value. Cancellation is not a phase, so there
  // is no canEndorse case for it.
});

describe("endorsement comment", () => {
  function parse(comment: string) {
    return endorsementSchema.safeParse({
      audience: "beginner_ok",
      comment,
      activityReportId: "",
    });
  }

  it("accepts 200 characters after trim", () => {
    expect(parse("あ".repeat(200)).success).toBe(true);
    expect(parse(`  ${"あ".repeat(200)}  `).success).toBe(true);
  });

  it("rejects 201 characters", () => {
    expect(parse("あ".repeat(201)).success).toBe(false);
  });

  it("rejects whitespace only", () => {
    expect(parse("   \n\t  ").success).toBe(false);
  });
});

let seq = 0;
function edition(
  startAt: string | null,
  applicationDeadline: string | null = null,
  status = "published",
  endAt: string | null = null,
): RecurringSoonEdition {
  return {
    id: `e${++seq}`,
    startAt: startAt ? new Date(startAt) : null,
    endAt: endAt ? new Date(endAt) : null,
    applicationDeadline: applicationDeadline ? new Date(applicationDeadline) : null,
    status,
  };
}

describe("pickRecurringSoon", () => {
  const now = new Date("2026-04-01T00:00:00+09:00");
  // Yearly, deadline in June, last held August 2025 — ended by April 2026.
  const ready = [
    edition("2024-08-10T01:00:00Z", "2024-06-30T05:00:00Z"),
    edition("2025-08-09T01:00:00Z", "2025-06-30T05:00:00Z"),
  ];

  it("keeps a series with 2+ editions whose latest has ended and is recurring soon", () => {
    const picked = pickRecurringSoon(
      [
        { id: "later", editions: ready },
        { id: "single", editions: [ready[0]!] },
      ],
      now,
      TZ,
    );
    expect(picked.map((series) => series.id)).toEqual(["later"]);
  });

  it("rejects a single published edition", () => {
    const hiddenSecond = edition("2025-08-09T01:00:00Z", "2025-06-30T05:00:00Z", "hidden");
    expect(pickRecurringSoon([{ id: "one", editions: [ready[0]!] }], now, TZ)).toEqual([]);
    expect(
      pickRecurringSoon([{ id: "hidden", editions: [ready[0]!, hiddenSecond] }], now, TZ),
    ).toEqual([]);
  });

  it("rejects a series that is not in the recurring-soon window", () => {
    const tooEarly = new Date("2026-03-31T23:30:00+09:00");
    expect(pickRecurringSoon([{ id: "early", editions: ready }], tooEarly, TZ)).toEqual([]);
  });

  it("rejects a series whose latest edition has not ended", () => {
    // December 2025–June 2026 is still ongoing in April 2026, and that start
    // sits outside the 2-month / 10-month window, so isRecurringSoon stays true.
    const ongoing = edition("2025-12-01T01:00:00Z", "2025-06-30T05:00:00Z", "published", "2026-06-01T01:00:00Z");
    const editions = [
      edition("2023-08-10T01:00:00Z", "2023-06-30T05:00:00Z"),
      edition("2024-08-10T01:00:00Z", "2024-06-30T05:00:00Z"),
      ongoing,
    ];
    expect(seriesStats(editions, TZ).isRecurringSoon(now)).toBe(true);
    expect(pickRecurringSoon([{ id: "ongoing", editions }], now, TZ)).toEqual([]);
  });
});
