import { Plus, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Form, Link, useNavigation, useSubmit } from "react-router";
import { getConfig } from "~/.server/config";
import { createDb } from "~/.server/db";
import { getActiveCategories, parseSearchParams, searchEvents } from "~/.server/services/events";
import { EmptyState } from "~/components/empty-state";
import { EventGrid } from "~/components/events/event-card";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Pagination } from "~/components/pagination";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import { Skeleton } from "~/components/ui/skeleton";
import { SORT_OPTIONS } from "~/lib/labels";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/events";

export const meta = () => [{ title: "イベントを探す | Event Share" }];

export async function loader({ request }: Route.LoaderArgs) {
  const db = createDb();
  const params = parseSearchParams(new URL(request.url).searchParams);
  const [result, categories] = await Promise.all([
    searchEvents(db, params, new Date(), getConfig().timeZone),
    getActiveCategories(db),
  ]);
  return { ...result, params, categories };
}

type Params = Route.ComponentProps["loaderData"]["params"];

function activeFilterCount(p: Params) {
  return [
    p.category.length > 0,
    p.from,
    p.to,
    p.deadline,
    p.location,
    p.format,
    p.fee,
    p.audience,
    p.status !== "upcoming",
  ].filter(Boolean).length;
}

function Filters({
  params,
  categories,
}: {
  params: Params;
  categories: Route.ComponentProps["loaderData"]["categories"];
}) {
  return (
    <div className="grid min-w-0 gap-5">
      <fieldset className="grid min-w-0 gap-2">
        <legend className="mb-2 text-sm font-semibold">カテゴリ</legend>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <label key={c.id} className="cursor-pointer">
              <input
                type="checkbox"
                name="category"
                value={c.slug}
                defaultChecked={params.category.includes(c.slug)}
                className="peer sr-only"
              />
              <span className="inline-block rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground transition peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50">
                {c.name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid min-w-0 gap-2">
        <legend className="mb-2 text-sm font-semibold">開催時期</legend>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-sm">
          <Label htmlFor="f-from" className="font-normal text-muted-foreground">
            から
          </Label>
          <Input id="f-from" type="date" name="from" defaultValue={params.from} />
          <Label htmlFor="f-to" className="font-normal text-muted-foreground">
            まで
          </Label>
          <Input id="f-to" type="date" name="to" defaultValue={params.to} />
        </div>
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="f-deadline">応募締切</Label>
        <NativeSelect id="f-deadline" name="deadline" defaultValue={params.deadline ?? ""}>
          <option value="">指定なし</option>
          <option value="open">応募受付中のみ</option>
          <option value="7d">7日以内に締切</option>
          <option value="30d">30日以内に締切</option>
        </NativeSelect>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="f-format">開催形式</Label>
          <NativeSelect id="f-format" name="format" defaultValue={params.format ?? ""}>
            <option value="">すべて</option>
            <option value="offline">会場で参加</option>
            <option value="online">オンライン</option>
          </NativeSelect>
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="f-fee">参加費</Label>
          <NativeSelect id="f-fee" name="fee" defaultValue={params.fee ?? ""}>
            <option value="">すべて</option>
            <option value="free">無料</option>
            <option value="paid">有料</option>
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="f-location">開催場所</Label>
        <Input id="f-location" name="location" defaultValue={params.location} placeholder="例: 岡山、東京" />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="f-audience">対象者</Label>
        <Input id="f-audience" name="audience" defaultValue={params.audience} placeholder="例: 高校生、中学生" />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="f-status">表示するイベント</Label>
        <NativeSelect id="f-status" name="status" defaultValue={params.status}>
          <option value="upcoming">これから開催（終了済みを除く）</option>
          <option value="ended">終了したイベント</option>
          <option value="all">すべて</option>
        </NativeSelect>
      </div>
    </div>
  );
}

export default function Events({ loaderData }: Route.ComponentProps) {
  const { items, total, page, pageCount, params, categories } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const [showFilters, setShowFilters] = useState(false);
  const loading = navigation.state === "loading" && navigation.location?.pathname === "/events";
  const filterCount = activeFilterCount(params);

  return (
    <PageContainer>
      <PageHeader
        title="イベントを探す"
        description="学校外のイベント・コンテスト・勉強会を、条件を指定して探せます。"
        actions={
          <Button asChild>
            <Link to="/events/new">
              <Plus /> イベントを投稿
            </Link>
          </Button>
        }
      />

      <Form method="get" id="search" role="search" className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="lg:col-start-2">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex flex-1 gap-2">
              <Input
                name="q"
                defaultValue={params.q}
                placeholder="キーワード（イベント名・主催者・説明文）"
                aria-label="キーワード"
                className="h-10 bg-card"
              />
              <Button type="submit" className="h-10">
                検索
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 lg:hidden"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
                aria-controls="filters"
              >
                <SlidersHorizontal /> 絞り込み{filterCount > 0 && `（${filterCount}）`}
              </Button>
              <NativeSelect
                name="sort"
                defaultValue={params.sort}
                aria-label="並び替え"
                className="h-10 bg-card"
                onChange={(e) => submit(e.currentTarget.form)}
              >
                {Object.entries(SORT_OPTIONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </div>

        <aside
          id="filters"
          className={cn(
            "min-w-0 rounded-xl border bg-card p-4 lg:row-span-2 lg:row-start-1 lg:block lg:self-start",
            showFilters ? "block" : "hidden",
          )}
          aria-label="絞り込み条件"
        >
          <Filters params={params} categories={categories} />
          <div className="mt-5 flex gap-2">
            <Button type="submit" className="flex-1">
              この条件で絞り込む
            </Button>
            {filterCount > 0 && (
              <Button variant="ghost" asChild>
                <Link to="/events">
                  <X /> クリア
                </Link>
              </Button>
            )}
          </div>
        </aside>

        <div className="lg:col-start-2">
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {total}件のイベント
            {params.status === "upcoming" && "（終了済みを除く）"}
          </p>
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-80 rounded-xl" />
              ))}
            </div>
          ) : items.length > 0 ? (
            <>
              <EventGrid events={items} />
              <Pagination page={page} pageCount={pageCount} />
            </>
          ) : (
            <EmptyState
              icon={SearchX}
              title="条件に合うイベントが見つかりませんでした"
              description={
                <>
                  キーワードを短くする、絞り込み条件を減らす、「終了したイベント」も含めるなどを試してみてください。
                  <br />
                  知っているイベントがあれば、ぜひ投稿してください。
                </>
              }
            >
              <Button variant="outline" asChild>
                <Link to="/events">条件をリセット</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/chat">AIに相談する</Link>
              </Button>
              <Button asChild>
                <Link to="/events/new">イベントを投稿</Link>
              </Button>
            </EmptyState>
          )}
        </div>
      </Form>
    </PageContainer>
  );
}
