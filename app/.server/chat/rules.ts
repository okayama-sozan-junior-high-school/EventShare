import type { CategoryInfo, ChatState, Extracted, Slot, Style } from "./types";

/**
 * Deterministic understanding of user messages. Always runs; when an LLM is
 * available its output is merged on top (see extract.ts).
 */

export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  ai: ["ai", "人工知能", "機械学習", "生成ai", "chatgpt", "ディープラーニング", "深層学習", "llm"],
  programming: ["プログラミング", "プログラム", "コード", "コーディング", "アプリ", "ゲーム制作", "ゲーム開発", "python", "web", "エンジニア", "競プロ", "ソフトウェア"],
  research: ["研究", "探究", "論文", "実験", "課題研究", "自由研究"],
  business: ["起業", "ビジネス", "経営", "マーケティング", "投資", "社会課題", "スタートアップ", "お金"],
  design: ["デザイン", "ui", "ux", "イラスト", "アート", "映像", "グラフィック", "絵"],
  science: ["科学", "理科", "物理", "化学", "生物", "数学", "宇宙", "ロボット", "工学", "ものづくり", "電子工作", "環境"],
  contest: ["コンテスト", "大会", "コンペ", "ハッカソン", "甲子園", "オリンピック", "選手権", "アイデアソン"],
  "study-session": ["勉強会", "講座", "ワークショップ", "セミナー", "講義", "授業"],
  presentation: ["発表", "プレゼン", "ピッチ", "ポスター"],
  volunteer: ["ボランティア", "地域活動", "社会貢献", "清掃", "福祉", "まちづくり"],
};

const STYLE_WORDS: [Exclude<Style, "any">, RegExp][] = [
  ["create", /作り|作る|作って|作品|制作|開発|ものづくり|ハッカソン|手を動かし|実際にやって/],
  ["compete", /競|コンテスト|大会|賞を|腕試し|コンペ/],
  ["present", /発表|プレゼン|研究成果|ピッチ/],
  ["learn", /学び|学ぶ|学べ|勉強|講義|講座|教わ|知りたい|聞きたい|セミナー|話を聞/],
  ["volunteer", /ボランティア|社会貢献|地域の役/],
];

const PREFECTURES = [
  "北海道", "青森", "岩手", "宮城", "秋田", "山形", "福島", "茨城", "栃木", "群馬", "埼玉", "千葉", "東京",
  "神奈川", "新潟", "富山", "石川", "福井", "山梨", "長野", "岐阜", "静岡", "愛知", "三重", "滋賀", "京都",
  "大阪", "兵庫", "奈良", "和歌山", "鳥取", "島根", "岡山", "広島", "山口", "徳島", "香川", "愛媛", "高知",
  "福岡", "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄", "倉敷", "横浜", "名古屋", "神戸", "札幌", "仙台",
];

const NO_PREF = /なんでも|何でも|特にない|特になし|わからない|分からない|まだ決まって|おまかせ|お任せ|どれでも|どっちでも|どちらでも|こだわらない|気にしない/;
const WANTS_RESULTS = /探して|さがして|見せて|教えて|紹介して|おすすめ|オススメ|候補|一覧|出して|この条件で/;
const RESET = /最初から|リセット|やり直|条件をクリア/;

function normalize(text: string) {
  return text.normalize("NFKC").toLowerCase();
}

/** ASCII terms (e.g. "ai", "web") must match as whole words, not inside "fair". */
function containsTerm(text: string, term: string) {
  if (/^[a-z0-9]+$/.test(term)) {
    return new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`).test(text);
  }
  return text.includes(term);
}

export function extractWithRules(message: string, categories: CategoryInfo[]): Extracted {
  const t = normalize(message);
  const known = new Set(categories.map((c) => c.slug));
  const cats = new Set<string>();
  const keywords = new Set<string>();
  for (const c of categories) {
    if (containsTerm(t, normalize(c.name)) && c.slug !== "other") cats.add(c.slug);
  }
  for (const [slug, words] of Object.entries(CATEGORY_SYNONYMS)) {
    if (!known.has(slug)) continue;
    for (const w of words) {
      const hit = containsTerm(t, w);
      if (!hit) continue;
      cats.add(slug);
      // Specific words (e.g. ロボット) also help ranking within a category.
      const name = categories.find((c) => c.slug === slug)?.name;
      if (w.length >= 2 && normalize(name ?? "") !== w) keywords.add(w);
    }
  }

  let style: Style | null = null;
  for (const [s, re] of STYLE_WORDS) {
    if (re.test(t)) {
      style = s;
      break;
    }
  }

  let format: Extracted["format"] = null;
  if (/オンライン|家から|自宅|リモート|zoom|ネットで/.test(t)) format = "online";
  else if (/会場|対面|現地|オフライン|直接|実際に行/.test(t)) format = "offline";

  const location = PREFECTURES.find((p) => t.includes(normalize(p))) ?? null;

  let period: Extracted["period"] = null;
  if (/今月|1か月|1ヶ月|一か月|一ヶ月|すぐ|近いうち|今週|来週/.test(t)) period = "soon";
  else if (/3か月|3ヶ月|三か月|夏休み|冬休み|春休み|来月|今学期/.test(t)) period = "3months";
  else if (/いつでも/.test(t)) period = "any";

  let fee: Extracted["fee"] = null;
  if (/無料|タダ|ただで|お金がかからない|お金をかけ/.test(t)) fee = "free";

  let participation: Extracted["participation"] = null;
  if (/一人|ひとり|個人|ソロ/.test(t)) participation = "solo";
  else if (/チーム|友達と|友だちと|仲間|グループ|みんなで/.test(t)) participation = "team";

  return {
    categories: [...cats],
    keywords: [...keywords].slice(0, 5),
    style,
    format,
    location,
    period,
    fee,
    participation,
    noPreference: NO_PREF.test(t),
    wantsResults: WANTS_RESULTS.test(t),
    reset: RESET.test(t),
  };
}

/** Merge newly extracted info into the state. */
export function mergeState(state: ChatState, ex: Extracted): ChatState {
  const next: ChatState = {
    ...state,
    categories: [...new Set([...state.categories, ...ex.categories])].slice(0, 6),
    keywords: [...new Set([...state.keywords, ...ex.keywords])].slice(0, 8),
    style: ex.style ?? state.style,
    format: ex.format ?? state.format,
    location: ex.location ?? state.location,
    period: ex.period ?? state.period,
    fee: ex.fee ?? state.fee,
    participation: ex.participation ?? state.participation,
  };
  // "なんでもいい" answers the question that was just asked.
  if (ex.noPreference && state.pending) {
    if (state.pending === "style" && !ex.style) next.style = "any";
    if (state.pending === "format" && !ex.format) next.format = "any";
    if (state.pending === "period" && !ex.period) next.period = "any";
  }
  return next;
}

export function hasInterest(s: ChatState) {
  return s.categories.length > 0 || s.keywords.length > 0;
}

/** Decide the next question, or null when it is time to search. */
export function nextSlot(s: ChatState, wantsResults: boolean): Slot | null {
  if (wantsResults) return null;
  if (!hasInterest(s) && !s.asked.includes("interest")) return "interest";
  if (!s.style && !s.asked.includes("style")) return "style";
  return null;
}
