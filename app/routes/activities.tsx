import { NotebookPen, PenLine } from "lucide-react";
import { Link } from "react-router";
import { createDb } from "~/.server/db";
import { countActivities, listActivities } from "~/.server/services/activities";
import { ActivityCard } from "~/components/activities/activity-card";
import { EmptyState } from "~/components/empty-state";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Pagination } from "~/components/pagination";
import { Button } from "~/components/ui/button";
import type { Route } from "./+types/activities";

export const meta = () => [{ title: "活動報告 | Event Share" }];

const PAGE_SIZE = 20;

export async function loader({ request }: Route.LoaderArgs) {
  const db = createDb();
  const page = Math.max(1, Math.min(500, Number(new URL(request.url).searchParams.get("page")) || 1));
  const [items, total] = await Promise.all([
    listActivities(db, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countActivities(db),
  ]);
  return { items, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export default function Activities({ loaderData }: Route.ComponentProps) {
  const { items, page, pageCount } = loaderData;
  return (
    <PageContainer>
      <PageHeader
        title="活動報告"
        description="イベントに参加した生徒の体験談。次の挑戦のヒントを見つけよう。"
        actions={
          <Button asChild>
            <Link to="/activities/new">
              <PenLine /> 活動報告を書く
            </Link>
          </Button>
        }
      />
      {items.length > 0 ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((a) => (
              <ActivityCard key={a.id} activity={a} />
            ))}
          </div>
          <Pagination page={page} pageCount={pageCount} />
        </>
      ) : (
        <EmptyState
          icon={NotebookPen}
          title="まだ活動報告はありません"
          description="イベントに参加したら、参加した理由や学んだことを共有してみましょう。"
        />
      )}
    </PageContainer>
  );
}
