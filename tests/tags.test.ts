import { describe, expect, it } from "vitest";
import { eventInputSchema } from "~/.server/validation/event";
import {
  groupBySeries,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_EVENT,
  mergeTagNames,
  normalizeTagName,
  parseTagInput,
  TAG_FACETS,
  tagListError,
} from "~/lib/tags";

describe("normalizeTagName", () => {
  it("drops a leading # or ＃", () => {
    expect(normalizeTagName("#初心者歓迎")).toBe("初心者歓迎");
    expect(normalizeTagName("＃初心者歓迎")).toBe("初心者歓迎");
    expect(normalizeTagName("  #夏休み ")).toBe("夏休み");
  });

  it("folds full-width characters and lower-cases letters", () => {
    expect(normalizeTagName("中学生ＯＫ")).toBe("中学生ok");
    expect(normalizeTagName("Python")).toBe("python");
    expect(normalizeTagName("１日完結")).toBe("1日完結");
  });

  it("keeps symbols", () => {
    expect(normalizeTagName("C++")).toBe("c++");
    expect(normalizeTagName("C#")).toBe("c#");
    expect(normalizeTagName("C++")).not.toBe(normalizeTagName("C"));
    expect(normalizeTagName("合宿・宿泊あり")).toBe("合宿・宿泊あり");
  });

  it("trims and collapses whitespace", () => {
    expect(normalizeTagName("  Game   Jam  ")).toBe("game jam");
    expect(normalizeTagName("Game\u3000Jam")).toBe("game jam");
  });

  it("exposes limits and facet labels", () => {
    expect(MAX_TAGS_PER_EVENT).toBe(8);
    expect(MAX_TAG_LENGTH).toBe(20);
    expect(Object.keys(TAG_FACETS)).toEqual(["audience", "participation", "schedule", "outcome", "other"]);
  });
});

describe("parseTagInput", () => {
  it("dedupes after normalization", () => {
    expect(parseTagInput("#Python, python、PYTHON")).toEqual(["python"]);
    expect(parseTagInput(["＃夏休み", "夏休み"])).toEqual(["夏休み"]);
    expect(parseTagInput("中学生ＯＫ")).toEqual(["中学生ok"]);
  });

  it("drops empty tokens", () => {
    expect(parseTagInput("、 ,  #  ")).toEqual([]);
    expect(parseTagInput(["", "  #", "夏休み"])).toEqual(["夏休み"]);
    expect(parseTagInput(null)).toEqual([]);
  });

  it("splits on comma, ideographic comma, and whitespace", () => {
    expect(parseTagInput("初心者歓迎、夏休み チームで参加")).toEqual([
      "初心者歓迎",
      "夏休み",
      "チームで参加",
    ]);
  });

  it("keeps every name when there are more than 8 (the error is separate)", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `tag${i}`);
    expect(parseTagInput(nine)).toEqual(nine);
    expect(tagListError(nine)).toBe("タグは8個までです");
  });
});

describe("tagListError", () => {
  it("rejects a tag outside 1..20 characters", () => {
    expect(tagListError(["あ".repeat(21)])).toBe("タグは1〜20文字で入力してください");
    expect(tagListError([""])).toBe("タグは1〜20文字で入力してください");
  });

  it("accepts eight tags of 20 characters and an empty list", () => {
    expect(tagListError(Array.from({ length: 8 }, () => "あ".repeat(20)))).toBeNull();
    expect(tagListError([])).toBeNull();
    expect(tagListError(["あ"])).toBeNull();
  });
});

describe("mergeTagNames", () => {
  it("replace drops tags the form no longer sends", () => {
    expect(mergeTagNames(["夏休み", "初心者歓迎"], ["初心者歓迎"], "replace")).toEqual(["初心者歓迎"]);
  });

  it("add keeps existing tags and dedupes the new ones", () => {
    expect(mergeTagNames(["夏休み"], ["#夏休み", "初心者歓迎"], "add")).toEqual([
      "夏休み",
      "初心者歓迎",
    ]);
    expect(mergeTagNames(["夏休み"], [], "add")).toEqual(["夏休み"]);
  });

  it("can grow past 8 so the caller returns an error instead of truncating", () => {
    const current = Array.from({ length: 8 }, (_, i) => `a${i}`);
    const merged = mergeTagNames(current, ["extra"], "add");
    expect(merged).toHaveLength(9);
    expect(tagListError(merged)).toBe("タグは8個までです");
  });
});

describe("groupBySeries", () => {
  const at = (iso: string) => new Date(iso);

  it("keeps the latest edition and counts the rest", () => {
    const rows = [
      { id: "old", seriesId: "s", startAt: at("2020-01-01T00:00:00Z"), title: "old" },
      { id: "new", seriesId: "s", startAt: at("2024-06-01T00:00:00Z"), title: "new" },
      { id: "solo", seriesId: "t", startAt: at("2023-01-01T00:00:00Z"), title: "solo" },
    ];
    expect(groupBySeries(rows)).toEqual([
      { item: rows[1], count: 2 },
      { item: rows[2], count: 1 },
    ]);
  });

  it("does not merge rows that have no series", () => {
    const rows = [
      { id: "a", seriesId: null, startAt: at("2024-01-01T00:00:00Z") },
      { id: "b", seriesId: null, startAt: at("2024-02-01T00:00:00Z") },
    ];
    const grouped = groupBySeries(rows);
    expect(grouped.map((group) => group.item.id)).toEqual(["b", "a"]);
    expect(grouped.every((group) => group.count === 1)).toBe(true);
  });

  it("treats a missing start as older than a real date", () => {
    const rows = [
      { id: "nodate", seriesId: "s", startAt: null },
      { id: "dated", seriesId: "s", startAt: at("2024-01-01T00:00:00Z") },
    ];
    const [group] = groupBySeries(rows);
    expect(group?.item.id).toBe("dated");
    expect(group?.count).toBe(2);
  });
});

describe("event form tags", () => {
  const schema = eventInputSchema("Asia/Tokyo");
  const base = { title: "テストイベント", categoryIds: [1] };

  it("normalizes a separated string and repeated fields", () => {
    expect(schema.parse({ ...base, tags: "Python, python、夏休み" }).tags).toEqual([
      "python",
      "夏休み",
    ]);
    expect(schema.parse({ ...base, tags: ["#夏休み", "初心者歓迎"] }).tags).toEqual([
      "夏休み",
      "初心者歓迎",
    ]);
  });

  it("defaults to an empty list and errors past the limit", () => {
    expect(schema.parse(base).tags).toEqual([]);
    const parsed = schema.safeParse({
      ...base,
      tags: Array.from({ length: 9 }, (_, i) => `tag${i}`),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe("タグは8個までです");
  });
});
