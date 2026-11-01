import { describe, expect, it } from "vitest";
import { MAX_TAG_LENGTH, MAX_TAGS_PER_EVENT, normalizeTagName, TAG_FACETS } from "~/lib/tags";

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
