import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

export function AdminTitle({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  published: { label: "公開", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  visible: { label: "表示中", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  active: { label: "有効", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  hidden: { label: "非公開", className: "border-amber-300 bg-amber-50 text-amber-800" },
  merged: { label: "統合済み", className: "border-slate-200 bg-slate-50 text-slate-600" },
  deleted: { label: "削除済み", className: "border-slate-200 bg-slate-50 text-slate-600" },
  banned: { label: "利用停止", className: "border-red-200 bg-red-50 text-red-700" },
  missing: { label: "存在しない", className: "border-slate-200 bg-slate-50 text-slate-600" },
  open: { label: "未対応", className: "border-red-200 bg-red-50 text-red-700" },
  resolved: { label: "対応済み", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  dismissed: { label: "却下", className: "border-slate-200 bg-slate-50 text-slate-600" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("font-medium", s.className, className)}>
      {s.label}
    </Badge>
  );
}
