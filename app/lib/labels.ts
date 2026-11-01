export const FORMAT_LABEL = {
  offline: "オフライン（会場）",
  online: "オンライン",
  hybrid: "ハイブリッド",
  unknown: "未設定",
} as const;

export const FORMAT_SHORT_LABEL = {
  offline: "会場",
  online: "オンライン",
  hybrid: "ハイブリッド",
  unknown: "形式未設定",
} as const;

export const FEE_LABEL = {
  free: "無料",
  paid: "有料",
  unknown: "未設定",
} as const;

export const REPORT_REASON_LABEL = {
  inappropriate: "不適切な内容",
  personal_info: "個人情報が含まれている",
  spam: "スパム・宣伝",
  incorrect: "情報が誤っている",
  duplicate: "重複したイベント",
  other: "その他",
} as const;

export const REPORT_TARGET_LABEL = {
  event: "イベント",
  comment: "コメント",
  activity_report: "活動報告",
  user: "ユーザー",
  endorsement: "おすすめ",
} as const;

export const NOTIFICATION_TYPE_LABEL = {
  new_event: "新しいイベント",
  deadline_soon: "応募締切が近い",
  event_soon: "開催日が近い",
  comment: "コメント",
  reaction: "リアクション",
  new_edition: "新しい回",
  system: "お知らせ",
} as const;

export const ENDORSEMENT_AUDIENCE_LABEL = {
  beginner_ok: "初めてでも大丈夫",
  experienced: "経験者向け",
  anyone: "誰にでも",
} as const;

export const VISIBILITY_LABEL = {
  public: "全体に公開",
  members: "ログインユーザーのみ",
  private: "非公開（自分のみ）",
} as const;

export const GRADE_OPTIONS = [
  "中学1年",
  "中学2年",
  "中学3年",
  "高校1年",
  "高校2年",
  "高校3年",
  "その他",
] as const;

export const SORT_OPTIONS = {
  new: "新着順",
  start: "開催日が近い順",
  deadline: "締切が近い順",
  popular: "人気順",
  recommended: "おすすめ順",
} as const;

export type SortKey = keyof typeof SORT_OPTIONS;
