import { formatDateTime } from "~/lib/datetime";
import { getEventPhase, PHASE_LABEL } from "~/lib/event-phase";
import {
  ENDORSEMENT_AUDIENCE_LABEL,
  FEE_LABEL,
  FORMAT_LABEL,
} from "~/lib/labels";

/** Shown on every event-shaped Markdown payload. */
export const MCP_DISCLAIMER =
  "日程・締切・費用は変更されることがあります。公式サイトで確認してください。未登録の項目は null で、推測で埋めていません。";

const CADENCE_LABEL = {
  yearly: "毎年",
  twice_yearly: "年2回",
} as const;

const SOURCE_KIND_LABEL = {
  official: "公式",
  application: "応募",
  reference: "参照",
} as const;

const AUDIENCE_ORDER = ["beginner_ok", "experienced", "anyone"] as const;

export type FormatContext = {
  origin: string;
  timeZone: string;
  now: Date;
};

export type McpCategory = { slug: string; name: string };
export type McpTagRef = { slug: string; name: string; facet: string };

export type McpSeriesStats = {
  count: number;
  cadence: "yearly" | "twice_yearly" | null;
  typicalStartMonth: number | null;
  typicalDeadlineMonth: number | null;
  isRecurringSoon: boolean;
};

export type McpSeriesSummary = {
  id: string;
  title: string;
  stats: McpSeriesStats;
};

export type McpEventSummary = {
  id: string;
  title: string;
  excerpt: string | null;
  startAt: Date | null;
  endAt: Date | null;
  applicationDeadline: Date | null;
  location: string | null;
  format: "offline" | "online" | "hybrid" | "unknown";
  feeType: "free" | "paid" | "unknown";
  organizer: string | null;
  targetAudience: string | null;
  officialUrl: string | null;
  applicationUrl: string | null;
  imageUrl: string | null;
  categories: McpCategory[];
  tags: McpTagRef[];
  endorsementCount: number;
  editionLabel: string | null;
  seriesId: string | null;
  series: McpSeriesSummary | null;
};

export type McpEdition = {
  id: string;
  title: string;
  startAt: Date | null;
  status: string;
  editionLabel: string | null;
};

export type McpAudienceCount = {
  value: (typeof AUDIENCE_ORDER)[number];
  label: string;
  count: number;
};

export type McpEventDetail = McpEventSummary & {
  description: string | null;
  feeDetail: string | null;
  sources: { url: string; kind: "official" | "application" | "reference" }[];
  endorsements: {
    total: number;
    byAudience: McpAudienceCount[];
    comments: { audience: (typeof AUDIENCE_ORDER)[number]; comment: string }[];
  };
  activities: { title: string; summary: string }[];
  editions: McpEdition[];
  previousEditionId: string | null;
  nextEditionId: string | null;
  resolvedFrom: string | null;
};

export type McpSeriesDetail = {
  id: string;
  title: string;
  description: string | null;
  stats: McpSeriesStats;
  editions: McpEdition[];
  endorsements: { total: number; byAudience: McpAudienceCount[] };
};

export type McpFacetGroup = {
  facet: string;
  label: string;
  tags: { slug: string; name: string; useCount: number }[];
};

export type McpFacets = {
  categories: McpCategory[];
  tagsByFacet: McpFacetGroup[];
  audience: { value: string; label: string }[];
  format: { value: string; label: string }[];
  status: { value: string; label: string }[];
};

export type McpSearchResult = {
  items: McpEventSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
};

export type McpRecommendHit = {
  event: McpEventSummary;
  evidence: string[];
};

/** Ranking fields kept off the public JSON. */
export type McpRecommendCandidate = McpEventSummary & {
  description: string | null;
  likeCount: number;
  bookmarkCount: number;
  startMonth: number | null;
};

export function eventPageUrl(origin: string, id: string) {
  return `${origin.replace(/\/$/, "")}/events/${encodeURIComponent(id)}`;
}

/** Absolute http(s) URL, or a same-origin path. Anything else becomes null. */
export function absoluteUrl(origin: string, value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return `${origin.replace(/\/$/, "")}${trimmed}`;
  }
  return null;
}

export function formatMcpDate(date: Date | null, timeZone: string) {
  if (!date) return { iso: null, text: null };
  return { iso: date.toISOString(), text: formatDateTime(date, timeZone) };
}

function labelOf(map: Record<string, string>, value: string) {
  return map[value] ?? value;
}

function monthLabel(month: number | null) {
  return month ? `${month}月` : null;
}

function cadenceLabel(cadence: McpSeriesStats["cadence"]) {
  return cadence ? CADENCE_LABEL[cadence] : null;
}

function dateLine(label: string, date: Date | null, timeZone: string) {
  const formatted = formatMcpDate(date, timeZone);
  if (!formatted.iso || !formatted.text) return `- ${label}: 未登録`;
  return `- ${label}: ${formatted.text}（${formatted.iso}）`;
}

function seriesLine(series: McpSeriesSummary | null) {
  if (!series) return "- シリーズ: なし";
  const cadence = cadenceLabel(series.stats.cadence) ?? "周期は不定";
  const month = series.stats.typicalStartMonth
    ? `例年${series.stats.typicalStartMonth}月頃`
    : "例年の時期は不明";
  const soon = series.stats.isRecurringSoon
    ? "。例年の傾向では、そろそろ募集が始まる時期です（予定ではありません）"
    : "";
  return `- シリーズ: ${series.title}（${series.id}、全${series.stats.count}回、${cadence}、${month}）${soon}`;
}

/** Public JSON for one event. Copies listed fields only — never the raw row. */
export function eventJson(event: McpEventSummary, ctx: FormatContext) {
  const phase = getEventPhase(event, ctx.now);
  return {
    id: event.id,
    title: event.title,
    url: eventPageUrl(ctx.origin, event.id),
    excerpt: event.excerpt,
    editionLabel: event.editionLabel,
    seriesId: event.seriesId,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    startAt: formatMcpDate(event.startAt, ctx.timeZone),
    endAt: formatMcpDate(event.endAt, ctx.timeZone),
    applicationDeadline: formatMcpDate(event.applicationDeadline, ctx.timeZone),
    location: event.location,
    format: event.format,
    formatLabel: labelOf(FORMAT_LABEL, event.format),
    feeType: event.feeType,
    feeLabel: labelOf(FEE_LABEL, event.feeType),
    organizer: event.organizer,
    targetAudience: event.targetAudience,
    officialUrl: absoluteUrl(ctx.origin, event.officialUrl),
    applicationUrl: absoluteUrl(ctx.origin, event.applicationUrl),
    imageUrl: absoluteUrl(ctx.origin, event.imageUrl),
    categories: event.categories.map((c) => ({ slug: c.slug, name: c.name })),
    tags: event.tags.map((t) => ({ slug: t.slug, name: t.name, facet: t.facet })),
    endorsementCount: event.endorsementCount,
    series: event.series
      ? {
          id: event.series.id,
          title: event.series.title,
          stats: { ...event.series.stats },
        }
      : null,
  };
}

export function summaryMarkdown(event: McpEventSummary, ctx: FormatContext) {
  const json = eventJson(event, ctx);
  const categories = json.categories.map((c) => c.name).join("、");
  const tags = json.tags.map((t) => t.name).join("、");
  return [
    `## ${json.title}`,
    `- URL: ${json.url}`,
    `- ID: ${json.id}`,
    `- 回: ${json.editionLabel ?? "未登録"}`,
    `- 状態: ${json.phaseLabel}（${json.phase}）`,
    dateLine("開催", event.startAt, ctx.timeZone),
    dateLine("終了", event.endAt, ctx.timeZone),
    dateLine("応募締切", event.applicationDeadline, ctx.timeZone),
    `- 場所: ${json.location ?? "未登録"}`,
    `- 形式: ${json.formatLabel}（${json.format}）`,
    `- 参加費: ${json.feeLabel}（${json.feeType}）`,
    `- 対象: ${json.targetAudience ?? "未登録"}`,
    `- 主催: ${json.organizer ?? "未登録"}`,
    `- カテゴリ: ${categories || "なし"}`,
    `- タグ: ${tags || "なし"}`,
    `- おすすめ: ${json.endorsementCount}件`,
    seriesLine(event.series),
    `- 概要: ${json.excerpt ?? "未登録"}`,
    `- 公式サイト: ${json.officialUrl ? `${json.officialUrl}（要確認）` : "未登録"}`,
    `- 応募ページ: ${json.applicationUrl ? `${json.applicationUrl}（要確認）` : "未登録"}`,
  ].join("\n");
}

function editionLine(edition: McpEdition, currentId: string | null, timeZone: string) {
  const when = edition.startAt ? formatDateTime(edition.startAt, timeZone) : "日時未登録";
  const label = edition.editionLabel ? `${edition.editionLabel} ` : "";
  const mark = edition.id === currentId ? " ← この回" : "";
  return `- ${label}${edition.title}（${edition.id}） ${when}${mark}`;
}

export function formatEventDetail(event: McpEventDetail, ctx: FormatContext) {
  const base = eventJson(event, ctx);
  const json = {
    ...base,
    description: event.description,
    feeDetail: event.feeDetail,
    sources: event.sources.map((s) => ({
      url: absoluteUrl(ctx.origin, s.url),
      kind: s.kind,
      kindLabel: SOURCE_KIND_LABEL[s.kind],
    })),
    endorsements: {
      total: event.endorsements.total,
      byAudience: event.endorsements.byAudience.map((a) => ({
        value: a.value,
        label: a.label,
        count: a.count,
      })),
      comments: event.endorsements.comments.map((c) => ({
        audience: c.audience,
        audienceLabel: ENDORSEMENT_AUDIENCE_LABEL[c.audience],
        comment: c.comment,
      })),
    },
    activities: event.activities.map((a) => ({ title: a.title, summary: a.summary })),
    editions: event.editions.map((edition) => ({
      id: edition.id,
      title: edition.title,
      editionLabel: edition.editionLabel,
      status: edition.status,
      startAt: formatMcpDate(edition.startAt, ctx.timeZone),
    })),
    previousEditionId: event.previousEditionId,
    nextEditionId: event.nextEditionId,
    resolvedFrom: event.resolvedFrom,
  };

  const counts = json.endorsements.byAudience
    .map((a) => `${a.label} ${a.count}`)
    .join(" / ");
  const comments = json.endorsements.comments.length
    ? json.endorsements.comments.map((c) => `- ${c.audienceLabel}: ${c.comment}`).join("\n")
    : "- （一言はありません）";
  const activities = json.activities.length
    ? json.activities.map((a) => `- ${a.title}: ${a.summary}`).join("\n")
    : "- （活動報告はありません）";
  const sources = json.sources.length
    ? json.sources
        .map((s) => `- ${s.kindLabel}: ${s.url ?? "未登録"}（要確認）`)
        .join("\n")
    : "- （出典 URL はありません）";
  const editions = event.editions.length
    ? event.editions.map((e) => editionLine(e, event.id, ctx.timeZone)).join("\n")
    : "- （他の回はありません）";

  const markdown = [
    event.resolvedFrom
      ? `> ID \`${event.resolvedFrom}\` は統合済みのため、統合先を表示しています。`
      : null,
    `# ${json.title}`,
    summaryMarkdown(event, ctx).split("\n").slice(1).join("\n"),
    "",
    "## 説明",
    json.description ?? "未登録",
    json.feeDetail ? `\n参加費の詳細: ${json.feeDetail}` : null,
    "",
    "## 出典",
    sources,
    "",
    "## おすすめ",
    `全${json.endorsements.total}件（${counts}）`,
    "一言（投稿した人の名前は含みません）:",
    comments,
    "",
    "## 活動報告の要約",
    "書いた人の名前は含みません。",
    activities,
    "",
    "## シリーズの回",
    editions,
    `- 前回: ${json.previousEditionId ?? "なし"}`,
    `- 次回: ${json.nextEditionId ?? "なし"}`,
    "",
    MCP_DISCLAIMER,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { markdown, json };
}

export function formatSearchResult(result: McpSearchResult, ctx: FormatContext) {
  const events = result.items.map((item) => eventJson(item, ctx));
  const json = {
    total: result.total,
    page: result.page,
    pageCount: result.pageCount,
    pageSize: result.pageSize,
    events,
  };
  const intro =
    result.total === 0
      ? "該当する公開イベントはありません。"
      : `全${result.total}件のうち ${result.items.length}件（${result.page}ページ目、1ページ${result.pageSize}件）。`;
  const markdown = [
    "# イベント検索結果",
    intro,
    "",
    result.items.map((item) => summaryMarkdown(item, ctx)).join("\n\n---\n\n"),
    "",
    MCP_DISCLAIMER,
  ]
    .filter((part) => part !== "")
    .join("\n");
  return { markdown, json };
}

export function formatSeries(series: McpSeriesDetail, ctx: FormatContext) {
  const json = {
    id: series.id,
    title: series.title,
    description: series.description,
    stats: { ...series.stats },
    cadenceLabel: cadenceLabel(series.stats.cadence),
    typicalStartMonthLabel: monthLabel(series.stats.typicalStartMonth),
    typicalDeadlineMonthLabel: monthLabel(series.stats.typicalDeadlineMonth),
    editions: series.editions.map((edition) => ({
      id: edition.id,
      title: edition.title,
      editionLabel: edition.editionLabel,
      status: edition.status,
      url: eventPageUrl(ctx.origin, edition.id),
      startAt: formatMcpDate(edition.startAt, ctx.timeZone),
    })),
    endorsements: {
      total: series.endorsements.total,
      byAudience: series.endorsements.byAudience.map((a) => ({ ...a })),
    },
  };
  const counts = json.endorsements.byAudience.map((a) => `${a.label} ${a.count}`).join(" / ");
  const editions = json.editions.length
    ? json.editions
        .map((edition) => {
          const when = edition.startAt.text ?? "日時未登録";
          const label = edition.editionLabel ? `${edition.editionLabel} ` : "";
          return `- ${label}${edition.title}（${edition.id}） ${when} ${edition.url}`;
        })
        .join("\n")
    : "- （公開中の回はありません）";
  const soon = series.stats.isRecurringSoon
    ? "はい。例年の傾向では、そろそろ募集が始まる時期です。予定ではないので公式サイトで確認してください。"
    : "いいえ（回が少ない、または今年の回がすでにある、などの場合です）";
  const markdown = [
    `# ${series.title}`,
    `- ID: ${series.id}`,
    `- 説明: ${series.description ?? "未登録"}`,
    `- 公開中の回数: ${series.stats.count}`,
    `- 周期: ${json.cadenceLabel ?? "不定"}（${series.stats.cadence ?? "null"}）`,
    `- 例年の開催月: ${json.typicalStartMonthLabel ?? "不明"}`,
    `- 例年の締切月: ${json.typicalDeadlineMonthLabel ?? "不明"}`,
    `- そろそろ募集: ${soon}`,
    "",
    "## おすすめの集計",
    `全${json.endorsements.total}件（${counts}）。名前は含みません。`,
    "",
    "## 回",
    editions,
    "",
    MCP_DISCLAIMER,
  ].join("\n");
  return { markdown, json };
}

export function formatFacets(facets: McpFacets) {
  const json = {
    categories: facets.categories.map((c) => ({ slug: c.slug, name: c.name })),
    tagsByFacet: facets.tagsByFacet.map((group) => ({
      facet: group.facet,
      label: group.label,
      tags: group.tags.map((t) => ({ slug: t.slug, name: t.name, useCount: t.useCount })),
    })),
    audience: facets.audience.map((item) => ({ ...item })),
    format: facets.format.map((item) => ({ ...item })),
    status: facets.status.map((item) => ({ ...item })),
  };
  const categories = json.categories.length
    ? json.categories.map((c) => `- ${c.name}（${c.slug}）`).join("\n")
    : "- （カテゴリはありません）";
  const tags = json.tagsByFacet.length
    ? json.tagsByFacet
        .map((group) => {
          const lines = group.tags
            .map((t) => `- ${t.name}（${t.slug}、利用 ${t.useCount}）`)
            .join("\n");
          return `### ${group.label}（${group.facet}）\n${lines}`;
        })
        .join("\n\n")
    : "（表示できるタグはありません）";
  const enumList = (items: { value: string; label: string }[]) =>
    items.map((item) => `- ${item.value}: ${item.label}`).join("\n");
  const markdown = [
    "# 検索に使える区分",
    "",
    "## カテゴリ",
    categories,
    "",
    "## タグ",
    tags,
    "",
    "## おすすめの「向いている人」",
    enumList(json.audience),
    "",
    "## 開催形式",
    enumList(json.format),
    "search_events の format に指定できるのは online と offline だけです。hybrid のイベントはどちらにも含まれます。",
    "",
    "## 検索の status",
    enumList(json.status),
  ].join("\n");
  return { markdown, json };
}

export function formatRecommendations(hits: McpRecommendHit[], ctx: FormatContext) {
  const events = hits.map((hit) => ({ ...eventJson(hit.event, ctx), evidence: [...hit.evidence] }));
  const json = { events };
  const body = hits.length
    ? hits
        .map((hit) => {
          const evidence = hit.evidence.length
            ? hit.evidence.join("、")
            : "特定の一致条件はありません。公開中または最近終了したイベントです。";
          return `${summaryMarkdown(hit.event, ctx)}\n- 根拠: ${evidence}`;
        })
        .join("\n\n---\n\n")
    : "条件に合う公開イベントは見つかりませんでした。月や対象の条件を外すか、search_events で広く検索してください。";
  const markdown = [
    "# おすすめ候補",
    "公開中のイベントと、最近終了したイベントから選んでいます。おすすめ件数が多いものを少し優先しています。",
    "",
    body,
    "",
    "根拠はデータベース上の一致です。参加を保証するものではありません。",
    MCP_DISCLAIMER,
  ].join("\n");
  return { markdown, json };
}

export function connectorSearch(items: McpEventSummary[], origin: string) {
  return {
    results: items.map((item) => ({
      id: item.id,
      title: item.title,
      url: eventPageUrl(origin, item.id),
    })),
  };
}

export function connectorFetch(event: McpEventDetail, ctx: FormatContext) {
  const detail = formatEventDetail(event, ctx);
  return {
    id: event.id,
    title: event.title,
    text: detail.markdown,
    url: eventPageUrl(ctx.origin, event.id),
    metadata: detail.json,
  };
}
