import { DEFAULT_TIME_ZONE, zonedParts } from "./datetime";

/**
 * Edition markers in event titles ("2025", "第4回", "Vol.3", …).
 *
 * Matching runs on a width-folded copy of the title (full-width ASCII →
 * ASCII, U+3000 → space, ‘’ → '). Folding keeps every character at the same
 * index, so match positions can be applied to the original string and the
 * user's own characters are preserved when stripping or incrementing.
 *
 * Deliberately conservative: bare numbers are never markers. Only 4-digit
 * years (1900-2099) or numbers with an explicit marker are recognised, so
 * `U-18`, `24時間`, `3D` and `2000m走` are left alone.
 */

type Kind = "year" | "ordinal";

type Marker = {
  kind: Kind;
  start: number;
  end: number;
  /** Position of the number to increment. */
  numStart: number;
  numEnd: number;
  /** Western year for `year`, edition number for `ordinal`. */
  value: number;
  label: string;
  next: string;
};

type Rule = {
  kind: Kind;
  re: RegExp;
  /** Index of the capture group holding the number. */
  group: number;
  /** `next` also replaces everything after the number (1st → 2nd). */
  nextIncludesSuffix?: boolean;
  build: (m: RegExpExecArray, raw: string) => { value: number; label: string; next: string } | null;
};

const KANJI_DIGITS = "〇一二三四五六七八九";

function kanjiToNumber(s: string) {
  if (s.includes("十")) {
    const [tens, ones] = s.split("十");
    if (tens.length > 1 || ones.length > 1) return null;
    const t = tens ? KANJI_DIGITS.indexOf(tens) : 1;
    const o = ones ? KANJI_DIGITS.indexOf(ones) : 0;
    return t < 1 || o < 0 ? null : t * 10 + o;
  }
  let n = 0;
  for (const c of s) {
    const d = KANJI_DIGITS.indexOf(c);
    if (d < 0) return null;
    n = n * 10 + d;
  }
  return n;
}

function numberToKanji(n: number) {
  if (n >= 100) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (tens === 0) return KANJI_DIGITS[ones];
  return `${tens > 1 ? KANJI_DIGITS[tens] : ""}十${ones ? KANJI_DIGITS[ones] : ""}`;
}

const isFullWidth = (s: string) => /[０-９]/.test(s);
const toFullWidth = (s: string) =>
  s.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
/** Same digit width as `raw` (the original, unfolded number). */
const sameWidth = (raw: string, digits: string) => (isFullWidth(raw) ? toFullWidth(digits) : digits);

function ordinalSuffix(n: number) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
}

/** Units that mark a 4-digit number as a quantity, not a year. */
const UNIT = String.raw`(?:人|名|円|万|億|件|個|本|枚|点|字|社|校|時間|分|秒|km|kg|cm|mm|m(?![a-z]))`;

// Rules are listed by priority: on overlap the earlier rule wins.
const RULES: Rule[] = [
  {
    // FY2025 / FY25
    kind: "year",
    re: /(?<![A-Za-z0-9])FY ?(\d{4}|\d{2})(?![0-9])/dgi,
    group: 1,
    build: (m, raw) => {
      const d = m[1];
      const year = d.length === 2 ? 2000 + Number(d) : Number(d);
      const next = d.length === 2 ? String((Number(d) + 1) % 100).padStart(2, "0") : String(year + 1);
      return { value: year, label: `${year}年度`, next: sameWidth(raw, next) };
    },
  },
  {
    // 令和7年度 / 平成31年 / 令和元年
    kind: "year",
    re: /(令和|平成) ?(\d{1,2}|元) ?年(度)?/dg,
    group: 2,
    build: (m, raw) => {
      const n = m[2] === "元" ? 1 : Number(m[2]);
      const year = (m[1] === "令和" ? 2018 : 1988) + n;
      return { value: year, label: m[3] ? `${year}年度` : String(year), next: sameWidth(raw, String(n + 1)) };
    },
  },
  {
    // 2025 / 2025年 / 2025年度 (not 2000人, 2000m, 1,2025, ¥2025, #2025)
    kind: "year",
    re: new RegExp(String.raw`(?<![0-9¥￥$,.#])((?:19|20)\d{2})(?![0-9]|[,.]\d| ?${UNIT})(?: ?(年度|年))?`, "dgi"),
    group: 1,
    build: (m, raw) => {
      const year = Number(m[1]);
      return {
        value: year,
        label: m[2] === "年度" ? `${year}年度` : String(year),
        next: sameWidth(raw, String(year + 1)),
      };
    },
  },
  {
    // '25
    kind: "year",
    re: /(?<![0-9])'(\d{2})(?![0-9])/dg,
    group: 1,
    build: (m, raw) => {
      const year = 2000 + Number(m[1]);
      return {
        value: year,
        label: String(year),
        next: sameWidth(raw, String((Number(m[1]) + 1) % 100).padStart(2, "0")),
      };
    },
  },
  {
    // 第4回 / 第４期 / 第十回
    kind: "ordinal",
    re: /第 ?([0-9]+|[〇一二三四五六七八九十]+) ?(回|期)/dg,
    group: 1,
    build: (m, raw) => {
      const kanji = !/^[0-9]+$/.test(m[1]);
      const n = kanji ? kanjiToNumber(m[1]) : Number(m[1]);
      if (n === null || n < 1) return null;
      return {
        value: n,
        label: `第${n}${m[2]}`,
        next: kanji ? numberToKanji(n + 1) : sameWidth(raw, String(n + 1)),
      };
    },
  },
  {
    // Vol.3 / vol 3 / VOL.12
    kind: "ordinal",
    re: /(?<![A-Za-z])vol\.? ?(\d{1,4})(?![0-9])/dgi,
    group: 1,
    build: (m, raw) => {
      const n = Number(m[1]);
      return { value: n, label: `Vol.${n}`, next: sameWidth(raw, String(n + 1)) };
    },
  },
  {
    // #12 (not part of a word, an HTML entity or a longer token)
    kind: "ordinal",
    re: /(?<![\w#&])#(\d{1,4})(?![0-9A-Za-z])/dg,
    group: 1,
    build: (m, raw) => {
      const n = Number(m[1]);
      return { value: n, label: `#${n}`, next: sameWidth(raw, String(n + 1)) };
    },
  },
  {
    // 1st / 2nd / 3rd / 10th / 4 th — the suffix is part of `next`
    kind: "ordinal",
    re: /(?<![0-9A-Za-z])(\d{1,3}) ?(st|nd|rd|th)(?![A-Za-z])/dgi,
    group: 1,
    nextIncludesSuffix: true,
    build: (m, raw) => {
      const n = Number(m[1]);
      if (n < 1) return null;
      const upper = m[2] === m[2].toUpperCase();
      const suffix = ordinalSuffix(n + 1);
      return {
        value: n,
        label: `${n}${ordinalSuffix(n)}`,
        next: `${sameWidth(raw, String(n + 1))}${upper ? suffix.toUpperCase() : suffix}`,
      };
    },
  },
];

function fold(s: string) {
  return s
    .replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ")
    .replace(/[\u2018\u2019]/g, "'");
}

function findMarkers(title: string): Marker[] {
  const folded = fold(title);
  const found: Marker[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(folded); m; m = rule.re.exec(folded)) {
      const [start, end] = m.indices![0];
      if (found.some((f) => start < f.end && f.start < end)) continue;
      const [numStart, numEnd] = m.indices![rule.group];
      const built = rule.build(m, title.slice(numStart, numEnd));
      if (!built) continue;
      found.push({
        kind: rule.kind,
        start,
        end,
        numStart,
        numEnd: rule.nextIncludesSuffix ? end : numEnd,
        ...built,
      });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

const SEP = String.raw`\-–—―~〜～/／|｜:：・,、`;
const OPEN = String.raw`(（\[［【「『〈《<〔`;
const CLOSE = String.raw`)）\]］】」』〉》>〕`;
const EMPTY_BRACKETS = new RegExp(`[${OPEN}][\\s${SEP}]*[${CLOSE}]`, "g");
const SEP_RUN = new RegExp(`\\s*([${SEP}])(?:\\s*[${SEP}])+\\s*`, "g");
const EDGE_SEP = new RegExp(`^[\\s${SEP}.]+|[\\s${SEP}.]+$`, "g");

/**
 * Title with edition markers removed: `高校生AIハッカソン 2025` →
 * `高校生AIハッカソン`. Leftover empty brackets and separators are cleaned
 * up. Returns the trimmed title unchanged when no marker is found, and may
 * return an empty string when the title consists only of markers.
 */
export function stripEditionMarkers(title: string) {
  const markers = findMarkers(title);
  if (markers.length === 0) return title.trim();
  let out = title;
  for (const m of [...markers].reverse()) {
    out = `${out.slice(0, m.start)} ${out.slice(m.end)}`;
  }
  let prev;
  do {
    prev = out;
    out = out.replace(EMPTY_BRACKETS, " ");
  } while (out !== prev);
  return out
    .replace(SEP_RUN, " $1 ")
    .replace(/[\s\u3000]+/g, " ")
    .replace(EDGE_SEP, "")
    .trim();
}

/**
 * Suggested title for the next edition: every year and edition number is
 * advanced by one (`第4回 … 2025` → `第5回 … 2026`). Returns the title
 * unchanged when it has no markers.
 */
export function suggestNextTitle(title: string) {
  let out = title;
  for (const m of findMarkers(title).reverse()) {
    out = `${out.slice(0, m.numStart)}${m.next}${out.slice(m.numEnd)}`;
  }
  return out;
}

const MAX_LABEL_LENGTH = 30;

/**
 * Edition label such as `2025`, `2025年度`, `第4回` or `2025 第4回`, taken
 * from the title; falls back to the start year in `timeZone`. Null when
 * neither is available.
 */
export function editionLabelFrom(
  title: string,
  startAt?: Date | null,
  timeZone: string = DEFAULT_TIME_ZONE,
) {
  const markers = findMarkers(title);
  const year = markers.find((m) => m.kind === "year");
  const ordinal = markers.find((m) => m.kind === "ordinal");
  const label = [year?.label, ordinal?.label].filter(Boolean).join(" ");
  if (label) return label.slice(0, MAX_LABEL_LENGTH);
  if (startAt) return String(zonedParts(startAt, timeZone).year);
  return null;
}
