import { Lock } from "lucide-react";
import { data, Link } from "react-router";
import { createDb } from "~/.server/db";
import { listActivities } from "~/.server/services/activities";
import { listMyEndorsements } from "~/.server/services/endorsements";
import { toEventCards } from "~/.server/services/events";
import {
  canViewProfile,
  eventsParticipatedBy,
  eventsPostedBy,
  getInterests,
  getUserById,
} from "~/.server/services/users";
import { getUser } from "~/.server/session";
import { ActivityCard } from "~/components/activities/activity-card";
import { EndorsementExcerptList } from "~/components/events/endorsement-excerpt-list";
import { EmptyState } from "~/components/empty-state";
import { EventGrid } from "~/components/events/event-card";
import { PageContainer } from "~/components/page-header";
import { ProfileHeader } from "~/components/profile-header";
import { ReportDialog } from "~/components/report-dialog";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { Route } from "./+types/users.$id";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.profile?.name ?? "ユーザー"} | Event Share` }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const db = createDb();
  const viewer = getUser(context);
  const target = await getUserById(db, params.id);
  if (!target || target.banned) throw data("ユーザーが見つかりません", { status: 404 });

  if (!canViewProfile(target.profileVisibility, viewer, target.id)) {
    return {
      visible: false as const,
      profile: { id: target.id, name: target.name },
      requiresLogin: target.profileVisibility === "members" && !viewer,
    };
  }

  const now = new Date();
  const [interests, posted, participated, activities, endorsements] = await Promise.all([
    getInterests(db, target.id),
    eventsPostedBy(db, target.id, 24).then((rows) => toEventCards(db, rows, now)),
    eventsParticipatedBy(db, target.id, 24).then((rows) => toEventCards(db, rows, now)),
    listActivities(db, { userId: target.id, limit: 24 }),
    listMyEndorsements(db, target.id),
  ]);
  return {
    visible: true as const,
    isSelf: viewer?.id === target.id,
    profile: {
      id: target.id,
      name: target.name,
      grade: target.grade,
      bio: target.bio,
    },
    interests: interests.map((i) => i.label),
    posted,
    participated,
    activities,
    endorsements,
  };
}

export default function UserProfile({ loaderData }: Route.ComponentProps) {
  if (!loaderData.visible) {
    return (
      <PageContainer className="max-w-3xl">
        <EmptyState
          icon={Lock}
          title={`${loaderData.profile.name} さんのプロフィールは公開されていません`}
          description={loaderData.requiresLogin ? "ログインすると表示できる場合があります。" : undefined}
        >
          {loaderData.requiresLogin && (
            <Button asChild>
              <Link to={`/login?redirectTo=/users/${loaderData.profile.id}`}>ログイン</Link>
            </Button>
          )}
        </EmptyState>
      </PageContainer>
    );
  }
  const { profile, interests, posted, participated, activities, endorsements, isSelf } = loaderData;
  return (
    <PageContainer className="max-w-5xl">
      <ProfileHeader
        name={profile.name}
        grade={profile.grade}
        bio={profile.bio}
        interests={interests}
        actions={
          isSelf ? (
            <Button variant="outline" asChild>
              <Link to="/settings">プロフィールを編集</Link>
            </Button>
          ) : (
            <ReportDialog targetType="user" targetId={profile.id} reasons={["inappropriate", "personal_info", "spam", "other"]} />
          )
        }
      />
      <Tabs defaultValue="posted" className="mt-8">
        <TabsList>
          <TabsTrigger value="posted">投稿したイベント（{posted.length}）</TabsTrigger>
          <TabsTrigger value="participated">参加したイベント（{participated.length}）</TabsTrigger>
          <TabsTrigger value="activities">活動報告（{activities.length}）</TabsTrigger>
          {endorsements.length > 0 && (
            <TabsTrigger value="endorsements">おすすめしたイベント（{endorsements.length}）</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="posted" className="mt-4">
          {posted.length ? <EventGrid events={posted} /> : <EmptyState title="投稿したイベントはありません" />}
        </TabsContent>
        <TabsContent value="participated" className="mt-4">
          {participated.length ? (
            <EventGrid events={participated} />
          ) : (
            <EmptyState title="参加したイベントはまだありません" />
          )}
        </TabsContent>
        {endorsements.length > 0 && (
          <TabsContent value="endorsements" className="mt-4">
            <EndorsementExcerptList items={endorsements} />
          </TabsContent>
        )}
        <TabsContent value="activities" className="mt-4">
          {activities.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {activities.map((a) => (
                <ActivityCard key={a.id} activity={a} />
              ))}
            </div>
          ) : (
            <EmptyState title="活動報告はまだありません" />
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
