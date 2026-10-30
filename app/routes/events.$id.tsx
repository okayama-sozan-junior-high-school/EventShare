import {
  Bookmark,
  CalendarClock,
  CalendarPlus,
  Check,
  CircleDollarSign,
  ExternalLink as ExternalIcon,
  Heart,
  History,
  Info,
  MapPin,
  Pencil,
  Timer,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useState } from "react";
import { data, Link, redirect, useFetcher } from "react-router";
import { createDb } from "~/.server/db";
import { listActivities } from "~/.server/services/activities";
import { getEventExtras } from "~/.server/services/event-detail";
import { getEvent, mediaUrl } from "~/.server/services/events";
import {
  addComment,
  editComment,
  getComment,
  getViewerState,
  listComments,
  setBookmark,
  setCommentStatus,
  setLike,
  setParticipation,
} from "~/.server/services/interactions";
import { notifyComment, notifyReaction } from "~/.server/services/notifications";
import { getUserById } from "~/.server/services/users";
import { enforceRateLimit } from "~/.server/rate-limit";
import { getRequestInfo, getUser, isAdmin, requireUser } from "~/.server/session";
import { commentSchema } from "~/.server/validation/interaction";
import { EVENT_FIELD_LABEL } from "~/.server/validation/event";
import { ActivityCard } from "~/components/activities/activity-card";
import { DeadlineText, placeLabel } from "~/components/events/event-card";
import { PhaseBadge } from "~/components/events/phase-badge";
import { ExternalLink, Linkified } from "~/components/external-link";
import { PageContainer } from "~/components/page-header";
import { ReportDialog } from "~/components/report-dialog";
import { ShareButton } from "~/components/share-button";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { Textarea } from "~/components/ui/textarea";
import { formatDateTime, formatRange, formatRelative } from "~/lib/datetime";
import { getEventPhase, isAcceptingApplications } from "~/lib/event-phase";
import { useCurrentUser, useTimeZone } from "~/lib/hooks";
import { FEE_LABEL, FORMAT_LABEL } from "~/lib/labels";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/events.$id";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "イベントが見つかりません | Event Share" }];
  return [
    { title: `${loaderData.event.title} | Event Share` },
    { name: "description", content: (loaderData.event.description ?? "").slice(0, 120) },
    { property: "og:title", content: loaderData.event.title },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const db = createDb();
  const viewer = getUser(context);
  const event = await getEvent(db, params.id);
  if (!event) throw data("イベントが見つかりません", { status: 404 });
  if (event.status === "merged" && event.mergedIntoId) {
    throw redirect(`/events/${event.mergedIntoId}`);
  }
  const owner = !!viewer && viewer.id === event.createdById;
  const admin = isAdmin(viewer);
  if (event.status !== "published" && !owner && !admin) {
    throw data("イベントが見つかりません", { status: 404 });
  }

  const [extras, comments, viewerState, activities, creator] = await Promise.all([
    getEventExtras(db, event.id),
    listComments(db, event.id),
    getViewerState(db, viewer?.id, event.id),
    listActivities(db, { eventId: event.id, limit: 6 }),
    event.createdById ? getUserById(db, event.createdById) : null,
  ]);

  const now = new Date();
  return {
    event: { ...event, imageUrl: mediaUrl(event.imageMediaId) },
    phase: getEventPhase(event, now),
    creator: creator ? { id: creator.id, name: creator.name } : null,
    ...extras,
    comments,
    viewerState,
    activities,
    canEdit: owner || admin,
    fieldLabels: EVENT_FIELD_LABEL,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = requireUser(context, request);
  await enforceRateLimit("write", user.id);
  const db = createDb();
  const event = await getEvent(db, params.id);
  if (!event || event.status !== "published") throw data("イベントが見つかりません", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent"));
  const { waitUntil } = getRequestInfo(context);

  switch (intent) {
    case "like":
    case "unlike": {
      const created = await setLike(db, user.id, event.id, intent === "like");
      if (created) waitUntil(notifyReaction(db, event, user, "like"));
      return { ok: true };
    }
    case "bookmark":
    case "unbookmark": {
      const created = await setBookmark(db, user.id, event.id, intent === "bookmark");
      if (created) waitUntil(notifyReaction(db, event, user, "bookmark"));
      return { ok: true };
    }
    case "participate":
    case "unparticipate":
      await setParticipation(db, user.id, event.id, intent === "participate");
      return { ok: true };
    case "comment": {
      const parsed = commentSchema.safeParse({ body: form.get("body") });
      if (!parsed.success) {
        return data({ ok: false, error: parsed.error.issues[0].message }, { status: 400 });
      }
      await addComment(db, event.id, user.id, parsed.data.body);
      waitUntil(notifyComment(db, event, user.id, user.name));
      return { ok: true, commented: true };
    }
    case "edit_comment":
    case "delete_comment": {
      const comment = await getComment(db, String(form.get("commentId")));
      if (!comment || comment.eventId !== event.id || comment.status !== "visible") {
        throw data("コメントが見つかりません", { status: 404 });
      }
      if (comment.userId !== user.id && !isAdmin(user)) {
        throw data("このコメントを変更する権限がありません", { status: 403 });
      }
      if (intent === "delete_comment") {
        await setCommentStatus(db, comment.id, event.id, comment.userId === user.id ? "deleted" : "hidden");
        return { ok: true };
      }
      const parsed = commentSchema.safeParse({ body: form.get("body") });
      if (!parsed.success) {
        return data({ ok: false, error: parsed.error.issues[0].message }, { status: 400 });
      }
      await editComment(db, comment.id, parsed.data.body);
      return { ok: true };
    }
    default:
      throw data("不正なリクエストです", { status: 400 });
  }
}

function ToggleButton({
  on,
  intentOn,
  intentOff,
  icon: Icon,
  labelOn,
  labelOff,
  count,
}: {
  on: boolean;
  intentOn: string;
  intentOff: string;
  icon: typeof Heart;
  labelOn: string;
  labelOff: string;
  count?: number;
}) {
  const fetcher = useFetcher();
  const user = useCurrentUser();
  const pendingIntent = fetcher.formData?.get("intent");
  const optimistic = pendingIntent ? pendingIntent === intentOn : on;
  const shownCount =
    count === undefined ? undefined : count + (optimistic === on ? 0 : optimistic ? 1 : -1);

  if (!user) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link to="/login" title="ログインが必要です">
          <Icon /> {labelOff}
          {count !== undefined && <span className="tabular-nums">{count}</span>}
        </Link>
      </Button>
    );
  }
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value={optimistic ? intentOff : intentOn} />
      <Button
        type="submit"
        variant={optimistic ? "default" : "outline"}
        size="sm"
        aria-pressed={optimistic}
      >
        <Icon className={cn(optimistic && "fill-current")} />
        {optimistic ? labelOn : labelOff}
        {shownCount !== undefined && <span className="tabular-nums">{shownCount}</span>}
      </Button>
    </fetcher.Form>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Heart;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 py-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words">{children}</dd>
      </div>
    </div>
  );
}

function Unset() {
  return <span className="text-muted-foreground">未設定</span>;
}

type CommentItem = Route.ComponentProps["loaderData"]["comments"][number];

function CommentRow({ comment }: { comment: CommentItem }) {
  const user = useCurrentUser();
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [editing, setEditing] = useState(false);
  const mine = user?.id === comment.userId;
  const canModerate = mine || user?.role === "admin";
  const deleting = fetcher.formData?.get("intent") === "delete_comment";
  if (deleting) return null;

  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm">
        <Link to={`/users/${comment.userId}`} className="font-semibold hover:underline">
          {comment.userName}
        </Link>
        <span className="text-xs text-muted-foreground">
          {formatRelative(comment.createdAt, new Date())}
          {comment.editedAt && "（編集済み）"}
        </span>
        <div className="ml-auto flex items-center">
          {mine && !editing && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(true)} aria-label="コメントを編集">
              <Pencil className="size-3.5" />
            </Button>
          )}
          {canModerate && (
            <fetcher.Form
              method="post"
              onSubmit={(e) => {
                if (!confirm("このコメントを削除しますか？")) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete_comment" />
              <input type="hidden" name="commentId" value={comment.id} />
              <Button variant="ghost" size="icon" className="size-7" aria-label="コメントを削除">
                <Trash2 className="size-3.5" />
              </Button>
            </fetcher.Form>
          )}
          {!mine && (
            <ReportDialog
              targetType="comment"
              targetId={comment.id}
              trigger={
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                  報告
                </Button>
              }
            />
          )}
        </div>
      </div>
      {editing ? (
        <fetcher.Form
          method="post"
          className="mt-2 grid gap-2"
          onSubmit={() => setEditing(false)}
        >
          <input type="hidden" name="intent" value="edit_comment" />
          <input type="hidden" name="commentId" value={comment.id} />
          <Textarea name="body" defaultValue={comment.body} maxLength={1000} rows={3} aria-label="コメントを編集" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              キャンセル
            </Button>
            <Button type="submit" size="sm">
              保存
            </Button>
          </div>
        </fetcher.Form>
      ) : (
        <Linkified text={comment.body} className="mt-2 text-sm leading-relaxed" />
      )}
      {fetcher.data?.error && <p className="mt-1 text-xs text-destructive">{fetcher.data.error}</p>}
    </li>
  );
}

function CommentForm() {
  const fetcher = useFetcher<{ ok: boolean; error?: string; commented?: boolean }>();
  const user = useCurrentUser();
  const [value, setValue] = useState("");
  if (!user) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        コメントするには
        <Link to="/login" className="mx-1 font-medium text-primary hover:underline">
          ログイン
        </Link>
        してください。
      </p>
    );
  }
  return (
    <fetcher.Form
      method="post"
      className="grid gap-2"
      onSubmit={() => setTimeout(() => setValue(""), 0)}
    >
      <input type="hidden" name="intent" value="comment" />
      <Textarea
        name="body"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="質問や参加の感想、補足情報などを書き込もう（個人情報は書かないでください）"
        maxLength={1000}
        rows={3}
        aria-label="コメント"
      />
      {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!value.trim() || fetcher.state !== "idle"}>
          コメントする
        </Button>
      </div>
    </fetcher.Form>
  );
}

const HISTORY_LABEL = {
  create: "投稿",
  add_info: "情報を追加",
  edit: "編集",
  merge: "統合",
  moderate: "管理者が編集",
} as const;

export default function EventDetail({ loaderData }: Route.ComponentProps) {
  const {
    event,
    phase,
    categories,
    creator,
    contributors,
    history,
    comments,
    viewerState,
    activities,
    canEdit,
    fieldLabels,
  } = loaderData;
  const tz = useTimeZone();
  const user = useCurrentUser();
  const [showHistory, setShowHistory] = useState(false);
  const accepting = isAcceptingApplications(phase);

  return (
    <PageContainer className="max-w-5xl">
      {event.status !== "published" && (
        <Alert className="mb-6">
          <Info />
          <AlertTitle>このイベントは非公開です</AlertTitle>
          <AlertDescription>管理者または投稿者にのみ表示されています。</AlertDescription>
        </Alert>
      )}

      <nav className="mb-4 text-sm text-muted-foreground" aria-label="パンくず">
        <Link to="/events" className="hover:underline">
          イベント
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">詳細</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <article className="min-w-0">
          {event.imageUrl && (
            <img
              src={event.imageUrl}
              alt=""
              className={cn("mb-6 aspect-[16/8] w-full rounded-xl border object-cover", phase === "ended" && "grayscale")}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <PhaseBadge phase={phase} />
            {categories.map((c) => (
              <Link key={c.id} to={`/events?category=${c.slug}`}>
                <Badge variant="secondary" className="hover:bg-accent">
                  {c.name}
                </Badge>
              </Link>
            ))}
          </div>
          <h1 className="mt-3 text-2xl leading-snug font-bold tracking-tight sm:text-3xl">{event.title}</h1>
          {event.organizer && <p className="mt-2 text-muted-foreground">主催: {event.organizer}</p>}

          {phase === "ended" && (
            <Alert className="mt-4">
              <Info />
              <AlertTitle>このイベントは終了しました</AlertTitle>
              <AlertDescription>参加した人は活動報告を書いてみましょう。</AlertDescription>
            </Alert>
          )}
          {phase === "closed" && (
            <Alert className="mt-4">
              <Info />
              <AlertTitle>応募受付は終了しています</AlertTitle>
              <AlertDescription>応募締切を過ぎています。最新情報は公式サイトで確認してください。</AlertDescription>
            </Alert>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <ToggleButton
              on={viewerState.liked}
              intentOn="like"
              intentOff="unlike"
              icon={Heart}
              labelOn="いいね済み"
              labelOff="いいね"
              count={event.likeCount}
            />
            <ToggleButton
              on={viewerState.bookmarked}
              intentOn="bookmark"
              intentOff="unbookmark"
              icon={Bookmark}
              labelOn="お気に入り済み"
              labelOff="お気に入り"
            />
            <ToggleButton
              on={viewerState.participated}
              intentOn="participate"
              intentOff="unparticipate"
              icon={phase === "ended" ? Check : Users}
              labelOn={phase === "ended" ? "参加した" : "参加予定"}
              labelOff={phase === "ended" ? "参加した" : "参加予定にする"}
            />
            <ShareButton title={event.title} path={`/events/${event.id}`} />
            {event.startAt && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/events/${event.id}/calendar.ics`} download>
                  <CalendarPlus /> カレンダーに追加
                </a>
              </Button>
            )}
          </div>

          <section className="mt-8" aria-labelledby="about">
            <h2 id="about" className="text-lg font-bold">
              イベントの説明
            </h2>
            {event.description ? (
              <Linkified text={event.description} className="mt-3 leading-relaxed" />
            ) : (
              <p className="mt-3 text-muted-foreground">説明はまだ登録されていません。</p>
            )}
          </section>

          <Separator className="my-8" />

          <section aria-labelledby="activities">
            <div className="flex items-center justify-between gap-2">
              <h2 id="activities" className="text-lg font-bold">
                関連する活動報告
              </h2>
              {user && (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/activities/new?eventId=${event.id}`}>活動報告を書く</Link>
                </Button>
              )}
            </div>
            {activities.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {activities.map((a) => (
                  <ActivityCard key={a.id} activity={a} />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">まだ活動報告はありません。</p>
            )}
          </section>

          <Separator className="my-8" />

          <section id="comments" aria-labelledby="comments-title" className="scroll-mt-20">
            <h2 id="comments-title" className="text-lg font-bold">
              コメント（{comments.length}）
            </h2>
            {comments.length > 0 ? (
              <ul className="mt-4 grid gap-3">
                {comments.map((c) => (
                  <CommentRow key={c.id} comment={c} />
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">まだコメントはありません。</p>
            )}
            <div className="mt-4">
              <CommentForm />
            </div>
          </section>
        </article>

        <aside className="grid content-start gap-4 lg:sticky lg:top-20">
          <div className="rounded-xl border bg-card p-5">
            <dl className="divide-y">
              <InfoRow icon={CalendarClock} label="開催日時">
                {event.startAt ? formatRange(event.startAt, event.endAt, tz) : <Unset />}
              </InfoRow>
              <InfoRow icon={MapPin} label={`開催場所（${FORMAT_LABEL[event.format]}）`}>
                {event.location || event.format !== "unknown" ? placeLabel(event.format, event.location) : <Unset />}
              </InfoRow>
              <InfoRow icon={Timer} label="応募締切">
                {event.applicationDeadline ? (
                  <>
                    <span className="block">{formatDateTime(event.applicationDeadline, tz)}</span>
                    <span className="text-sm">
                      <DeadlineText deadline={event.applicationDeadline} phase={phase} />
                    </span>
                  </>
                ) : (
                  <Unset />
                )}
              </InfoRow>
              <InfoRow icon={Users} label="対象者">
                {event.targetAudience ?? <Unset />}
              </InfoRow>
              <InfoRow icon={CircleDollarSign} label="参加費">
                {event.feeType === "unknown" && !event.feeDetail ? (
                  <Unset />
                ) : (
                  <>
                    {FEE_LABEL[event.feeType]}
                    {event.feeDetail && <span className="ml-1 text-muted-foreground">（{event.feeDetail}）</span>}
                  </>
                )}
              </InfoRow>
            </dl>
            <div className="mt-4 grid gap-2">
              {event.applicationUrl && accepting && (
                <Button asChild>
                  <ExternalLink href={event.applicationUrl}>応募フォームを開く</ExternalLink>
                </Button>
              )}
              {event.officialUrl && (
                <Button variant="outline" asChild>
                  <ExternalLink href={event.officialUrl}>公式サイトを見る</ExternalLink>
                </Button>
              )}
              {!event.officialUrl && !event.applicationUrl && (
                <p className="text-xs text-muted-foreground">公式サイト・応募フォームのURLは登録されていません。</p>
              )}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              掲載情報は生徒による投稿です。参加前に必ず公式サイトで最新情報を確認してください。
            </p>
          </div>

          <div className="rounded-xl border bg-card p-5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <UserRound className="size-4" aria-hidden /> 投稿者・情報提供者
            </h2>
            <ul className="mt-3 grid gap-2 text-sm">
              {contributors.length > 0 ? (
                contributors.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link to={`/users/${c.id}`} className="truncate font-medium hover:underline">
                      {c.name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{c.roles.join("・")}</span>
                  </li>
                ))
              ) : (
                <li className="text-muted-foreground">{creator?.name ?? "退会したユーザー"}</li>
              )}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              最終更新: {formatDateTime(event.updatedAt, tz)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {canEdit ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/events/${event.id}/edit`}>
                    <Pencil /> 編集
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/events/${event.id}/edit`}>
                    <Pencil /> 情報を追加
                  </Link>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
                <History /> 履歴
              </Button>
              <ReportDialog
                targetType="event"
                targetId={event.id}
                reasons={["incorrect", "duplicate", "inappropriate", "personal_info", "spam", "other"]}
              />
            </div>
            {showHistory && (
              <ol className="mt-4 grid gap-3 border-t pt-4 text-xs">
                {history.map((h) => (
                  <li key={h.id}>
                    <p>
                      <span className="font-semibold">{HISTORY_LABEL[h.type]}</span>
                      <span className="ml-1 text-muted-foreground">
                        {h.userName ?? "不明"} ・ {formatDateTime(h.createdAt, tz)}
                      </span>
                    </p>
                    {h.changes && Object.keys(h.changes).length > 0 && (
                      <p className="mt-0.5 text-muted-foreground">
                        変更: {Object.keys(h.changes).map((k) => fieldLabels[k as keyof typeof fieldLabels] ?? k).join("、")}
                      </p>
                    )}
                    {h.note && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{h.note}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {event.officialUrl && (
            <p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
              <ExternalIcon className="size-3" aria-hidden />
              外部リンクは新しいタブで開きます
            </p>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}
