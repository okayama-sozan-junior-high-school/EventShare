import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router";
import { Button } from "~/components/ui/button";

export function Pagination({ page, pageCount }: { page: number; pageCount: number }) {
  const location = useLocation();
  if (pageCount <= 1) return null;
  const href = (p: number) => {
    const sp = new URLSearchParams(location.search);
    sp.set("page", String(p));
    return `${location.pathname}?${sp.toString()}`;
  };
  return (
    <nav className="mt-8 flex items-center justify-center gap-2" aria-label="ページ送り">
      <Button variant="outline" size="sm" asChild disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-50" : ""}>
        <Link to={href(Math.max(1, page - 1))} aria-disabled={page <= 1} preventScrollReset={false}>
          <ChevronLeft /> 前へ
        </Link>
      </Button>
      <span className="px-3 text-sm text-muted-foreground">
        {page} / {pageCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        asChild
        className={page >= pageCount ? "pointer-events-none opacity-50" : ""}
      >
        <Link to={href(Math.min(pageCount, page + 1))} aria-disabled={page >= pageCount}>
          次へ <ChevronRight />
        </Link>
      </Button>
    </nav>
  );
}
