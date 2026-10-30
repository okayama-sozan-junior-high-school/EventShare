export type EventPhase =
  | "open" // 募集中 (締切前 or 締切未設定で開催前)
  | "closing" // 締切間近 (3日以内)
  | "closed" // 受付終了 (締切を過ぎたが開催前)
  | "ongoing" // 開催中
  | "ended" // 終了
  | "unknown"; // 日時未設定

export const PHASE_LABEL: Record<EventPhase, string> = {
  open: "募集中",
  closing: "締切間近",
  closed: "受付終了",
  ongoing: "開催中",
  ended: "終了",
  unknown: "日程未定",
};

export const CLOSING_SOON_MS = 3 * 86_400_000;

type PhaseInput = {
  startAt: Date | null;
  endAt: Date | null;
  applicationDeadline: Date | null;
};

export function getEventPhase(e: PhaseInput, now: Date): EventPhase {
  const t = now.getTime();
  if (e.startAt) {
    // Without an end time, treat the event as finished at the end of the start day (+24h window).
    const end = e.endAt?.getTime() ?? e.startAt.getTime() + 86_400_000 - 1;
    if (t > end) return "ended";
    if (t >= e.startAt.getTime()) return "ongoing";
  }
  if (e.applicationDeadline) {
    const d = e.applicationDeadline.getTime();
    if (t > d) return "closed";
    if (d - t <= CLOSING_SOON_MS) return "closing";
    return "open";
  }
  return e.startAt ? "open" : "unknown";
}

export function isAcceptingApplications(phase: EventPhase) {
  return phase === "open" || phase === "closing" || phase === "unknown";
}
