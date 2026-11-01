import { and, desc, eq } from "drizzle-orm";
import { Bookmark, Settings } from "lucide-react";
import { Link } from "react-router";
import { createDb } from "~/.server/db";
import { eventBookmarks, events } from "~/.server/db/schema";
import { listActivities } from "~/.server/services/activities";
import { listMyEndorsements } from "~/.server/services/endorsements";
import { toEventCards } from "~/.server/services/events";
import {
  contributionsBy,
  eventsParticipatedBy,
  eventsPostedBy,
  getInterests,
  getUserById,
} from "~/.server/services/users";
import { requireUser } from "~/.server/session";
import { ActivityCard } from "~/components/activities/activity-card";
import { EndorsementExcerptList } from "~/components/events/endorsement-excerpt-list";
import { EmptyState } from "~/components/empty-state";
import { EventGrid } from "~/components/events/event-card";
import { PageContainer } from "~/components/page-header";
import { ProfileHeader } from "~/components/profile-header";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { formatDateTime } from "~/lib/datetime";
import { useTimeZone } from "~/lib/hooks";
import { VISIBILITY_LABEL } from "~/lib/labels";
import type { Route } from "./+types/me";

export const meta = () => [{ title: "マイページ | Event Share" }];

const CONTRIBUTION_LABEL = {
  create: "イベントを投稿",
  add_info: "情報を追加",
  edit: "イベントを編集",
  merge: "統合",
  moderate: "管理者として編集",
} as const;

export async function loader({ context, request }: Route.LoaderArgs) {
  const sessionUser = requireUser(context, request);
  const db = createDb();
  const now = new Date();
  const me = (await getUserById(db, sessionUser.id))!;
  const [interests, bookmarks, posted, participated, activities, contributions, endorsements] = await Promise.all([
    getInterests(db, me.id),
    db
      .select({ event: events })
      .from(eventBookmarks)
      .innerJoin(events, eq(events.id, eventBookmarks.eventId))
      .where(and(eq(eventBookmarks.userId, me.id), eq(events.status, "published")))
      .orderBy(desc(eventBookmarks.createdAt))
      .limit(60)
      .then((rows) => toEventCards(db, rows.map((r) => r.event), now)),
    eventsPostedBy(db, me.id).then((rows) => toEventCards(db, rows, now)),
    eventsParticipatedBy(db, me.id).then((rows) => toEventCards(db, rows, now)),
    listActivities(db, { userId: me.id, limit: 50 }),
    contributionsBy(db, me.id),
    listMyEndorsements(db, me.id, { includeHidden: true }),
  ]);
  return {
    me: { id: me.id, name: me.name, grade: me.grade, bio: me.bio, visibility: me.profileVisibility },
    interests: interests.map((i) => i.label),
    bookmarks,
    posted,
    participated,
    activities,
    contributions,
    endorsements,
  };
}

export default function MyPage({ loaderData }: Route.ComponentProps) {
  const { me, interests, bookmarks, posted, participated, activities, contributions, endorsements } = loaderData;
  const tz = useTimeZone();
  return (
    <PageContainer className="max-w-5xl">
      <ProfileHeader
        name={me.name}
        grade={me.grade}
        bio={me.bio}
        interests={interests}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/users/${me.id}`}>公開プロフィール</Link>
            </Button>
            <Button variant="outline" size="icon" asChild>
              <Link to="/settings" aria-label="設定">
                <Settings />
              </Link>
            </Button>
          </>
        }
      />
      <p className="mt-2 px-1 text-xs text-muted-foreground">プロフィールの公開範囲: {VISIBILITY_LABEL[me.visibility]}</p>

      <Tabs defaultValue="bookmarks" className="mt-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="bookmarks">お気に入り（{bookmarks.length}）</TabsTrigger>
          <TabsTrigger value="participated">参加（{participated.length}）</TabsTrigger>
          {endorsements.length > 0 && (
            <TabsTrigger value="endorsements">おすすめしたイベント（{endorsements.length}）</TabsTrigger>
          )}
          <TabsTrigger value="posted">投稿（{posted.length}）</TabsTrigger>
          <TabsTrigger value="activities">活動報告（{activities.length}）</TabsTrigger>
          <TabsTrigger value="history">投稿・編集履歴</TabsTrigger>
        </TabsList>
        <TabsContent value="bookmarks" className="mt-4">
          {bookmarks.length ? (
            <EventGrid events={bookmarks} />
          ) : (
            <EmptyState icon={Bookmark} title="お気に入りのイベントはまだありません" description="気になるイベントをお気に入りに追加すると、締切や開催日が近づいたときに通知が届きます。">
              <Button asChild>
                <Link to="/events">イベントを探す</Link>
              </Button>
            </EmptyState>
          )}
        </TabsContent>
        <TabsContent value="participated" className="mt-4">
          {participated.length ? <EventGrid events={participated} /> : <EmptyState title="参加予定・参加したイベントはありません" />}
        </TabsContent>
        {endorsements.length > 0 && (
          <TabsContent value="endorsements" className="mt-4">
            <EndorsementExcerptList items={endorsements} />
          </TabsContent>
        )}
        <TabsContent value="posted" className="mt-4">
          {posted.length ? (
            <EventGrid events={posted} />
          ) : (
            <EmptyState title="投稿したイベントはありません">
              <Button asChild>
                <Link to="/events/new">イベントを投稿</Link>
              </Button>
            </EmptyState>
          )}
        </TabsContent>
        <TabsContent value="activities" className="mt-4">
          {activities.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {activities.map((a) => (
                <ActivityCard key={a.id} activity={a} />
              ))}
            </div>
          ) : (
            <EmptyState title="活動報告はまだありません">
              <Button asChild>
                <Link to="/activities/new">活動報告を書く</Link>
              </Button>
            </EmptyState>
          )}
        </TabsContent>
        <TabsContent value="history" className="mt-4">
          {contributions.length ? (
            <ul className="divide-y rounded-xl border bg-card">
              {contributions.map((c) => (
                <li key={c.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-36 shrink-0 text-xs text-muted-foreground">{formatDateTime(c.createdAt, tz)}</span>
                  <span className="w-32 shrink-0 text-sm font-medium">{CONTRIBUTION_LABEL[c.type]}</span>
                  <Link to={`/events/${c.eventId}`} className="truncate text-sm text-primary hover:underline">
                    {c.eventTitle}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="履歴はまだありません" />
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
