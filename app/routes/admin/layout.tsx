import {
  Flag,
  FolderTree,
  GitMerge,
  Tags,
  History,
  LayoutDashboard,
  MessageSquare,
  Settings2,
  Ticket,
  Users,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { requireAdmin } from "~/.server/session";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/layout";

export const middleware: Route.MiddlewareFunction[] = [
  ({ context, request }) => {
    requireAdmin(context, request);
  },
];

// A loader makes the admin middleware run on every client-side navigation.
export function loader() {
  return null;
}

export const meta = () => [{ title: "管理画面 | Event Share" }, { name: "robots", content: "noindex" }];

const NAV = [
  { to: "/admin", label: "ダッシュボード", icon: LayoutDashboard, end: true },
  { to: "/admin/reports", label: "報告", icon: Flag },
  { to: "/admin/events", label: "イベント", icon: Ticket },
  { to: "/admin/merge", label: "重複の統合", icon: GitMerge },
  { to: "/admin/users", label: "ユーザー", icon: Users },
  { to: "/admin/comments", label: "コメント", icon: MessageSquare },
  { to: "/admin/categories", label: "カテゴリ", icon: FolderTree },
  { to: "/admin/tags", label: "タグ", icon: Tags },
  { to: "/admin/history", label: "投稿・編集履歴", icon: History },
  { to: "/admin/settings", label: "重複判定の設定", icon: Settings2 },
];

export default function AdminLayout() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8 md:grid-cols-[200px_1fr]">
      <aside>
        <p className="mb-3 px-2 text-xs font-semibold tracking-wide text-muted-foreground">管理画面</p>
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="管理メニュー">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <item.icon className="size-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
