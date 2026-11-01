import { SearchX } from "lucide-react";
import { data, Link } from "react-router";
import { z } from "zod";
import { createDb } from "~/.server/db";
import { listEventsForTag } from "~/.server/services/tags";
import { EmptyState } from "~/components/empty-state";
import { EventCard } from "~/components/events/event-card";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Pagination } from "~/components/pagination";
import { TAG_FACETS, type TagFacetKey } from "~/lib/tags";
import type { Route } from "./+types/tags.$slug";

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "タグが見つかりません | Event Share" }];
  return [
    { title: `#${loaderData.tag.name} | Event Share` },
    { name: "description", content: `${loaderData.tag.name}のタグが付いたイベント` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const page = z.coerce.number().int().min(1).max(500).catch(1).parse(
    new URL(request.url).searchParams.get("page") ?? undefined,
  );
  const result = await listEventsForTag(createDb(), { slug: params.slug, page });
  if (!result) throw data("タグが見つかりません", { status: 404 });
  return result;
}

export default function TagPage({ loaderData }: Route.ComponentProps) {
  const { tag, items, total, page, pageCount } = loaderData;
  const facet = TAG_FACETS[tag.facet as TagFacetKey] ?? tag.facet;
  return (
    <PageContainer>
      <nav className="mb-4 text-sm text-muted-foreground" aria-label="パンくず">
        <Link to="/tags" className="hover:underline">
          タグ
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">#{tag.name}</span>
      </nav>
      <PageHeader
        title={`#${tag.name}`}
        description={`${facet} · 利用数 ${tag.useCount} · ${total}シリーズ`}
      />
      {items.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((event) => (
              <EventCard key={event.id} event={event} editionCount={event.editionCount} />
            ))}
          </div>
          <Pagination page={page} pageCount={pageCount} />
        </>
      ) : (
        <EmptyState
          icon={SearchX}
          title="このタグのイベントはまだありません"
          description="公開中のイベントにこのタグが付くと、シリーズごとにここに並びます。"
        />
      )}
    </PageContainer>
  );
}
