import { describe, expect, it } from "vitest";
import {
  daysUntil,
  formatDateTime,
  formatRange,
  toDateTimeLocalValue,
  zonedLocalToDate,
} from "~/lib/datetime";
import { getEventPhase } from "~/lib/event-phase";

const TZ = "Asia/Tokyo";

describe("zonedLocalToDate", () => {
  it("interprets datetime-local input as Japan time", () => {
    expect(zonedLocalToDate("2026-11-03T13:00", TZ)?.toISOString()).toBe(
      "2026-11-03T04:00:00.000Z",
    );
  });

  it("accepts date-only values (midnight)", () => {
    expect(zonedLocalToDate("2026-01-01", TZ)?.toISOString()).toBe(
      "2025-12-31T15:00:00.000Z",
    );
  });

  it("handles DST zones", () => {
    expect(zonedLocalToDate("2026-07-01T09:00", "America/New_York")?.toISOString()).toBe(
      "2026-07-01T13:00:00.000Z",
    );
  });

  it("rejects invalid dates", () => {
    expect(zonedLocalToDate("2026-02-30T10:00", TZ)).toBeNull();
    expect(zonedLocalToDate("not a date", TZ)).toBeNull();
  });

  it("round-trips through toDateTimeLocalValue", () => {
    const d = zonedLocalToDate("2026-11-03T13:05", TZ)!;
    expect(toDateTimeLocalValue(d, TZ)).toBe("2026-11-03T13:05");
  });
});

describe("formatting", () => {
  it("formats with weekday in the app time zone", () => {
    expect(formatDateTime(new Date("2026-11-03T04:00:00Z"), TZ)).toBe(
      "2026年11月3日(火) 13:00",
    );
  });

  it("collapses same-day ranges", () => {
    expect(
      formatRange(new Date("2026-11-03T04:00:00Z"), new Date("2026-11-03T08:30:00Z"), TZ),
    ).toBe("2026年11月3日(火) 13:00 〜 17:30");
  });

  it("counts calendar days in the app time zone", () => {
    const now = new Date("2026-11-03T14:59:00Z"); // 23:59 JST
    expect(daysUntil(new Date("2026-11-03T15:00:00Z"), now, TZ)).toBe(1);
  });
});

describe("getEventPhase", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const at = (iso: string) => new Date(iso);

  it("is open when the deadline is far away", () => {
    expect(
      getEventPhase(
        { startAt: at("2026-12-01T00:00:00Z"), endAt: null, applicationDeadline: at("2026-11-30T00:00:00Z") },
        now,
      ),
    ).toBe("open");
  });

  it("is closing within 3 days of the deadline", () => {
    expect(
      getEventPhase(
        { startAt: at("2026-12-01T00:00:00Z"), endAt: null, applicationDeadline: at("2026-11-12T00:00:00Z") },
        now,
      ),
    ).toBe("closing");
  });

  it("is closed after the deadline but before the event", () => {
    expect(
      getEventPhase(
        { startAt: at("2026-12-01T00:00:00Z"), endAt: null, applicationDeadline: at("2026-11-09T00:00:00Z") },
        now,
      ),
    ).toBe("closed");
  });

  it("is ended after the event", () => {
    expect(
      getEventPhase({ startAt: at("2026-11-01T00:00:00Z"), endAt: null, applicationDeadline: null }, now),
    ).toBe("ended");
  });

  it("is ongoing during the event", () => {
    expect(
      getEventPhase(
        { startAt: at("2026-11-09T00:00:00Z"), endAt: at("2026-11-11T00:00:00Z"), applicationDeadline: null },
        now,
      ),
    ).toBe("ongoing");
  });

  it("is unknown without dates", () => {
    expect(getEventPhase({ startAt: null, endAt: null, applicationDeadline: null }, now)).toBe(
      "unknown",
    );
  });
});
