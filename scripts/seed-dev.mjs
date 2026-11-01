#!/usr/bin/env node
// Seeds the LOCAL development database with clearly-marked sample events.
// Dates are relative to "now" so the data stays useful.
// Usage: npm run db:seed:dev   (never run against production)
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.argv.includes("--remote")) {
  console.error("This script only seeds the local development database.");
  process.exit(1);
}

const DAY = 86_400_000;
const now = Date.now();
/** Local Japan time `days` from today at `hour`:`minute`. */
const at = (days, hour = 10, minute = 0) => {
  const jst = new Date(now + 9 * 3600_000);
  const base = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hour, minute);
  return base - 9 * 3600_000 + days * DAY;
};
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
// Simplified stripEditionMarkers() (years only) — enough for the sample titles.
const YEAR = /(?:19|20)\d{2}/;
const seriesKey = (title) => norm(title.replace(new RegExp(YEAR, "g"), " "));
const jstParts = (ms) => {
  const d = new Date(ms + 9 * 3600_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};

const SAMPLE_USER = "00000000-0000-4000-8000-000000000001";
const NOTE = "※動作確認用のサンプルデータです（実在のイベントではありません）。";

const events = [
  { title: "中高生AIハッカソン 2026 冬", cats: ["ai", "programming", "contest"], start: at(24, 10), end: at(25, 17), deadline: at(12, 23, 59), location: "岡山イノベーションセンター（岡山市北区）", format: "offline", organizer: "未来テックラボ", target: "中学生・高校生（チーム参加可、1〜4人）", fee: "free", desc: "生成AIを使ったアプリやサービスを2日間でチーム開発するハッカソンです。プログラミング初心者向けのサポートもあります。最終日に作品発表と表彰を行います。" },
  { title: "はじめてのPython勉強会（オンライン）", cats: ["programming", "study-session"], start: at(9, 19), end: at(9, 21), deadline: at(7, 23, 59), location: null, format: "online", organizer: "Python初学者の会", target: "プログラミング未経験の中高生", fee: "free", desc: "Pythonの基本文法を2時間で体験するオンライン勉強会です。Zoomで参加します。講師が画面共有しながら一緒に手を動かします。" },
  { title: "高校生ビジネスプランコンテスト", cats: ["business", "contest"], start: at(60, 13), end: null, deadline: at(30, 17, 0), location: "東京都千代田区 大手町ホール", format: "hybrid", organizer: "日本若者起業支援機構", target: "高校生（個人・チーム）", fee: "free", desc: "社会課題を解決するビジネスプランを募集します。書類審査を通過したチームは本選でピッチを行います。オンライン視聴も可能です。" },
  { title: "サイエンス探究ポスター発表会", cats: ["research", "presentation", "science"], start: at(40, 9, 30), end: at(40, 16, 0), deadline: at(20, 23, 59), location: "岡山大学 津島キャンパス", format: "offline", organizer: "岡山県高校理科教育研究会", target: "中学生・高校生", fee: "free", desc: "課題研究や自由研究の成果をポスターで発表し、大学の研究者からフィードバックをもらえるイベントです。" },
  { title: "UIデザイン入門ワークショップ", cats: ["design", "study-session"], start: at(15, 14), end: at(15, 17), deadline: at(2, 23, 59), location: "倉敷市芸文館 会議室", format: "offline", organizer: "せとうちデザイン部", target: "デザインに興味のある中高生", fee: "paid", feeDetail: "500円（教材費）", desc: "アプリ画面のデザインを紙とFigmaで体験するワークショップ。デザインの基本ルールを学びます。" },
  { title: "ロボットプログラミング大会 地区予選", cats: ["science", "programming", "contest"], start: at(50, 10), end: null, deadline: at(35, 23, 59), location: "広島県立総合体育館", format: "offline", organizer: "ジュニアロボット連盟", target: "中学生・高校生のチーム（3人まで）", fee: "paid", feeDetail: "1チーム 3,000円", desc: "自作ロボットをプログラミングして課題をクリアする競技会です。上位チームは全国大会に進出できます。" },
  { title: "海岸清掃ボランティア", cats: ["volunteer"], start: at(6, 8, 30), end: at(6, 11, 0), deadline: null, location: "岡山県玉野市 渋川海岸", format: "offline", organizer: "せとうちクリーン隊", target: "どなたでも", fee: "free", desc: "地域の海岸を清掃するボランティアです。軍手・ゴミ袋は用意します。保護者の同意が必要です。" },
  { title: "宇宙と天文のオンライン講演会", cats: ["science", "study-session"], start: at(18, 20), end: at(18, 21, 30), deadline: null, location: null, format: "online", organizer: "宇宙教育ネットワーク", target: "中学生以上", fee: "free", desc: "現役の研究者がブラックホールや系外惑星の最新研究をわかりやすく紹介します。質疑応答の時間もあります。" },
  { title: "U-18 ゲーム制作ジャム", cats: ["programming", "design", "contest"], start: at(33, 10), end: at(34, 18), deadline: at(20, 23, 59), location: null, format: "online", organizer: "インディーゲーム研究会", target: "18歳以下（個人・チーム）", fee: "free", desc: "48時間でテーマに沿ったゲームを作るオンラインのゲームジャムです。Scratch・Unity・Godotなどツールは自由です。" },
  { title: "AI時代のキャリアを考えるトークイベント", cats: ["ai", "business"], start: at(-10, 18), end: at(-10, 20), deadline: at(-12, 23, 59), location: "オンライン（YouTube Live）", format: "online", organizer: "キャリア教育フォーラム", target: "高校生・大学生", fee: "free", desc: "AIと共に働く未来について、エンジニアや起業家が語るトークイベントです。（終了したイベントの例）" },
  { title: "数学オリンピック対策講座", cats: ["science", "study-session"], start: at(21, 13), end: at(21, 16), deadline: at(14, 23, 59), location: "岡山市立中央図書館", format: "offline", organizer: "数学の会おかやま", target: "数学が好きな中学生・高校生", fee: "free", desc: "過去問を使って数学オリンピックの考え方を学ぶ講座です。" },
  { title: "地域課題解決アイデアソン", cats: ["business", "contest", "volunteer"], start: at(28, 10), end: at(28, 17), deadline: at(4, 23, 59), location: "岡山市 さんかく岡山", format: "offline", organizer: "岡山まちづくり協議会", target: "高校生", fee: "free", desc: "地域の課題を解決するアイデアをチームで考え、市役所の職員に提案するアイデアソンです。" },
];

const lines = [
  "PRAGMA foreign_keys = ON;",
  `INSERT OR IGNORE INTO user (id, name, email, email_verified, role, profile_visibility) VALUES (${q(SAMPLE_USER)}, 'Event Share サンプル', 'sample@example.invalid', 0, 'user', 'public');`,
];
events.forEach((e, i) => {
  const id = `00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`;
  const seriesId = `00000000-0000-4000-8000-${String(i + 200).padStart(12, "0")}`;
  const start = jstParts(e.start);
  const seriesTitle = e.title.replace(new RegExp(YEAR, "g"), " ").replace(/\s+/g, " ").trim();
  lines.push(
    `INSERT OR REPLACE INTO event_series (id, title, match_key, created_by_id) VALUES (${[
      seriesId, seriesTitle, seriesKey(e.title), SAMPLE_USER,
    ].map(q).join(", ")});`,
    `INSERT OR REPLACE INTO events (id, title, description, start_at, end_at, location, format, organizer, target_audience, fee_type, fee_detail, application_deadline, official_url, status, created_by_id, normalized_title, normalized_official_url, like_count, bookmark_count, series_id, edition_label, start_month, created_at, updated_at) VALUES (${[
      id, e.title, `${e.desc}\n\n${NOTE}`, e.start, e.end, e.location, e.format, e.organizer, e.target, e.fee, e.feeDetail ?? null, e.deadline, null, "published", SAMPLE_USER, norm(e.title), null, (i * 7) % 11, (i * 3) % 5, seriesId, e.title.match(YEAR)?.[0] ?? String(start.year), start.month, now - (events.length - i) * 3600_000, now,
    ].map(q).join(", ")});`,
    `DELETE FROM event_categories WHERE event_id = ${q(id)};`,
    ...e.cats.map((slug) => `INSERT OR IGNORE INTO event_categories (event_id, category_id) SELECT ${q(id)}, id FROM categories WHERE slug = ${q(slug)};`),
    `INSERT OR IGNORE INTO event_contributions (id, event_id, user_id, type, note) VALUES (${q(`${id.slice(0, -4)}c${String(i).padStart(3, "0")}`)}, ${q(id)}, ${q(SAMPLE_USER)}, 'create', 'サンプルデータ');`,
  );
});
// Re-seeding replaces the sample events; drop series left without editions.
lines.push("DELETE FROM event_series WHERE id NOT IN (SELECT series_id FROM events WHERE series_id IS NOT NULL);");

const dir = mkdtempSync(join(tmpdir(), "event-share-seed-"));
const file = join(dir, "seed.sql");
writeFileSync(file, lines.join("\n"));
execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--file", file], { stdio: "inherit" });
console.log(`Seeded ${events.length} sample events into the local database.`);
