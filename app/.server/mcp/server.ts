import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { rankEvents, type RankableEvent } from "~/.server/chat/rank";
import { emptyState } from "~/.server/chat/types";
import { normalizeForMatch } from "~/lib/text";
import {
  connectorFetch,
  connectorSearch,
  formatEventDetail,
  formatFacets,
  formatRecommendations,
  formatSearchResult,
  formatSeries,
  MCP_DISCLAIMER,
  type FormatContext,
  type McpEventDetail,
  type McpFacets,
  type McpRecommendCandidate,
  type McpSearchResult,
  type McpSeriesDetail,
} from "./format";

const VERIFY =
  "日程・締切は変更されることがあります。回答では公式サイトで確認するよう伝えてください。 Confirm dates and deadlines on the official site.";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const slug = z.string().trim().min(1).max(50);
const slugList = z.union([slug, z.array(slug).max(10)]);
const monthNum = z.number().int().min(1).max(12);
const monthList = z.union([monthNum, z.array(monthNum).max(12)]);
const dateKey = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

const datePair = z.object({
  iso: z.string().nullable(),
  text: z.string().nullable(),
});

const seriesStatsSchema = z.object({
  count: z.number(),
  cadence: z.enum(["yearly", "twice_yearly"]).nullable(),
  typicalStartMonth: z.number().nullable(),
  typicalDeadlineMonth: z.number().nullable(),
  isRecurringSoon: z.boolean(),
});

const seriesSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  stats: seriesStatsSchema,
});

const eventSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  excerpt: z.string().nullable(),
  editionLabel: z.string().nullable(),
  seriesId: z.string().nullable(),
  phase: z.string(),
  phaseLabel: z.string(),
  startAt: datePair,
  endAt: datePair,
  applicationDeadline: datePair,
  location: z.string().nullable(),
  format: z.string(),
  formatLabel: z.string(),
  feeType: z.string(),
  feeLabel: z.string(),
  organizer: z.string().nullable(),
  targetAudience: z.string().nullable(),
  officialUrl: z.string().nullable(),
  applicationUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  categories: z.array(z.object({ slug: z.string(), name: z.string() })),
  tags: z.array(z.object({ slug: z.string(), name: z.string(), facet: z.string() })),
  endorsementCount: z.number(),
  series: seriesSummarySchema.nullable(),
});

const searchOutput = {
  total: z.number(),
  page: z.number(),
  pageCount: z.number(),
  pageSize: z.number(),
  events: z.array(eventSummarySchema),
};

const eventDetailSchema = eventSummarySchema.extend({
  description: z.string().nullable(),
  feeDetail: z.string().nullable(),
  sources: z.array(z.object({ url: z.string().nullable(), kind: z.string(), kindLabel: z.string() })),
  endorsements: z.object({
    total: z.number(),
    byAudience: z.array(z.object({ value: z.string(), label: z.string(), count: z.number() })),
    comments: z.array(z.object({ audience: z.string(), audienceLabel: z.string(), comment: z.string() })),
  }),
  activities: z.array(z.object({ title: z.string(), summary: z.string() })),
  editions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      editionLabel: z.string().nullable(),
      status: z.string(),
      startAt: datePair,
    }),
  ),
  previousEditionId: z.string().nullable(),
  nextEditionId: z.string().nullable(),
  resolvedFrom: z.string().nullable(),
});

const recommendOutput = {
  events: z.array(eventSummarySchema.extend({ evidence: z.array(z.string()) })),
};

const facetsOutput = {
  categories: z.array(z.object({ slug: z.string(), name: z.string() })),
  tagsByFacet: z.array(
    z.object({
      facet: z.string(),
      label: z.string(),
      tags: z.array(z.object({ slug: z.string(), name: z.string(), useCount: z.number() })),
    }),
  ),
  audience: z.array(z.object({ value: z.string(), label: z.string() })),
  format: z.array(z.object({ value: z.string(), label: z.string() })),
  status: z.array(z.object({ value: z.string(), label: z.string() })),
};

const seriesOutput = {
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  stats: seriesStatsSchema,
  cadenceLabel: z.string().nullable(),
  typicalStartMonthLabel: z.string().nullable(),
  typicalDeadlineMonthLabel: z.string().nullable(),
  editions: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      editionLabel: z.string().nullable(),
      status: z.string(),
      url: z.string(),
      startAt: datePair,
    }),
  ),
  endorsements: z.object({
    total: z.number(),
    byAudience: z.array(z.object({ value: z.string(), label: z.string(), count: z.number() })),
  }),
};

const connectorSearchOutput = {
  results: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })),
};

const connectorFetchOutput = {
  id: z.string(),
  title: z.string(),
  text: z.string(),
  url: z.string(),
  metadata: eventDetailSchema,
};

export type McpSearchQuery = {
  q?: string;
  category?: string[];
  tag?: string[];
  month?: number[];
  audience?: string;
  format?: "online" | "offline";
  status?: "upcoming" | "ended" | "all";
  sort?: "new" | "start" | "deadline" | "popular" | "recommended";
  page?: number;
  from?: string;
  to?: string;
  deadline?: "open" | "7d" | "30d";
  fee?: "free" | "paid";
  location?: string;
};

export interface McpDataSource {
  searchEvents(query: McpSearchQuery): Promise<McpSearchResult>;
  getEvent(id: string): Promise<McpEventDetail | null>;
  getSeries(id: string): Promise<McpSeriesDetail | null>;
  listFacets(): Promise<McpFacets>;
  /** Published events plus ones that ended recently. */
  loadRecommendCandidates(): Promise<McpRecommendCandidate[]>;
}

export type McpContext = {
  source: McpDataSource;
  origin: string;
  timeZone: string;
  now?: Date;
};

function textResult(markdown: string, structured: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: markdown }],
    structuredContent: structured,
  };
}

function jsonTextResult(data: Record<string, unknown>) {
  return textResult(JSON.stringify(data, null, 2), data);
}

function fail(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

function asStrings(value: string | string[] | undefined, max = 10) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => item.trim()).filter(Boolean).slice(0, max);
}

function asMonths(value: number | number[] | undefined) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.filter((n) => Number.isInteger(n) && n >= 1 && n <= 12))].slice(0, 12);
}

function firstVar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function tokenize(interests: string | undefined) {
  if (!interests) return [];
  return interests
    .split(/[\s,、。・/／]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .map((token) => token.slice(0, 30))
    .slice(0, 10);
}

function categoriesFrom(candidates: McpRecommendCandidate[], keywords: string[]) {
  const byLabel = new Map<string, string>();
  for (const candidate of candidates) {
    for (const category of candidate.categories) {
      byLabel.set(normalizeForMatch(category.slug), category.slug);
      byLabel.set(normalizeForMatch(category.name), category.slug);
    }
  }
  return [
    ...new Set(
      keywords
        .map((keyword) => byLabel.get(normalizeForMatch(keyword)))
        .filter((slug): slug is string => !!slug),
    ),
  ].slice(0, 11);
}

function toRankable(candidate: McpRecommendCandidate): RankableEvent & { candidate: McpRecommendCandidate } {
  const tagNames = candidate.tags.map((tag) => tag.name).join(" ");
  return {
    id: candidate.id,
    title: candidate.title,
    description: [candidate.description, tagNames].filter(Boolean).join("\n"),
    organizer: candidate.organizer,
    location: candidate.location,
    targetAudience: candidate.targetAudience,
    format: candidate.format,
    feeType: candidate.feeType,
    startAt: candidate.startAt,
    applicationDeadline: candidate.applicationDeadline,
    likeCount: candidate.likeCount,
    bookmarkCount: candidate.bookmarkCount,
    categorySlugs: candidate.categories.map((category) => category.slug),
    categoryNames: candidate.categories.map((category) => category.name),
    candidate,
  };
}

async function run(
  name: string,
  fn: () => Promise<{ body: ReturnType<typeof textResult> | ReturnType<typeof fail>; count: number }>,
) {
  const started = Date.now();
  try {
    const { body, count } = await fn();
    console.log(JSON.stringify({ source: "mcp", tool: name, count, ms: Date.now() - started }));
    return body;
  } catch (error) {
    console.log(
      JSON.stringify({
        source: "mcp",
        tool: name,
        count: 0,
        ms: Date.now() - started,
        error: error instanceof Error ? error.name : "Error",
      }),
    );
    return fail("データを取得できませんでした。");
  }
}

/** Constant-time bearer check. Auth is off when `expected` is unset. */
export function bearerAuthorized(authorization: string | null | undefined, expected: string | undefined) {
  if (!expected) return true;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  return timingSafeEqual(match?.[1] ?? "", expected);
}

function timingSafeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const len = Math.max(left.length, right.length, 1);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

export function createMcpServer(ctx: McpContext) {
  const source = ctx.source;
  const fmt: FormatContext = {
    origin: ctx.origin.replace(/\/$/, ""),
    timeZone: ctx.timeZone || "Asia/Tokyo",
    now: ctx.now ?? new Date(),
  };
  const server = new McpServer(
    { name: "event-share", version: "1.0.0" },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      maxToolInputElements: 80,
      instructions: [
        "Event Share の公開イベント情報を読み取り専用で提供します。",
        "個人名、メールアドレス、ユーザー ID は含まれません。",
        "日程・締切・費用はツールの値だけを使い、未登録（null）を推測で埋めないでください。",
        "利用者には公式サイトでの確認を伝えてください。",
        "投稿、ウォッチ、お気に入りなどの書き込みはできません。",
      ].join("\n"),
    },
  );

  server.registerTool(
    "search_events",
    {
      title: "イベントを検索",
      description: `公開中のイベントを条件で検索します。 Search published events. ${VERIFY}`,
      annotations: READ_ONLY,
      inputSchema: {
        q: z.string().trim().max(200).optional().describe("キーワード（空白区切り、200文字以内）"),
        category: slugList.optional().describe("カテゴリ slug。list_facets の値。文字列または配列"),
        tag: slugList.optional().describe("タグ slug。いずれかに一致"),
        month: monthList.optional().describe("開催月 1〜12。いずれかに一致"),
        audience: z.string().trim().max(200).optional().describe("対象者の自由記述（部分一致）"),
        format: z.enum(["online", "offline"]).optional().describe("online は hybrid も含む。offline も同様"),
        status: z.enum(["upcoming", "ended", "all"]).optional().describe("既定は upcoming"),
        sort: z.enum(["new", "start", "deadline", "popular", "recommended"]).optional().describe("既定は start"),
        page: z.number().int().min(1).max(50).optional().describe("ページ（1始まり、最大 50）"),
        from: dateKey.optional().describe("この日以降に終わる（YYYY-MM-DD、アプリのタイムゾーン）"),
        to: dateKey.optional().describe("この日以前に始まる（YYYY-MM-DD）"),
        deadline: z.enum(["open", "7d", "30d"]).optional().describe("応募締切"),
        fee: z.enum(["free", "paid"]).optional(),
        location: z.string().trim().max(200).optional().describe("開催地の部分一致"),
      },
      outputSchema: searchOutput,
    },
    async (args) =>
      run("search_events", async () => {
        const result = await source.searchEvents({
          q: args.q?.trim() || undefined,
          category: asStrings(args.category),
          tag: asStrings(args.tag),
          month: asMonths(args.month),
          audience: args.audience?.trim() || undefined,
          format: args.format,
          status: args.status,
          sort: args.sort,
          page: args.page,
          from: args.from,
          to: args.to,
          deadline: args.deadline,
          fee: args.fee,
          location: args.location?.trim() || undefined,
        });
        const formatted = formatSearchResult(result, fmt);
        return { body: textResult(formatted.markdown, formatted.json), count: result.items.length };
      }),
  );

  server.registerTool(
    "get_event",
    {
      title: "イベントの詳細",
      description: `公開イベントの詳細、タグ、シリーズ、おすすめの集計と一言を返します。名前は含みません。 Get one public event. ${VERIFY}`,
      annotations: READ_ONLY,
      inputSchema: { id: z.string().trim().min(1).max(80).describe("イベント ID。統合済み ID は統合先を返します") },
      outputSchema: eventDetailSchema.shape,
    },
    async ({ id }) =>
      run("get_event", async () => {
        const event = await source.getEvent(id);
        if (!event) return { body: fail("イベントが見つかりません。"), count: 0 };
        const formatted = formatEventDetail(event, fmt);
        return { body: textResult(formatted.markdown, formatted.json), count: 1 };
      }),
  );

  server.registerTool(
    "get_series",
    {
      title: "シリーズの詳細",
      description: `シリーズの回一覧と、周期・例年の時期・おすすめの集計を返します。 Get a series and its editions. ${VERIFY}`,
      annotations: READ_ONLY,
      inputSchema: {
        id: z.string().trim().min(1).max(80).describe("シリーズ ID、または公開中の回の ID"),
      },
      outputSchema: seriesOutput,
    },
    async ({ id }) =>
      run("get_series", async () => {
        const series = await source.getSeries(id);
        if (!series) return { body: fail("シリーズが見つかりません。"), count: 0 };
        const formatted = formatSeries(series, fmt);
        return { body: textResult(formatted.markdown, formatted.json), count: series.editions.length };
      }),
  );

  server.registerTool(
    "recommend_events",
    {
      title: "イベントをおすすめ",
      description: `興味に近い公開中・最近終了したイベントを、一致した事実（evidence）つきで返します。サイト内チャットと同じ順位づけです。 Recommend events with evidence. ${VERIFY}`,
      annotations: READ_ONLY,
      inputSchema: {
        interests: z.string().trim().max(200).optional().describe("興味・キーワード（自由記述）"),
        audience: z.string().trim().max(200).optional().describe("対象。本文・対象者・タグ名に含まれると一致"),
        month: monthList.optional().describe("開催月で絞り込む（1〜12）"),
        limit: z.number().int().min(1).max(20).optional().describe("件数。既定 5、最大 20"),
      },
      outputSchema: recommendOutput,
    },
    async (args) =>
      run("recommend_events", async () => {
        const months = asMonths(args.month);
        const candidates = await source.loadRecommendCandidates();
        const filtered = months.length
          ? candidates.filter((candidate) => candidate.startMonth != null && months.includes(candidate.startMonth))
          : candidates;
        const state = emptyState();
        const keywords = tokenize(args.interests);
        if (args.audience?.trim()) keywords.push(args.audience.trim().slice(0, 30));
        state.keywords = [...new Set(keywords)].slice(0, 10);
        state.categories = categoriesFrom(filtered, state.keywords);
        const ranked = rankEvents(
          filtered.map(toRankable),
          state,
          fmt.now,
          fmt.timeZone,
          Math.max(filtered.length, 1),
        );
        const boosted = ranked.map((row) => ({
          event: row.event.candidate,
          evidence: row.matched,
          score: row.score + Math.min(3, row.event.candidate.endorsementCount * 0.75),
        }));
        boosted.sort(
          (a, b) => b.score - a.score || b.event.endorsementCount - a.event.endorsementCount,
        );
        const limit = Math.min(args.limit ?? 5, 20);
        const hits = boosted.slice(0, limit).map(({ event, evidence }) => ({ event, evidence }));
        const formatted = formatRecommendations(hits, fmt);
        return { body: textResult(formatted.markdown, formatted.json), count: hits.length };
      }),
  );

  server.registerTool(
    "list_facets",
    {
      title: "検索の区分一覧",
      description: `カテゴリ、タグ、対象・形式・状態の候補を返します。検索条件を選ぶ前に使います。 List categories, tags, and enums. ${VERIFY}`,
      annotations: READ_ONLY,
      outputSchema: facetsOutput,
    },
    async () =>
      run("list_facets", async () => {
        const facets = await source.listFacets();
        const formatted = formatFacets(facets);
        const count = facets.categories.length + facets.tagsByFacet.reduce((n, group) => n + group.tags.length, 0);
        return { body: textResult(formatted.markdown, formatted.json), count };
      }),
  );

  server.registerTool(
    "search",
    {
      title: "検索（コネクタ）",
      description: `ChatGPT コネクタ向けの検索です。{ results: [{ id, title, url }] } を返します。 Connector search. ${VERIFY}`,
      annotations: READ_ONLY,
      inputSchema: { query: z.string().trim().min(1).max(200).describe("検索語") },
      outputSchema: connectorSearchOutput,
    },
    async ({ query }) =>
      run("search", async () => {
        const result = await source.searchEvents({ q: query.trim(), status: "all", sort: "recommended", page: 1 });
        const data = connectorSearch(result.items, fmt.origin);
        return { body: jsonTextResult(data), count: data.results.length };
      }),
  );

  server.registerTool(
    "fetch",
    {
      title: "取得（コネクタ）",
      description: `ChatGPT コネクタ向けの取得です。{ id, title, text, url, metadata } を返します。 Connector fetch. ${VERIFY}`,
      annotations: READ_ONLY,
      inputSchema: { id: z.string().trim().min(1).max(80).describe("search が返した ID") },
      outputSchema: connectorFetchOutput,
    },
    async ({ id }) =>
      run("fetch", async () => {
        const event = await source.getEvent(id);
        if (!event) return { body: fail("イベントが見つかりません。"), count: 0 };
        const data = connectorFetch(event, fmt);
        return { body: jsonTextResult(data), count: 1 };
      }),
  );

  server.registerResource(
    "event",
    new ResourceTemplate("eventshare://events/{id}", { list: undefined }),
    {
      title: "イベント",
      description: `公開イベントの詳細（Markdown）。人名は含みません。 ${MCP_DISCLAIMER}`,
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const id = firstVar(variables.id)?.trim();
      const event = id ? await source.getEvent(id) : null;
      if (!event) throw new Error("イベントが見つかりません。");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: formatEventDetail(event, fmt).markdown }],
      };
    },
  );

  server.registerResource(
    "series",
    new ResourceTemplate("eventshare://series/{id}", { list: undefined }),
    {
      title: "シリーズ",
      description: `シリーズと回の一覧（Markdown）。人名は含みません。 ${MCP_DISCLAIMER}`,
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const id = firstVar(variables.id)?.trim();
      const series = id ? await source.getSeries(id) : null;
      if (!series) throw new Error("シリーズが見つかりません。");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: formatSeries(series, fmt).markdown }],
      };
    },
  );

  server.registerResource(
    "facets",
    "eventshare://facets",
    {
      title: "検索の区分",
      description: "カテゴリ、タグ、対象・形式・状態の一覧（Markdown）。",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const facets = await source.listFacets();
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: formatFacets(facets).markdown }],
      };
    },
  );

  server.registerPrompt(
    "find_events",
    {
      title: "イベントを探す",
      description: "興味と対象から、募集中のイベントと例年の時期を調べる手順です。 Find events for a student's interests.",
      argsSchema: {
        interests: z.string().trim().min(1).max(200).describe("興味・キーワード"),
        audience: z.string().trim().max(200).optional().describe("対象（任意。例: 中学生、初心者）"),
      },
    },
    async ({ interests, audience }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `興味: ${interests}`,
              `対象: ${audience?.trim() || "指定なし"}`,
              "",
              "Event Share の公開情報だけを使って、次の順で調べてください。",
              "1. recommend_events を呼び、返ってきた evidence（根拠）を添えて候補を挙げる。",
              "2. 有望な候補は get_event で詳細を確認する。シリーズの例年の時期は get_series でも確認する。",
              "3. 募集中のものと、例年この時期に募集があるもの（isRecurringSoon）の両方に触れる。",
              "4. 日程・締切・費用・公式 URL はツールが返した値だけを書く。未登録は「不明」。推測で日付を埋めない。",
              "5. 公式サイトで最新情報を確認するよう、必ず伝える。例年の傾向は予定ではない。",
              "6. 投稿した人や一言を書いた人の名前は出さない（ツールも返しません）。",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
