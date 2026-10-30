import { and, eq, gte, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { normalizeForMatch, truncate } from "~/lib/text";
import type { AiClient } from "../ai/client";
import type { Database } from "../db";
import { events } from "../db/schema";
import { getCategoriesForEvents, notEndedCondition } from "../services/events";
import { rankEvents, ruleReason, STYLE_LABEL, type RankableEvent, type Ranked } from "./rank";
import { extractWithRules, hasInterest, mergeState, nextSlot } from "./rules";
import {
  emptyState,
  STYLES,
  type CategoryInfo,
  type ChatState,
  type Extracted,
  type QuickReply,
  type Recommendation,
  type Slot,
} from "./types";

// ---------------------------------------------------------------------------
// Understanding the message
// ---------------------------------------------------------------------------

const aiExtractSchema = z.object({
  categories: z.array(z.string()).max(6),
  keywords: z.array(z.string().max(20)).max(5),
  style: z.enum(STYLES).nullable(),
  format: z.enum(["online", "offline", "any"]).nullable(),
  fee: z.enum(["free", "any"]).nullable(),
  participation: z.enum(["solo", "team", "any"]).nullable(),
  wantsResults: z.boolean(),
});

async function extractWithAi(
  ai: AiClient,
  message: string,
  pending: Slot | null,
  categories: CategoryInfo[],
): Promise<Partial<Extracted> | null> {
  const result = await ai.generateJson({
    system: [
      "あなたは学校の生徒向けイベント検索サービスの入力解析器です。",
      "ユーザーの発言から検索条件だけをJSONで抽出してください。発言に書かれていないことは推測せず null や空配列にしてください。",
      `categories は次のスラッグからのみ選んでください: ${categories.map((c) => `${c.slug}(${c.name})`).join(", ")}`,
      "style: create=自分で作品を作る, learn=講義や勉強会で学ぶ, compete=コンテストで競う, present=発表する, volunteer=ボランティア, any=こだわらない。",
      "keywords は発言中の具体的な興味の語（例: ロボット、宇宙）を最大5つ。",
      "wantsResults はユーザーがすぐにイベントの提示を求めている場合 true。",
    ].join("\n"),
    user: `直前の質問の種類: ${pending ?? "なし"}\nユーザーの発言: ${truncate(message, 400)}`,
    schema: aiExtractSchema,
    maxTokens: 300,
    timeoutMs: 12_000,
  });
  if (!result) return null;
  const known = new Set(categories.map((c) => c.slug));
  const normalizedMessage = normalizeForMatch(message);
  return {
    categories: result.categories.filter((c) => known.has(c)),
    // Keywords must literally appear in the message (no invented interests).
    keywords: result.keywords.filter((k) => {
      const n = normalizeForMatch(k);
      return n.length >= 2 && normalizedMessage.includes(n);
    }),
    style: result.style,
    format: result.format,
    fee: result.fee,
    participation: result.participation,
    wantsResults: result.wantsResults,
  };
}

function combine(rules: Extracted, ai: Partial<Extracted> | null): Extracted {
  if (!ai) return rules;
  return {
    ...rules,
    categories: [...new Set([...rules.categories, ...(ai.categories ?? [])])],
    keywords: [...new Set([...rules.keywords, ...(ai.keywords ?? [])])],
    style: rules.style ?? ai.style ?? null,
    format: rules.format ?? ai.format ?? null,
    fee: rules.fee ?? ai.fee ?? null,
    participation: rules.participation ?? ai.participation ?? null,
    wantsResults: rules.wantsResults || !!ai.wantsResults,
  };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function interestLabel(state: ChatState, categories: CategoryInfo[]) {
  const names = state.categories
    .map((slug) => categories.find((c) => c.slug === slug)?.name)
    .filter(Boolean);
  const words = [...names, ...state.keywords.filter((k) => !names.includes(k))];
  return words.slice(0, 3).join("・");
}

function question(slot: Slot, state: ChatState, categories: CategoryInfo[]) {
  if (slot === "interest") {
    return {
      text: "いいですね！まずは、どんな分野に興味がありますか？たとえば、プログラミングやAI、科学、デザイン、ビジネスなどがあります。",
      quickReplies: [
        ...categories
          .filter((c) => ["ai", "programming", "science", "design", "business", "research", "volunteer"].includes(c.slug))
          .map((c) => ({ label: c.name, message: `${c.name}に興味がある` })),
        { label: "まだ決まっていない", message: "特に決まっていない" },
      ],
    };
  }
  const topic = interestLabel(state, categories);
  return {
    text: `${topic ? `${topic}ですね。` : ""}自分で作品を作るイベントと、講義や勉強会に参加するイベントなら、どちらに興味がありますか？`,
    quickReplies: [
      { label: "自分で何か作りたい", message: "自分で何か作ってみたい" },
      { label: "講義や勉強会で学びたい", message: "講義や勉強会で学びたい" },
      { label: "コンテストで競いたい", message: "コンテストで競ってみたい" },
      { label: "研究や発表をしたい", message: "研究や発表をしてみたい" },
      { label: "どれでもいい", message: "どれでもいい" },
    ],
  };
}

const REFINE_REPLIES: QuickReply[] = [
  { label: "オンラインで参加したい", message: "オンラインで参加できるものがいい" },
  { label: "無料のものだけ", message: "無料のものだけ" },
  { label: "1か月以内に開催", message: "1か月以内に開催されるもの" },
  { label: "最初からやり直す", message: "最初からやり直したい" },
];

// ---------------------------------------------------------------------------
// Search + reasons
// ---------------------------------------------------------------------------

async function loadCandidates(db: Database, now: Date) {
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.status, "published"),
        notEndedCondition(now),
        // Only events that still accept applications (or have no deadline).
        or(isNull(events.applicationDeadline), gte(events.applicationDeadline, now)),
      ),
    )
    .limit(300);
  const cats = new Map<string, { slug: string; name: string }[]>();
  for (let i = 0; i < rows.length; i += 80) {
    const part = await getCategoriesForEvents(db, rows.slice(i, i + 80).map((r) => r.id));
    for (const [k, v] of part) cats.set(k, v);
  }
  return rows.map((r) => ({
    ...r,
    categorySlugs: (cats.get(r.id) ?? []).map((c) => c.slug),
    categoryNames: (cats.get(r.id) ?? []).map((c) => c.name),
  }));
}

const aiReasonSchema = z.object({
  items: z.array(z.object({ id: z.string(), reason: z.string().max(400) })).max(10),
});

/** Reasons must not introduce dates, numbers of days, prices or links. */
function isSafeReason(reason: string) {
  return (
    reason.length >= 8 &&
    reason.length <= 160 &&
    !/https?:|www\.|\d+\s*(月|日|\/|円|時)|締切|〆切/.test(reason.normalize("NFKC"))
  );
}

async function reasonsWithAi(
  ai: AiClient,
  ranked: Ranked<RankableEvent>[],
  state: ChatState,
  categories: CategoryInfo[],
) {
  const conditions = [
    interestLabel(state, categories) && `興味: ${interestLabel(state, categories)}`,
    state.style && state.style !== "any" && `やりたいこと: ${STYLE_LABEL[state.style]}`,
    state.format === "online" && "オンライン希望",
    state.fee === "free" && "無料希望",
    state.participation === "team" && "チーム参加希望",
  ]
    .filter(Boolean)
    .join(" / ");
  const result = await ai.generateJson({
    system: [
      "あなたは中高生にイベントを紹介するアシスタントです。",
      "与えられたイベント情報と希望条件だけを根拠に、各イベントをおすすめする理由を日本語で1〜2文（80字程度）で書いてください。",
      "イベント情報に書かれていない内容（日付・締切・費用・場所・実績など）を書いてはいけません。日付や金額には触れないでください。",
      "推測を含む場合は「〜かもしれません」と表現してください。",
    ].join("\n"),
    user: JSON.stringify({
      conditions,
      events: ranked.map((r) => ({
        id: r.event.id,
        title: r.event.title,
        categories: r.event.categoryNames,
        summary: truncate((r.event.description ?? "").replace(/\s+/g, " "), 300),
        matched: r.matched,
      })),
    }),
    schema: aiReasonSchema,
    maxTokens: 700,
    timeoutMs: 15_000,
  });
  const map = new Map<string, string>();
  for (const item of result?.items ?? []) {
    const reason = item.reason.trim();
    if (ranked.some((r) => r.event.id === item.id) && isSafeReason(reason)) map.set(item.id, reason);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Turn
// ---------------------------------------------------------------------------

export type ChatTurn = {
  state: ChatState;
  reply: string;
  quickReplies: QuickReply[];
  recommendations: Recommendation[];
  usedAi: boolean;
  canSaveInterests: boolean;
};

export async function runChatTurn(
  deps: { db: Database; ai: AiClient | null; categories: CategoryInfo[]; now: Date; timeZone: string },
  previous: ChatState,
  message: string,
): Promise<ChatTurn> {
  const { db, ai, categories, now, timeZone } = deps;
  const rules = extractWithRules(message, categories);
  if (rules.reset) {
    const state = { ...emptyState(), asked: ["interest" as const], pending: "interest" as const };
    const q = question("interest", state, categories);
    return { state, reply: `条件をリセットしました。${q.text}`, quickReplies: q.quickReplies, recommendations: [], usedAi: false, canSaveInterests: false };
  }

  const aiExtract = ai ? await extractWithAi(ai, message, previous.pending, categories) : null;
  const extracted = combine(rules, aiExtract);
  let state = mergeState(previous, extracted);

  const slot = previous.searched && !extracted.wantsResults ? null : nextSlot(state, extracted.wantsResults);
  if (slot) {
    state = { ...state, asked: [...new Set([...state.asked, slot])], pending: slot };
    const q = question(slot, state, categories);
    return { state, reply: q.text, quickReplies: q.quickReplies, recommendations: [], usedAi: !!aiExtract, canSaveInterests: false };
  }

  state = { ...state, pending: null, searched: true };
  const candidates = await loadCandidates(db, now);
  const ranked = rankEvents(candidates, state, now, timeZone, 5);
  const canSaveInterests = hasInterest(state);

  if (ranked.length === 0) {
    return {
      state,
      reply:
        "今の条件に合う、募集中のイベントは見つかりませんでした。データベースに登録されていないイベントを紹介することはできないため、条件を少し広げてみませんか？（例: 分野を増やす、オンライン・会場どちらでもOKにする）",
      quickReplies: [
        { label: "どんな形式でもいい", message: "形式はどれでもいい" },
        { label: "別の分野も見たい", message: "最初からやり直したい" },
      ],
      recommendations: [],
      usedAi: !!aiExtract,
      canSaveInterests,
    };
  }

  const aiReasons = ai ? await reasonsWithAi(ai, ranked, state, categories) : new Map<string, string>();
  const recommendations: Recommendation[] = ranked.map((r) => {
    const reason = aiReasons.get(r.event.id);
    return reason
      ? { eventId: r.event.id, reason, reasonSource: "ai" }
      : { eventId: r.event.id, reason: ruleReason(r), reasonSource: "rule" };
  });

  const summary = [
    interestLabel(state, categories),
    state.style && state.style !== "any" ? STYLE_LABEL[state.style] : null,
    state.format === "online" ? "オンライン" : null,
    state.fee === "free" ? "無料" : null,
  ]
    .filter(Boolean)
    .join("・");
  return {
    state,
    reply: `${summary ? `「${summary}」の条件で、` : ""}登録されている募集中のイベントから${ranked.length}件見つけました。日程や応募締切はイベントページ・公式サイトで必ず確認してください。`,
    quickReplies: REFINE_REPLIES,
    recommendations,
    usedAi: !!aiExtract || aiReasons.size > 0,
    canSaveInterests,
  };
}

export function greeting(): { reply: string; quickReplies: QuickReply[] } {
  return {
    reply:
      "こんにちは！Event Share のAIアシスタントです。あなたに合いそうなイベントを一緒に探します。どんなイベントに参加してみたいですか？",
    quickReplies: [
      { label: "何か面白いイベントに参加したい", message: "何か面白いイベントに参加したい" },
      { label: "プログラミングで何か作りたい", message: "プログラミングで何か作ってみたい" },
      { label: "無料のオンラインイベント", message: "無料でオンラインで参加できるイベントを探して" },
    ],
  };
}
