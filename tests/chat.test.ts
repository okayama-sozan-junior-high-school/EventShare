import { describe, expect, it } from "vitest";
import { rankEvents, type RankableEvent } from "~/.server/chat/rank";
import { extractWithRules, mergeState, nextSlot } from "~/.server/chat/rules";
import { emptyState, type ChatState } from "~/.server/chat/types";

const categories = [
  { id: 1, slug: "ai", name: "AI" },
  { id: 2, slug: "programming", name: "プログラミング" },
  { id: 6, slug: "science", name: "科学・技術" },
  { id: 7, slug: "contest", name: "コンテスト" },
  { id: 8, slug: "study-session", name: "勉強会" },
  { id: 11, slug: "other", name: "その他" },
];

function turn(state: ChatState, message: string) {
  const ex = extractWithRules(message, categories);
  const next = mergeState(state, ex);
  const slot = nextSlot(next, ex.wantsResults);
  return {
    state: { ...next, asked: slot ? [...next.asked, slot] : next.asked, pending: slot },
    slot,
  };
}

describe("conversation flow (rule-based)", () => {
  it("follows the example dialogue from the spec", () => {
    let t = turn(emptyState(), "何か面白いイベントに参加したい");
    expect(t.slot).toBe("interest");

    t = turn(t.state, "AIやプログラミングに興味がある");
    expect(t.state.categories).toEqual(expect.arrayContaining(["ai", "programming"]));
    expect(t.slot).toBe("style");

    t = turn(t.state, "自分で何か作ってみたい");
    expect(t.state.style).toBe("create");
    expect(t.slot).toBeNull();
  });

  it("asks one question at a time and accepts 'no preference'", () => {
    let t = turn(emptyState(), "イベントに行きたい");
    expect(t.slot).toBe("interest");
    t = turn(t.state, "特に決まっていない");
    expect(t.slot).toBe("style");
    t = turn(t.state, "どれでもいい");
    expect(t.state.style).toBe("any");
    expect(t.slot).toBeNull();
  });

  it("searches immediately when the user asks for results", () => {
    const t = turn(emptyState(), "無料でオンラインで参加できるイベントを探して");
    expect(t.state.fee).toBe("free");
    expect(t.state.format).toBe("online");
    expect(t.slot).toBeNull();
  });

  it("extracts specific keywords and locations", () => {
    const ex = extractWithRules("岡山でロボットのイベントにチームで出たい", categories);
    expect(ex.categories).toContain("science");
    expect(ex.keywords).toContain("ロボット");
    expect(ex.location).toBe("岡山");
    expect(ex.participation).toBe("team");
  });

  it("does not match 'ai' inside other words", () => {
    const ex = extractWithRules("I want to go to a fair in Spain", categories);
    expect(ex.categories).not.toContain("ai");
  });
});

const now = new Date("2026-11-01T00:00:00Z");

function ev(partial: Partial<RankableEvent> & { id: string; title: string }): RankableEvent {
  return {
    description: null,
    organizer: null,
    location: null,
    targetAudience: null,
    format: "offline",
    feeType: "unknown",
    startAt: new Date("2026-12-01T00:00:00Z"),
    applicationDeadline: null,
    likeCount: 0,
    bookmarkCount: 0,
    categorySlugs: [],
    categoryNames: [],
    ...partial,
  };
}

describe("rankEvents", () => {
  const events = [
    ev({ id: "hack", title: "高校生AIハッカソン", categorySlugs: ["ai", "contest"], categoryNames: ["AI", "コンテスト"], feeType: "free" }),
    ev({ id: "lecture", title: "AI入門講座", categorySlugs: ["ai", "study-session"], categoryNames: ["AI", "勉強会"], format: "online" }),
    ev({ id: "art", title: "美術展", categorySlugs: ["other"], categoryNames: ["その他"] }),
  ];
  const base = { ...emptyState(), categories: ["ai"] };

  it("prefers events matching the desired style", () => {
    const r = rankEvents(events, { ...base, style: "create" }, now, "Asia/Tokyo");
    expect(r.map((x) => x.event.id)).toEqual(["hack", "lecture"]);
    expect(r[0].matched.join()).toContain("自分で作品を作る");
  });

  it("never returns events unrelated to the requested topic", () => {
    const r = rankEvents(events, base, now, "Asia/Tokyo");
    expect(r.map((x) => x.event.id)).not.toContain("art");
  });

  it("applies the online filter as a hard constraint", () => {
    const r = rankEvents(events, { ...base, format: "online" }, now, "Asia/Tokyo");
    expect(r.map((x) => x.event.id)).toEqual(["lecture"]);
  });

  it("applies the period filter", () => {
    const r = rankEvents(events, { ...base, period: "soon" }, now, "Asia/Tokyo");
    expect(r.map((x) => x.event.id)).toEqual(["hack", "lecture"]);
    const late = rankEvents(
      [ev({ id: "late", title: "AIフェス", categorySlugs: ["ai"], categoryNames: ["AI"], startAt: new Date("2027-03-01T00:00:00Z") })],
      { ...base, period: "soon" },
      now,
      "Asia/Tokyo",
    );
    expect(late).toHaveLength(0);
  });

  it("returns nothing when no events match", () => {
    expect(rankEvents(events, { ...emptyState(), categories: ["science"] }, now, "Asia/Tokyo")).toHaveLength(0);
  });
});
