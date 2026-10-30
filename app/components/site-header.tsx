import {
  Bell,
  CalendarDays,
  LogOut,
  Menu,
  NotebookPen,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
  Ticket,
  User,
} from "lucide-react";
import { useState } from "react";
import { Form, Link, NavLink } from "react-router";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";
import { cn } from "~/lib/utils";

type HeaderUser = { id: string; name: string; role: string } | null;

const NAV = [
  { to: "/events", label: "イベント", icon: Ticket },
  { to: "/calendar", label: "カレンダー", icon: CalendarDays },
  { to: "/activities", label: "活動報告", icon: NotebookPen },
] as const;

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("flex items-center gap-2 font-bold tracking-tight", className)}>
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Ticket className="size-4.5" aria-hidden />
      </span>
      <span className="text-lg">Event Share</span>
    </Link>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
    isActive ? "text-foreground" : "text-muted-foreground",
  );
}

export function SiteHeader({ user, unread }: { user: HeaderUser; unread: number }) {
  const [open, setOpen] = useState(false);
  const initial = user?.name.slice(0, 1) ?? "";

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="メイン">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
          <NavLink
            to="/chat"
            className={({ isActive }) =>
              cn(
                "ml-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-brand-soft text-primary hover:bg-primary/15",
              )
            }
          >
            <Sparkles className="size-4" aria-hidden />
            AIで探す
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="icon" asChild className="hidden sm:inline-flex">
            <Link to="/events" aria-label="イベントを検索">
              <Search />
            </Link>
          </Button>
          {user ? (
            <>
              <Button variant="ghost" size="icon" asChild className="relative">
                <Link to="/notifications" aria-label={`通知${unread > 0 ? `（未読${unread}件）` : ""}`}>
                  <Bell />
                  {unread > 0 && (
                    <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-bold text-white">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
                </Link>
              </Button>
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link to="/events/new">
                  <Plus /> 投稿する
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full" aria-label="アカウントメニュー">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-secondary text-sm font-semibold">{initial}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="truncate">{user.name}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/me">
                      <User /> マイページ
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to="/settings">
                      <Settings /> 設定
                    </Link>
                  </DropdownMenuItem>
                  {user.role === "admin" && (
                    <DropdownMenuItem asChild>
                      <Link to="/admin">
                        <Shield /> 管理画面
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <Form method="post" action="/logout">
                    <DropdownMenuItem asChild>
                      <button type="submit" className="w-full">
                        <LogOut /> ログアウト
                      </button>
                    </DropdownMenuItem>
                  </Form>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
                <Link to="/login">ログイン</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/signup">新規登録</Link>
              </Button>
            </>
          )}

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="メニューを開く">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>メニュー</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4" aria-label="モバイル">
                <MobileLink to="/chat" onNavigate={() => setOpen(false)} highlight>
                  <Sparkles className="size-4" /> AIでイベントを探す
                </MobileLink>
                {NAV.map((item) => (
                  <MobileLink key={item.to} to={item.to} onNavigate={() => setOpen(false)}>
                    <item.icon className="size-4" /> {item.label}
                  </MobileLink>
                ))}
                {user ? (
                  <>
                    <MobileLink to="/events/new" onNavigate={() => setOpen(false)}>
                      <Plus className="size-4" /> イベントを投稿
                    </MobileLink>
                    <MobileLink to="/me" onNavigate={() => setOpen(false)}>
                      <User className="size-4" /> マイページ
                    </MobileLink>
                  </>
                ) : (
                  <MobileLink to="/login" onNavigate={() => setOpen(false)}>
                    <User className="size-4" /> ログイン
                  </MobileLink>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function MobileLink({
  to,
  children,
  onNavigate,
  highlight,
}: {
  to: string;
  children: React.ReactNode;
  onNavigate: () => void;
  highlight?: boolean;
}) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium",
          highlight && "bg-brand-soft text-primary",
          isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent",
        )
      }
    >
      {children}
    </NavLink>
  );
}
