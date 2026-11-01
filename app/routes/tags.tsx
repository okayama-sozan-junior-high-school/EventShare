import { Link } from "react-router";
import { createDb } from "~/.server/db";
import { listPopularTags, listTagsByFacet } from "~/.server/services/tags";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Badge } from "~/components/ui/badge";
import type { Route } from "./+types/tags";

export const meta = () => [{ title: "タグから探す | Event Share" }];

export async function loader() {
  const db = createDb();
  const [groups, popular] = await Promise.all([listTagsByFacet(db), listPopularTags(db, 20)]);
  return { groups, popular };
}

export default function TagsIndex({ loaderData }: Route.ComponentProps) {
  const { groups, popular } = loaderData;
  return (
    <PageContainer>
      <PageHeader
        title="タグから探す"
        description="参加のしやすさや時期、得られるものから、同じ系統のイベントを探せます。"
      />
      {popular.length > 0 && (
        <section className="mb-10" aria-labelledby="popular-tags">
          <h2 id="popular-tags" className="mb-3 text-base font-semibold">
            よく使われているタグ
          </h2>
          <ul className="flex flex-wrap gap-2">
            {popular.map((tag) => (
              <li key={tag.slug}>
                <Link to={`/tags/${encodeURIComponent(tag.slug)}`}>
                  <Badge variant="secondary" className="h-7 px-3 font-normal">
                    {tag.name}
                    <span className="text-muted-foreground">{tag.useCount}</span>
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid gap-8">
        {groups.map((group) => (
          <section key={group.facet} aria-labelledby={`facet-${group.facet}`}>
            <h2 id={`facet-${group.facet}`} className="mb-3 text-base font-semibold">
              {group.label}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {group.tags.map((tag) => (
                <li key={tag.slug}>
                  <Link to={`/tags/${encodeURIComponent(tag.slug)}`}>
                    <Badge variant="outline" className="h-7 px-3 font-normal hover:bg-accent">
                      {tag.name}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageContainer>
  );
}
