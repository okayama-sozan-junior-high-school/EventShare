import { describe, expect, it } from "vitest";
import { editionLabelFrom, stripEditionMarkers, suggestNextTitle } from "~/lib/edition";

describe("stripEditionMarkers", () => {
  it("removes western years in their common forms", () => {
    expect(stripEditionMarkers("高校生AIハッカソン 2025")).toBe("高校生AIハッカソン");
    expect(stripEditionMarkers("高校生AIハッカソン2025")).toBe("高校生AIハッカソン");
    expect(stripEditionMarkers("2025年 夏の科学教室")).toBe("夏の科学教室");
    expect(stripEditionMarkers("探究発表会 2025年度")).toBe("探究発表会");
    expect(stripEditionMarkers("ISUCON'25")).toBe("ISUCON");
    expect(stripEditionMarkers("FY2025 探究発表会")).toBe("探究発表会");
    expect(stripEditionMarkers("令和7年度 科学の祭典")).toBe("科学の祭典");
  });

  it("removes edition numbers", () => {
    expect(stripEditionMarkers("第4回 高校生ビジネスコンテスト")).toBe("高校生ビジネスコンテスト");
    expect(stripEditionMarkers("ロボコン 第2期")).toBe("ロボコン");
    expect(stripEditionMarkers("第十回 数学の集い")).toBe("数学の集い");
    expect(stripEditionMarkers("Tech Meetup Vol.3")).toBe("Tech Meetup");
    expect(stripEditionMarkers("Tech Meetup vol 12")).toBe("Tech Meetup");
    expect(stripEditionMarkers("もくもく会 #12")).toBe("もくもく会");
    expect(stripEditionMarkers("The 10th Science Fair")).toBe("The Science Fair");
    expect(stripEditionMarkers("3rd Hack Day")).toBe("Hack Day");
  });

  it("handles full-width digits and keeps the other characters as typed", () => {
    expect(stripEditionMarkers("【第３回】ＡＩロボコン")).toBe("ＡＩロボコン");
    expect(stripEditionMarkers("ＡＩハッカソン２０２５")).toBe("ＡＩハッカソン");
    expect(stripEditionMarkers("ＴｅｃｈＣｏｎｆ　Ｖｏｌ．５")).toBe("ＴｅｃｈＣｏｎｆ");
  });

  it("cleans up brackets and separators left behind", () => {
    expect(stripEditionMarkers("高校生AIハッカソン（2025）")).toBe("高校生AIハッカソン");
    expect(stripEditionMarkers("[2025] Code Camp")).toBe("Code Camp");
    expect(stripEditionMarkers("AIハッカソン - 2025 - 東京大会")).toBe("AIハッカソン - 東京大会");
    expect(stripEditionMarkers("中高生AIハッカソン 2026 冬")).toBe("中高生AIハッカソン 冬");
    expect(stripEditionMarkers("2025年度 第3回 探究フォーラム")).toBe("探究フォーラム");
  });

  it("leaves numbers that are not edition markers alone", () => {
    expect(stripEditionMarkers("U-18 ゲーム制作ジャム")).toBe("U-18 ゲーム制作ジャム");
    expect(stripEditionMarkers("24時間ハッカソン")).toBe("24時間ハッカソン");
    expect(stripEditionMarkers("3Dプリンタ講座")).toBe("3Dプリンタ講座");
    expect(stripEditionMarkers("2000m走 記録会")).toBe("2000m走 記録会");
    expect(stripEditionMarkers("参加者2000人の大運動会")).toBe("参加者2000人の大運動会");
    expect(stripEditionMarkers("はじめてのPython勉強会")).toBe("はじめてのPython勉強会");
  });

  it("can return an empty string for a marker-only title", () => {
    expect(stripEditionMarkers("2025")).toBe("");
  });
});

describe("suggestNextTitle", () => {
  it("advances the year", () => {
    expect(suggestNextTitle("高校生AIハッカソン 2025")).toBe("高校生AIハッカソン 2026");
    expect(suggestNextTitle("探究発表会 2025年度")).toBe("探究発表会 2026年度");
    expect(suggestNextTitle("ISUCON'25")).toBe("ISUCON'26");
    expect(suggestNextTitle("FY2025 探究発表会")).toBe("FY2026 探究発表会");
    expect(suggestNextTitle("令和元年 科学の祭典")).toBe("令和2年 科学の祭典");
  });

  it("advances the edition number", () => {
    expect(suggestNextTitle("第4回 高校生ビジネスコンテスト")).toBe("第5回 高校生ビジネスコンテスト");
    expect(suggestNextTitle("第九回 数学の集い")).toBe("第十回 数学の集い");
    expect(suggestNextTitle("Tech Meetup Vol.9")).toBe("Tech Meetup Vol.10");
    expect(suggestNextTitle("もくもく会 #12")).toBe("もくもく会 #13");
    expect(suggestNextTitle("1st Hack Day")).toBe("2nd Hack Day");
    expect(suggestNextTitle("The 10TH Science Fair")).toBe("The 11TH Science Fair");
  });

  it("advances both when both are present", () => {
    expect(suggestNextTitle("第4回 高校生AIハッカソン 2025")).toBe("第5回 高校生AIハッカソン 2026");
  });

  it("keeps full-width digits full-width", () => {
    expect(suggestNextTitle("【第３回】ロボコン２０２５")).toBe("【第４回】ロボコン２０２６");
  });

  it("returns the title unchanged when nothing is found", () => {
    expect(suggestNextTitle("はじめてのPython勉強会")).toBe("はじめてのPython勉強会");
    expect(suggestNextTitle("U-18 ゲーム制作ジャム")).toBe("U-18 ゲーム制作ジャム");
  });
});

describe("editionLabelFrom", () => {
  it("builds a label from the title", () => {
    expect(editionLabelFrom("高校生AIハッカソン 2025")).toBe("2025");
    expect(editionLabelFrom("探究発表会 2025年度")).toBe("2025年度");
    expect(editionLabelFrom("第４回 ロボコン")).toBe("第4回");
    expect(editionLabelFrom("第4回 高校生AIハッカソン 2025")).toBe("2025 第4回");
    expect(editionLabelFrom("ISUCON'25")).toBe("2025");
    expect(editionLabelFrom("令和7年度 科学の祭典")).toBe("2025年度");
  });

  it("falls back to the start year in the given time zone", () => {
    // 2025-12-31 15:30 UTC = 2026-01-01 00:30 JST
    const startAt = new Date("2025-12-31T15:30:00Z");
    expect(editionLabelFrom("はじめてのPython勉強会", startAt, "Asia/Tokyo")).toBe("2026");
    expect(editionLabelFrom("はじめてのPython勉強会", startAt, "UTC")).toBe("2025");
  });

  it("returns null without a marker or start date", () => {
    expect(editionLabelFrom("はじめてのPython勉強会")).toBeNull();
    expect(editionLabelFrom("はじめてのPython勉強会", null)).toBeNull();
  });
});
