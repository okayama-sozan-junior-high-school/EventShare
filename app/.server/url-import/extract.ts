import { zonedLocalToDate, zonedParts } from "~/lib/datetime";
import { safeExternalUrl } from "~/lib/url";
import type { EventFormat, FeeType } from "../db/schema";

export type ImportedDraft = {
  title: string | null;
  description: string | null;
  startAt: Date | null;
  endAt: Date | null;
  applicationDeadline: Date | null;
  location: string | null;
  format: EventFormat | null;
  organizer: string | null;
  targetAudience: string | null;
  feeType: FeeType | null;
  feeDetail: string | null;
  officialUrl: string | null;
  applicationUrl: string | null;
  imageUrl: string | null;
};

export type DraftField = keyof ImportedDraft;
/** Where a value came from: shown to the user so they can double-check. */
export type FieldSource = "structured" | "meta" | "text" | "ai";

export type Extraction = {
  draft: ImportedDraft;
  sources: Partial<Record<DraftField, FieldSource>>;
  pageText: string;
};

export function emptyDraft(): ImportedDraft {
  return {
    title: null,
    description: null,
    startAt: null,
    endAt: null,
    applicationDeadline: null,
    location: null,
    format: null,
    organizer: null,
    targetAudience: null,
    feeType: null,
    feeDetail: null,
    officialUrl: null,
    applicationUrl: null,
    imageUrl: null,
  };
}

// ---------------------------------------------------------------------------
// HTML helpers (string based so they run anywhere and are unit-testable)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  yen: "¥",
  copy: "©",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

function clean(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const v = decodeEntities(value).replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function parseAttributes(tag: string) {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

export function extractMeta(html: string) {
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const a = parseAttributes(tag);
    const key = (a.property ?? a.name ?? a.itemprop)?.toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content;
  }
  return meta;
}

export function extractTitle(html: string) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? clean(m[1], 200) : null;
}

export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/dt|\/dd|\/th|\/td|\/section|\/article)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\u00a0\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Parse ISO-8601 (with or without offset). Values without offset use `timeZone`. */
export function parseIsoDate(value: unknown, timeZone: string, endOfDay = false) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(v);
  if (dateOnly) {
    return zonedLocalToDate(`${dateOnly[1]}T${endOfDay ? "23:59" : "00:00"}`, timeZone);
  }
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(v);
  if (local) return zonedLocalToDate(`${local[1]}T${local[2]}`, timeZone);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const pad = (n: number | string) => String(n).padStart(2, "0");

/**
 * Parse the first Japanese / numeric date in `text`, e.g. `2026年11月3日 13:00`,
 * `2026/11/3`, `11月3日(火)`. The year defaults to the year of `reference`
 * (rolled forward if the date would be more than 60 days in the past).
 */
export function parseJapaneseDate(
  text: string,
  options: { timeZone: string; reference: Date; endOfDay?: boolean },
) {
  const t = text.normalize("NFKC");
  const re =
    /(?:(\d{4})\s*[年/.\-]\s*)?(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?(?:\s*[(（][^)）]{1,6}[)）])?(?:\s*(\d{1,2})\s*[:時]\s*(\d{2})?)?/;
  const m = re.exec(t);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year = y ? Number(y) : zonedParts(options.reference, options.timeZone).year;
  const time = h
    ? `${pad(h)}:${pad(mi ?? "00")}`
    : options.endOfDay
      ? "23:59"
      : "00:00";
  let date = zonedLocalToDate(`${year}-${pad(month)}-${pad(day)}T${time}`, options.timeZone);
  if (date && !y && date.getTime() < options.reference.getTime() - 60 * 86_400_000) {
    year += 1;
    date = zonedLocalToDate(`${year}-${pad(month)}-${pad(day)}T${time}`, options.timeZone);
  }
  return date;
}

// ---------------------------------------------------------------------------
// JSON-LD (schema.org/Event)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function isEventType(type: unknown) {
  return asArray(type as string | string[]).some(
    (t) => typeof t === "string" && /Event$/.test(t.replace(/^.*[/#]/, "")),
  );
}

function findEventObjects(node: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 6 || !node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) findEventObjects(n, out, depth + 1);
    return out;
  }
  const obj = node as Json;
  if (isEventType(obj["@type"])) out.push(obj);
  if (obj["@graph"]) findEventObjects(obj["@graph"], out, depth + 1);
  return out;
}

export function extractJsonLdEvents(html: string) {
  const events: Json[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      findEventObjects(JSON.parse(m[1].trim()), events);
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return events;
}

function nameOf(v: unknown): string | null {
  if (typeof v === "string") return clean(v, 120);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return clean((v as Json).name, 120);
  }
  return null;
}

function locationOf(v: unknown): { text: string | null; online: boolean; offline: boolean } {
  let online = false;
  let offline = false;
  const texts: string[] = [];
  for (const loc of asArray(v)) {
    if (typeof loc === "string") {
      texts.push(loc);
      offline = true;
      continue;
    }
    if (!loc || typeof loc !== "object") continue;
    const l = loc as Json;
    const type = String(l["@type"] ?? "");
    if (type.includes("VirtualLocation")) {
      online = true;
      continue;
    }
    offline = true;
    const name = clean(l.name, 120);
    const addr = l.address;
    let address: string | null = null;
    if (typeof addr === "string") address = clean(addr, 160);
    else if (addr && typeof addr === "object") {
      const a = addr as Json;
      address = clean(
        [a.addressRegion, a.addressLocality, a.streetAddress]
          .filter((x) => typeof x === "string")
          .join(" "),
        160,
      );
    }
    texts.push([name, address].filter(Boolean).join(" "));
  }
  return { text: clean(texts.filter(Boolean).join(" / "), 200), online, offline };
}

function imageOf(v: unknown, base: URL): string | null {
  for (const img of asArray(v)) {
    const raw = typeof img === "string" ? img : (img as Json | null)?.url;
    if (typeof raw === "string") {
      try {
        return safeExternalUrl(new URL(raw, base).toString());
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function feeOf(offers: unknown): { feeType: FeeType | null; detail: string | null } {
  const list = asArray(offers as Json | Json[]).filter((o) => o && typeof o === "object");
  if (list.length === 0) return { feeType: null, detail: null };
  const prices = list
    .map((o) => ({ price: Number(String(o.price ?? "").replace(/[^\d.]/g, "")), currency: o.priceCurrency }))
    .filter((p) => !Number.isNaN(p.price) && String(p.price) !== "");
  if (prices.length === 0) return { feeType: null, detail: null };
  if (prices.every((p) => p.price === 0)) return { feeType: "free", detail: null };
  const detail = prices
    .map((p) => (p.currency === "JPY" || !p.currency ? `${p.price.toLocaleString("ja-JP")}円` : `${p.price} ${p.currency}`))
    .join(" / ");
  return { feeType: "paid", detail };
}

// ---------------------------------------------------------------------------
// Text heuristics (only used when structured data is missing)
// ---------------------------------------------------------------------------

function labeledLine(text: string, labels: RegExp) {
  const re = new RegExp(`(?:^|\\n)\\s*[【■◆●・]?\\s*(?:${labels.source})\\s*[】]?\\s*[:：]?\\s*([^\\n]{2,100})`);
  const m = re.exec(text);
  return m ? clean(m[1], 120) : null;
}

export function extractFromText(text: string, timeZone: string, reference: Date) {
  const t = text.normalize("NFKC");
  const result: Partial<ImportedDraft> = {};

  const deadlineMatch =
    /(?:応募|申込|申し込み|エントリー|募集|参加登録)?(?:締切|締め切り|〆切|期限|受付終了)[^\d\n]{0,15}((?:\d{4}\s*[年/.\-]\s*)?\d{1,2}\s*[月/.\-]\s*\d{1,2}[^\n]{0,20})/.exec(t);
  if (deadlineMatch) {
    result.applicationDeadline = parseJapaneseDate(deadlineMatch[1], {
      timeZone,
      reference,
      endOfDay: true,
    });
  }
  const dateLine = labeledLine(t, /開催日時|開催日|日時|日程/);
  if (dateLine) result.startAt = parseJapaneseDate(dateLine, { timeZone, reference });

  const location = labeledLine(t, /開催場所|会場|場所/);
  if (location) result.location = location;
  const organizer = labeledLine(t, /主催者|主催/);
  if (organizer) result.organizer = organizer;
  const target = labeledLine(t, /対象者|対象|参加資格|応募資格/);
  if (target) result.targetAudience = target;

  if (/参加費\s*[:：]?\s*無料|参加無料|参加費は無料|無料で参加/.test(t)) {
    result.feeType = "free";
  } else {
    const fee = /参加費\s*[:：]?\s*([\d,]+\s*円[^\n]{0,30})/.exec(t);
    if (fee) {
      result.feeType = "paid";
      result.feeDetail = clean(fee[1], 80);
    }
  }
  if (/オンライン開催|オンラインで開催|オンライン形式|Zoomで開催|オンライン\(Zoom\)/.test(t)) {
    result.format = /会場|ハイブリッド/.test(t) ? "hybrid" : "online";
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function extractEventFromHtml(
  html: string,
  pageUrl: URL,
  options: { timeZone: string; now: Date },
): Extraction {
  const draft = emptyDraft();
  const sources: Extraction["sources"] = {};
  const set = <K extends DraftField>(key: K, value: ImportedDraft[K] | null | undefined, source: FieldSource) => {
    if (value === null || value === undefined || value === "") return;
    if (draft[key] !== null) return;
    draft[key] = value as ImportedDraft[K];
    sources[key] = source;
  };

  const pageText = htmlToText(html);
  draft.officialUrl = pageUrl.toString();

  // 1. schema.org Event (most reliable)
  const ld = extractJsonLdEvents(html)[0];
  if (ld) {
    set("title", clean(ld.name, 120), "structured");
    set("description", clean(ld.description, 2000), "structured");
    set("startAt", parseIsoDate(ld.startDate, options.timeZone), "structured");
    set("endAt", parseIsoDate(ld.endDate, options.timeZone, true), "structured");
    const loc = locationOf(ld.location);
    set("location", loc.text, "structured");
    const mode = String(ld.eventAttendanceMode ?? "");
    const format: EventFormat | null = mode.includes("Mixed")
      ? "hybrid"
      : mode.includes("Online")
        ? "online"
        : mode.includes("Offline")
          ? "offline"
          : loc.online && loc.offline
            ? "hybrid"
            : loc.online
              ? "online"
              : loc.offline
                ? "offline"
                : null;
    set("format", format, "structured");
    set("organizer", asArray(ld.organizer).map(nameOf).filter(Boolean).join("、") || null, "structured");
    const audience = asArray(ld.audience as Json | Json[])
      .map((a) => (typeof a === "string" ? a : clean((a as Json)?.audienceType ?? (a as Json)?.name)))
      .filter(Boolean)
      .join("、");
    set("targetAudience", clean(audience, 200), "structured");
    const fee = feeOf(ld.offers);
    set("feeType", fee.feeType, "structured");
    set("feeDetail", fee.detail, "structured");
    const offerUrl = asArray(ld.offers as Json | Json[]).map((o) => o?.url).find((u) => typeof u === "string");
    if (typeof offerUrl === "string") {
      try {
        set("applicationUrl", safeExternalUrl(new URL(offerUrl, pageUrl).toString()), "structured");
      } catch {
        // ignore
      }
    }
    set("imageUrl", imageOf(ld.image, pageUrl), "structured");
  }

  // 2. OpenGraph / meta tags
  const meta = extractMeta(html);
  set("title", clean(meta["og:title"] ?? meta["twitter:title"], 120) ?? extractTitle(html), "meta");
  set("description", clean(meta["og:description"] ?? meta.description ?? meta["twitter:description"], 2000), "meta");
  const ogImage = meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"];
  if (ogImage) {
    try {
      set("imageUrl", safeExternalUrl(new URL(ogImage, pageUrl).toString()), "meta");
    } catch {
      // ignore
    }
  }

  // 3. Labeled lines in page text (e.g. "締切：11月30日")
  const fromText = extractFromText(pageText, options.timeZone, options.now);
  for (const [key, value] of Object.entries(fromText) as [DraftField, never][]) {
    set(key, value, "text");
  }

  return { draft, sources, pageText: pageText.slice(0, 20_000) };
}
