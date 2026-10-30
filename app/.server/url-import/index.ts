import { z } from "zod";
import { normalizeForMatch } from "~/lib/text";
import type { AiClient } from "../ai/client";
import { EVENT_FORMATS, FEE_TYPES } from "../db/schema";
import {
  extractEventFromHtml,
  parseIsoDate,
  type DraftField,
  type Extraction,
} from "./extract";
import { decodeHtml, FetchBlockedError, safeFetch, USER_AGENT } from "./fetcher";
import { isAllowedByRobots } from "./robots";
import type { Resolver } from "./ssrf";

export type ImportResult =
  | ({ ok: true; usedAi: boolean } & Extraction)
  | { ok: false; error: string };

type Deps = {
  ai: AiClient | null;
  timeZone: string;
  now: Date;
  resolver?: Resolver;
  fetchImpl?: typeof fetch;
};

async function robotsAllows(url: URL, deps: Deps) {
  try {
    const res = await safeFetch(`${url.origin}/robots.txt`, {
      resolver: deps.resolver,
      fetchImpl: deps.fetchImpl,
      maxBytes: 256 * 1024,
      timeoutMs: 4000,
      accept: "text/plain",
      allowedTypes: /text\/plain|^$/i,
    });
    const text = new TextDecoder().decode(res.bytes);
    return isAllowedByRobots(text, `${url.pathname}${url.search}`, "EventShareBot");
  } catch {
    // No robots.txt (404 etc.) → allowed.
    return true;
  }
}

const aiExtractionSchema = z.object({
  title: z.string().max(200).nullable(),
  summary: z.string().max(1200).nullable(),
  startDate: z.string().max(40).nullable(),
  endDate: z.string().max(40).nullable(),
  applicationDeadline: z.string().max(40).nullable(),
  location: z.string().max(200).nullable(),
  format: z.enum(EVENT_FORMATS).nullable(),
  organizer: z.string().max(120).nullable(),
  targetAudience: z.string().max(200).nullable(),
  feeType: z.enum(FEE_TYPES).nullable(),
  feeDetail: z.string().max(200).nullable(),
});

/** The month/day of an AI-supplied date must literally appear in the page. */
function dateAppearsInText(date: Date, text: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!month || !day) return false;
  const t = text.normalize("NFKC");
  const re = new RegExp(
    `(?<!\\d)0?${month}\\s*(?:月|/|\\.|-)\\s*0?${day}(?!\\d)`,
  );
  return re.test(t);
}

/** Free-text values from the AI must be grounded in the page text. */
function grounded(value: string | null, text: string) {
  if (!value) return null;
  const v = normalizeForMatch(value);
  return v.length >= 2 && normalizeForMatch(text).includes(v) ? value : null;
}

async function enrichWithAi(extraction: Extraction, deps: Deps) {
  const { draft, sources, pageText } = extraction;
  const missing = (
    [
      "title",
      "description",
      "startAt",
      "endAt",
      "applicationDeadline",
      "location",
      "format",
      "organizer",
      "targetAudience",
      "feeType",
    ] as DraftField[]
  ).filter((k) => draft[k] === null);
  if (!deps.ai || missing.length === 0 || pageText.length < 40) return false;

  const result = await deps.ai.generateJson({
    system:
      "あなたはWebページからイベント情報を抽出するアシスタントです。ページ本文に明記されている情報だけを抽出し、書かれていない項目は必ず null にしてください。推測や補完は禁止です。日付は ISO 8601 (YYYY-MM-DDTHH:mm、時刻不明なら YYYY-MM-DD) で、タイムゾーンは日本時間として出力してください。summary は本文に基づく200字程度の日本語の概要です。",
    user: `ページ本文:\n"""\n${pageText.slice(0, 6000)}\n"""`,
    schema: aiExtractionSchema,
    maxTokens: 900,
  });
  if (!result) return false;

  const tz = deps.timeZone;
  const apply = (key: DraftField, value: unknown) => {
    if (value === null || value === undefined || draft[key] !== null) return;
    (draft as Record<string, unknown>)[key] = value;
    sources[key] = "ai";
  };
  const checkedDate = (v: string | null, endOfDay = false) => {
    const d = parseIsoDate(v, tz, endOfDay);
    return d && dateAppearsInText(d, pageText, tz) ? d : null;
  };

  apply("title", grounded(result.title, pageText));
  apply("description", result.summary);
  apply("startAt", checkedDate(result.startDate));
  apply("endAt", checkedDate(result.endDate, true));
  apply("applicationDeadline", checkedDate(result.applicationDeadline, true));
  apply("location", grounded(result.location, pageText));
  apply("organizer", grounded(result.organizer, pageText));
  apply("targetAudience", grounded(result.targetAudience, pageText));
  if (result.format && result.format !== "unknown") apply("format", result.format);
  if (result.feeType && result.feeType !== "unknown") apply("feeType", result.feeType);
  apply("feeDetail", grounded(result.feeDetail, pageText));
  return true;
}

export async function importEventFromUrl(input: string, deps: Deps): Promise<ImportResult> {
  try {
    const target = new URL(input);
    if (!(await robotsAllows(target, deps))) {
      return {
        ok: false,
        error: "このサイトは自動取得を許可していません。お手数ですが手動で入力してください。",
      };
    }
    const page = await safeFetch(input, {
      resolver: deps.resolver,
      fetchImpl: deps.fetchImpl,
      maxBytes: 2 * 1024 * 1024,
      accept: "text/html,application/xhtml+xml",
      allowedTypes: /text\/html|application\/xhtml\+xml/i,
    });
    const html = decodeHtml(page.bytes, page.contentType);
    const extraction = extractEventFromHtml(html, page.url, {
      timeZone: deps.timeZone,
      now: deps.now,
    });
    const usedAi = await enrichWithAi(extraction, deps);
    if (!extraction.draft.title) {
      return { ok: false, error: "ページからイベント情報を読み取れませんでした。手動で入力してください。" };
    }
    return { ok: true, usedAi, ...extraction };
  } catch (error) {
    if (error instanceof FetchBlockedError) return { ok: false, error: error.message };
    console.warn("URL import failed:", (error as Error).name);
    return { ok: false, error: "ページを取得できませんでした。URLを確認するか、手動で入力してください。" };
  }
}

export { USER_AGENT };
