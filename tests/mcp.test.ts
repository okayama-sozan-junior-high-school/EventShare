import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  eventPageUrl,
  formatEventDetail,
  formatMcpDate,
  formatRecommendations,
  formatSearchResult,
  type McpEventDetail,
  type McpEventSummary,
  type McpRecommendCandidate,
} from "~/.server/mcp/format";
import { bearerAuthorized, createMcpServer, type McpDataSource } from "~/.server/mcp/server";

const ORIGIN = "http://localhost:5173";
const NOW = new Date("2026-11-01T03:00:00.000Z");
const START = new Date("2026-11-03T04:00:00.000Z");
const SECRET_NAME = "山田太郎";
const SECRET_EMAIL = "student@example.com";

const BANNED_KEYS = ["createdBy", "created_by", "userId", "userName", "email", "author", "displayName"];

function keysOf(value: unknown, keys = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      keysOf(child, keys);
    }
  }
  return keys;
}

function summary(): McpEventSummary & { createdBy: string; email: string } {
  return {
    id: "evt-1",
    title: "プログラミング体験会",
    excerpt: "初心者向けのプログラミング体験会です。",
    startAt: START,
    endAt: null,
    applicationDeadline: new Date("2026-11-20T04:00:00.000Z"),
    location: "岡山市",
    format: "offline",
    feeType: "free",
    organizer: "市民活動センター",
    targetAudience: "中高生",
    officialUrl: "https://example.com/prog",
    applicationUrl: null,
    imageUrl: "/media/cover",
    categories: [{ slug: "programming", name: "プログラミング" }],
    tags: [{ slug: "beginner", name: "初心者歓迎", facet: "audience" }],
    endorsementCount: 4,
    editionLabel: "2026",
    seriesId: "series-1",
    series: {
      id: "series-1",
      title: "プログラミング体験会シリーズ",
      stats: {
        count: 2,
        cadence: "yearly",
        typicalStartMonth: 11,
        typicalDeadlineMonth: 10,
        isRecurringSoon: false,
      },
    },
    createdBy: SECRET_NAME,
    email: SECRET_EMAIL,
  };
}

function detail(): McpEventDetail & { createdBy: string; email: string } {
  return {
    ...summary(),
    description: "初心者向けのプログラミング体験会です。",
    feeDetail: null,
    sources: [{ url: "https://example.com/prog", kind: "official" }],
    endorsements: {
      total: 4,
      byAudience: [
        { value: "beginner_ok", label: "初めてでも大丈夫", count: 3 },
        { value: "experienced", label: "経験者向け", count: 1 },
        { value: "anyone", label: "誰にでも", count: 0 },
      ],
      comments: [{ audience: "beginner_ok", comment: "説明が分かりやすかった" }],
    },
    activities: [{ title: "参加しました", summary: "作品を作りました" }],
    editions: [
      {
        id: "evt-0",
        title: "プログラミング体験会",
        startAt: new Date("2025-11-03T04:00:00.000Z"),
        status: "published",
        editionLabel: "2025",
      },
      {
        id: "evt-1",
        title: "プログラミング体験会",
        startAt: START,
        status: "published",
        editionLabel: "2026",
      },
    ],
    previousEditionId: "evt-0",
    nextEditionId: null,
    resolvedFrom: null,
  };
}

function candidate(): McpRecommendCandidate & { createdBy: string; email: string } {
  return {
    ...summary(),
    description: "初心者向けのプログラミング体験会です。",
    likeCount: 2,
    bookmarkCount: 1,
    startMonth: 11,
  };
}

function source(): McpDataSource {
  const event = detail();
  return {
    async searchEvents(query) {
      const q = query.q?.trim();
      const matches = !q || event.title.includes(q) || (event.description ?? "").includes(q);
      return {
        items: matches ? [event] : [],
        total: matches ? 1 : 0,
        page: 1,
        pageCount: matches ? 1 : 0,
        pageSize: 12,
      };
    },
    async getEvent(id) {
      return id === "evt-1" ? event : null;
    },
    async getSeries(id) {
      if (id !== "series-1" && id !== "evt-1") return null;
      return {
        id: "series-1",
        title: "プログラミング体験会シリーズ",
        description: "毎年開いている体験会です。",
        stats: event.series!.stats,
        editions: event.editions,
        endorsements: { total: 4, byAudience: event.endorsements.byAudience },
      };
    },
    async listFacets() {
      return {
        categories: [{ slug: "programming", name: "プログラミング" }],
        tagsByFacet: [
          {
            facet: "audience",
            label: "対象",
            tags: [{ slug: "beginner", name: "初心者歓迎", useCount: 3 }],
          },
        ],
        audience: [{ value: "beginner_ok", label: "初めてでも大丈夫" }],
        format: [{ value: "offline", label: "オフライン（会場）" }],
        status: [{ value: "upcoming", label: "開催予定（終了していない）" }],
      };
    },
    async loadRecommendCandidates() {
      return [candidate()];
    },
  };
}

function textOf(result: { content?: unknown }) {
  if (!Array.isArray(result.content)) return "";
  const block = result.content.find(
    (item) => item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item,
  );
  return block && typeof block === "object" && "text" in block && typeof block.text === "string" ? block.text : "";
}

async function withClient(fn: (client: Client) => Promise<void>) {
  const mcp = createMcpServer({
    source: source(),
    origin: ORIGIN,
    timeZone: "Asia/Tokyo",
    now: NOW,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await mcp.close();
  }
}

describe("format", () => {
  const ctx = { origin: `${ORIGIN}/`, timeZone: "Asia/Tokyo", now: NOW };

  it("formats dates in UTC and Asia/Tokyo, and leaves missing values null", () => {
    expect(formatMcpDate(START, "Asia/Tokyo")).toEqual({
      iso: "2026-11-03T04:00:00.000Z",
      text: "2026年11月3日(火) 13:00",
    });
    expect(formatMcpDate(null, "Asia/Tokyo")).toEqual({ iso: null, text: null });
    expect(eventPageUrl(`${ORIGIN}/`, "evt-1")).toBe(`${ORIGIN}/events/evt-1`);
    expect(absoluteUrl(ORIGIN, "/media/cover")).toBe(`${ORIGIN}/media/cover`);
    expect(absoluteUrl(ORIGIN, "https://example.com/prog")).toBe("https://example.com/prog");
    expect(absoluteUrl(ORIGIN, null)).toBeNull();
  });

  it("does not copy personal fields into search or detail JSON", () => {
    const event = detail();
    const search = formatSearchResult(
      { items: [event], total: 1, page: 1, pageCount: 1, pageSize: 12 },
      ctx,
    );
    expect(search.markdown).toContain("プログラミング体験会");
    expect(search.markdown).toContain("2026年11月3日(火) 13:00");
    expect(search.markdown).toContain("2026-11-03T04:00:00.000Z");
    expect(search.json.events[0].location).toBe("岡山市");
    expect(search.json.events[0].endAt).toEqual({ iso: null, text: null });
    expect(search.json.events[0].url).toBe(`${ORIGIN}/events/evt-1`);
    expect(search.json.events[0].imageUrl).toBe(`${ORIGIN}/media/cover`);

    const full = formatEventDetail(event, ctx);
    const blob = `${search.markdown}\n${full.markdown}\n${JSON.stringify(search.json)}\n${JSON.stringify(full.json)}`;
    expect(blob).toContain("説明が分かりやすかった");
    expect(blob).not.toContain(SECRET_NAME);
    expect(blob).not.toContain(SECRET_EMAIL);
    for (const key of BANNED_KEYS) {
      expect(keysOf(search.json).has(key)).toBe(false);
      expect(keysOf(full.json).has(key)).toBe(false);
    }
  });

  it("includes rank evidence and still omits personal fields", () => {
    const formatted = formatRecommendations(
      [{ event: candidate(), evidence: ["「プログラミング」に関連", "参加費無料"] }],
      ctx,
    );
    expect(formatted.markdown).toContain("「プログラミング」に関連");
    expect(formatted.json.events[0].evidence).toEqual(["「プログラミング」に関連", "参加費無料"]);
    expect(JSON.stringify(formatted.json)).not.toContain(SECRET_NAME);
    expect(keysOf(formatted.json).has("likeCount")).toBe(false);
    expect(keysOf(formatted.json).has("email")).toBe(false);
  });
});

describe("bearer auth", () => {
  it("allows everyone when no token is configured", () => {
    expect(bearerAuthorized(null, undefined)).toBe(true);
  });

  it("requires an exact bearer token when one is configured", () => {
    expect(bearerAuthorized(null, "secret")).toBe(false);
    expect(bearerAuthorized("Bearer wrong", "secret")).toBe(false);
    expect(bearerAuthorized("Bearer secret-extra", "secret")).toBe(false);
    expect(bearerAuthorized("bearer secret", "secret")).toBe(true);
  });
});

describe("MCP server", () => {
  it("lists the seven tools", async () => {
    await withClient(async (client) => {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
        ["fetch", "get_event", "get_series", "list_facets", "recommend_events", "search", "search_events"].sort(),
      );
    });
  });

  it("returns a search result without author names", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "search_events", arguments: {} });
      const text = textOf(result);
      expect(result.isError).not.toBe(true);
      expect(text).toContain("プログラミング体験会");
      expect(text).not.toContain(SECRET_NAME);
      expect(text).not.toContain(SECRET_EMAIL);
      expect(keysOf(result.structuredContent).has("createdBy")).toBe(false);
    });
  });

  it("reports an unknown event as a tool error", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "get_event", arguments: { id: "missing" } });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("見つかりません");
    });
  });

  it("returns connector search and fetch shapes", async () => {
    await withClient(async (client) => {
      const search = await client.callTool({ name: "search", arguments: { query: "プログラミング" } });
      const searchBody = JSON.parse(textOf(search)) as { results: { id: string; title: string; url: string }[] };
      expect(searchBody.results).toEqual([
        { id: "evt-1", title: "プログラミング体験会", url: `${ORIGIN}/events/evt-1` },
      ]);

      const fetched = await client.callTool({ name: "fetch", arguments: { id: "evt-1" } });
      const body = JSON.parse(textOf(fetched)) as {
        id: string;
        title: string;
        text: string;
        url: string;
        metadata: { officialUrl: string | null };
      };
      expect(body.id).toBe("evt-1");
      expect(body.title).toBe("プログラミング体験会");
      expect(body.url).toBe(`${ORIGIN}/events/evt-1`);
      expect(body.text).toContain("プログラミング体験会");
      expect(body.metadata.officialUrl).toBe("https://example.com/prog");
      expect(body.text).not.toContain(SECRET_NAME);
    });
  });

  it("includes a seeded tag in list_facets and evidence in recommendations", async () => {
    await withClient(async (client) => {
      const facets = await client.callTool({ name: "list_facets", arguments: {} });
      expect(textOf(facets)).toContain("初心者歓迎");

      const recommended = await client.callTool({
        name: "recommend_events",
        arguments: { interests: "プログラミング", limit: 5 },
      });
      const text = textOf(recommended);
      expect(text).toContain("プログラミング体験会");
      expect(text).toContain("根拠");
      const structured = recommended.structuredContent as { events: { evidence: string[] }[] };
      expect(structured.events[0].evidence.some((item) => item.includes("プログラミング"))).toBe(true);

      const narrowed = await client.callTool({
        name: "recommend_events",
        arguments: { interests: "プログラミング", month: [1] },
      });
      expect(textOf(narrowed)).toContain("見つかりません");
    });
  });

  it("reads resources and the find_events prompt", async () => {
    await withClient(async (client) => {
      const event = await client.readResource({ uri: "eventshare://events/evt-1" });
      expect(event.contents[0].text).toContain("プログラミング体験会");
      const facets = await client.readResource({ uri: "eventshare://facets" });
      expect(facets.contents[0].text).toContain("初心者歓迎");
      const prompt = await client.getPrompt({
        name: "find_events",
        arguments: { interests: "プログラミング", audience: "中学生" },
      });
      const content = prompt.messages[0].content;
      expect(content).toMatchObject({ type: "text" });
      if (content.type === "text") {
        expect(content.text).toContain("recommend_events");
        expect(content.text).toContain("get_event");
        expect(content.text).toContain("公式サイト");
      }
    });
  });
});
