import { daysUntil } from "~/lib/datetime";
import { normalizeForMatch } from "~/lib/text";
import type { ChatState } from "./types";

export type RankableEvent = {
  id: string;
  title: string;
  description: string | null;
  organizer: string | null;
  location: string | null;
  targetAudience: string | null;
  format: "offline" | "online" | "hybrid" | "unknown";
  feeType: "free" | "paid" | "unknown";
  startAt: Date | null;
  applicationDeadline: Date | null;
  likeCount: number;
  bookmarkCount: number;
  categorySlugs: string[];
  categoryNames: string[];
};

export type Ranked<E extends RankableEvent> = {
  event: E;
  score: number;
  /** Facts from the database that explain the match (shown to users / given to the AI). */
  matched: string[];
};

const STYLE_SIGNALS = {
  create: { categories: [], re: /ハッカソン|アイデアソン|ジャム|制作|開発|作品|作る|作り|ものづくり|メイカー|プロトタイプ/ },
  learn: { categories: ["study-session"], re: /勉強会|講座|ワークショップ|セミナー|講演|入門|ハンズオン|体験/ },
  compete: { categories: ["contest"], re: /コンテスト|大会|コンペ|選手権|グランプリ|甲子園|オリンピック|賞/ },
  present: { categories: ["presentation", "research"], re: /発表|ピッチ|ポスター|プレゼン|研究/ },
  volunteer: { categories: ["volunteer"], re: /ボランティア|地域|清掃|支援/ },
} as const;

const STYLE_LABEL = {
  create: "自分で作品を作る",
  learn: "講義や勉強会で学ぶ",
  compete: "コンテストで競う",
  present: "研究や成果を発表する",
  volunteer: "ボランティア・地域活動",
} as const;

const DAY = 86_400_000;

/** Hard constraints (format / fee / period). Unknown values are kept. */
export function passesFilters(e: RankableEvent, s: ChatState, now: Date) {
  if (s.format === "online" && e.format === "offline") return false;
  if (s.format === "offline" && e.format === "online") return false;
  if (s.fee === "free" && e.feeType === "paid") return false;
  if (s.period === "soon" || s.period === "3months") {
    const limit = now.getTime() + (s.period === "soon" ? 31 : 92) * DAY;
    if (!e.startAt || e.startAt.getTime() > limit) return false;
  }
  return true;
}

export function rankEvents<E extends RankableEvent>(
  events: E[],
  s: ChatState,
  now: Date,
  timeZone: string,
  limit = 5,
): Ranked<E>[] {
  const wantsTopic = s.categories.length > 0 || s.keywords.length > 0;
  const ranked: Ranked<E>[] = [];

  for (const e of events) {
    if (!passesFilters(e, s, now)) continue;
    const text = normalizeForMatch(
      [e.title, e.description, e.organizer, e.targetAudience].filter(Boolean).join(" "),
    );
    let score = 0;
    let topicHit = false;
    const matched: string[] = [];

    const catHits = e.categorySlugs.filter((c) => s.categories.includes(c));
    if (catHits.length > 0) {
      score += 3 * Math.min(2, catHits.length);
      topicHit = true;
      const names = catHits.map((slug) => e.categoryNames[e.categorySlugs.indexOf(slug)]);
      matched.push(`カテゴリ「${names.join("・")}」のイベント`);
    }
    const kwHits = s.keywords.filter((k) => text.includes(normalizeForMatch(k)));
    if (kwHits.length > 0) {
      score += 2 * Math.min(3, kwHits.length);
      topicHit = true;
      matched.push(`「${kwHits.join("・")}」に関連`);
    }
    if (wantsTopic && !topicHit) continue;

    if (s.style && s.style !== "any") {
      const signal = STYLE_SIGNALS[s.style];
      if (signal.re.test(text) || e.categorySlugs.some((c) => (signal.categories as readonly string[]).includes(c))) {
        score += 2;
        matched.push(`${STYLE_LABEL[s.style]}タイプのイベント`);
      }
    }
    if (s.format === "online" && (e.format === "online" || e.format === "hybrid")) {
      score += 1;
      matched.push("オンラインで参加可能");
    }
    if (s.format === "offline" && (e.format === "offline" || e.format === "hybrid")) score += 0.5;
    if (s.location && e.location && normalizeForMatch(e.location).includes(normalizeForMatch(s.location))) {
      score += 1.5;
      matched.push(`開催場所が${s.location}`);
    }
    if (e.feeType === "free") {
      score += s.fee === "free" ? 1 : 0.3;
      matched.push("参加費無料");
    }
    if (s.participation === "team" && /チーム|グループ|団体/.test(text)) {
      score += 1;
      matched.push("チームで参加可能");
    }
    if (s.participation === "solo" && /個人|1人|ひとり/.test(text)) {
      score += 0.5;
      matched.push("個人で参加可能");
    }
    if (e.applicationDeadline) {
      const days = daysUntil(e.applicationDeadline, now, timeZone);
      if (days >= 0 && days <= 14) {
        score += 0.5;
        matched.push(`応募締切まであと${days}日`);
      }
    }
    score += Math.min(1, (e.likeCount + e.bookmarkCount * 2) / 20);
    ranked.push({ event: e, score, matched });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function ruleReason(r: Ranked<RankableEvent>) {
  if (r.matched.length === 0) return "現在募集中のイベントです。";
  return `${r.matched.slice(0, 3).join("、")}です。`;
}

export { STYLE_LABEL };
