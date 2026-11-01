import { describe, expect, it } from "vitest";
import {
  classifySeriesCandidates,
  seriesMatchKey,
  type SeriesCandidateInput,
  type SeriesCandidateRow,
} from "~/.server/series/classify";
import { diceSimilarity, normalizeForMatch } from "~/lib/text";

function row(
  partial: Partial<SeriesCandidateRow> & Pick<SeriesCandidateRow, "seriesId" | "eventTitle">,
): SeriesCandidateRow {
  return {
    seriesTitle: partial.seriesTitle ?? partial.eventTitle,
    matchKey: partial.matchKey ?? seriesMatchKey(partial.eventTitle),
    eventId: partial.eventId ?? `${partial.seriesId}-e`,
    normalizedTitle: partial.normalizedTitle ?? normalizeForMatch(partial.eventTitle),
    organizer: partial.organizer ?? null,
    officialUrl: partial.officialUrl ?? null,
    seriesId: partial.seriesId,
    eventTitle: partial.eventTitle,
  };
}

const hackathon = (year: string) => `高校生AIハッカソン ${year}`;

describe("classifySeriesCandidates", () => {
  it("treats the same match key and organizer as a strong candidate", () => {
    const input: SeriesCandidateInput = {
      title: hackathon("2026"),
      organizer: "未来テック財団",
    };
    const result = classifySeriesCandidates(input, [
      row({
        seriesId: "s1",
        eventTitle: hackathon("2025"),
        organizer: "未来テック財団",
      }),
    ]);
    expect(seriesMatchKey(input.title)).toBe(seriesMatchKey(hackathon("2025")));
    expect(result.strong?.seriesId).toBe("s1");
    expect(result.weak).toEqual([]);
  });

  it("treats the same match key and URL host as a strong candidate", () => {
    const result = classifySeriesCandidates(
      {
        title: hackathon("2026"),
        organizer: "別の団体",
        sourceUrl: "https://www.example.org/hackathon/2026",
      },
      [
        row({
          seriesId: "s1",
          eventTitle: hackathon("2025"),
          organizer: "未来テック財団",
          officialUrl: "https://example.org/hackathon/2025",
        }),
      ],
    );
    expect(result.strong?.seriesId).toBe("s1");
    expect(result.weak).toEqual([]);
  });

  it("keeps the same match key with a different organizer as a weak candidate", () => {
    const result = classifySeriesCandidates(
      { title: hackathon("2026"), organizer: "A団体" },
      [row({ seriesId: "s1", eventTitle: hackathon("2025"), organizer: "B団体" })],
    );
    expect(result.strong).toBeNull();
    expect(result.weak.map((c) => c.seriesId)).toEqual(["s1"]);
  });

  it("does not treat two empty organizers as a match", () => {
    const result = classifySeriesCandidates(
      { title: hackathon("2026"), organizer: "  " },
      [row({ seriesId: "s1", eventTitle: hackathon("2025"), organizer: "" })],
    );
    expect(result.strong).toBeNull();
    expect(result.weak).toHaveLength(1);
  });

  it("finds a backfilled series whose match_key still includes the year", () => {
    const oldTitle = hackathon("2025");
    const result = classifySeriesCandidates(
      { title: hackathon("2026"), organizer: "未来テック財団" },
      [
        row({
          seriesId: "backfill",
          seriesTitle: oldTitle,
          eventTitle: oldTitle,
          matchKey: normalizeForMatch(oldTitle),
          normalizedTitle: normalizeForMatch(oldTitle),
          organizer: "未来テック財団",
        }),
      ],
    );
    expect(seriesMatchKey(oldTitle)).not.toBe(normalizeForMatch(oldTitle));
    expect(result.strong?.seriesId).toBe("backfill");
  });

  it("classifies a Dice score around 0.85 as weak", () => {
    const input = { title: "数学オリンピック", organizer: "数学協会" };
    const rows = [
      row({ seriesId: "s1", eventTitle: "数学オリンピック本選", organizer: "数学協会" }),
    ];
    const dice = diceSimilarity(seriesMatchKey(input.title), seriesMatchKey(rows[0].eventTitle));
    expect(dice).toBeGreaterThanOrEqual(0.8);
    expect(dice).toBeLessThan(0.95);
    const result = classifySeriesCandidates(input, rows);
    expect(result.strong).toBeNull();
    expect(result.weak.map((c) => c.seriesId)).toEqual(["s1"]);
  });

  it("includes a Dice score of 0.8 as weak", () => {
    const input = { title: "中高生探究発表会" };
    const rows = [row({ seriesId: "s1", eventTitle: "中高生探究発表大会" })];
    expect(diceSimilarity(seriesMatchKey(input.title), seriesMatchKey(rows[0].eventTitle))).toBeCloseTo(0.8, 5);
    const result = classifySeriesCandidates(input, rows);
    expect(result.strong).toBeNull();
    expect(result.weak).toHaveLength(1);
  });

  it("drops a Dice score around 0.7", () => {
    const input = { title: "地域探究フェスティバル", organizer: "実行委員会" };
    const rows = [row({ seriesId: "s1", eventTitle: "地域探究フェスタ", organizer: "実行委員会" })];
    const dice = diceSimilarity(seriesMatchKey(input.title), seriesMatchKey(rows[0].eventTitle));
    expect(dice).toBeLessThan(0.8);
    expect(dice).toBeGreaterThan(0.6);
    const result = classifySeriesCandidates(input, rows);
    expect(result.strong).toBeNull();
    expect(result.weak).toEqual([]);
  });

  it("does not suggest a different event held in the same year", () => {
    const result = classifySeriesCandidates(
      { title: "文化祭 2026", organizer: "生徒会" },
      [row({ seriesId: "s1", eventTitle: "体育祭 2026", organizer: "生徒会" })],
    );
    expect(result.strong).toBeNull();
    expect(result.weak).toEqual([]);
  });

  it("excludes the event itself", () => {
    const result = classifySeriesCandidates(
      { title: hackathon("2026"), organizer: "未来テック財団", excludeEventId: "self" },
      [
        row({
          seriesId: "s1",
          eventId: "self",
          eventTitle: hackathon("2026"),
          organizer: "未来テック財団",
        }),
      ],
    );
    expect(result.strong).toBeNull();
    expect(result.weak).toEqual([]);
  });

  it("still matches a series when another edition remains after excluding the event", () => {
    const result = classifySeriesCandidates(
      { title: hackathon("2026"), organizer: "未来テック財団", excludeEventId: "self" },
      [
        row({
          seriesId: "s1",
          eventId: "self",
          eventTitle: hackathon("2024"),
          organizer: "無関係",
        }),
        row({
          seriesId: "s1",
          eventId: "other",
          eventTitle: hackathon("2025"),
          organizer: "未来テック財団",
        }),
      ],
    );
    expect(result.strong?.seriesId).toBe("s1");
    expect(result.strong?.eventId).toBe("other");
    expect(result.weak).toEqual([]);
  });

  it("returns at most three weak candidates and omits the strong one", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id, i) =>
      row({
        seriesId: id,
        eventTitle: hackathon("2025"),
        organizer: `団体${i}`,
      }),
    );
    const result = classifySeriesCandidates(
      { title: hackathon("2026"), organizer: "団体0" },
      rows,
    );
    expect(result.strong?.seriesId).toBe("a");
    expect(result.weak.map((c) => c.seriesId)).toEqual(["b", "c", "d"]);
  });
});
