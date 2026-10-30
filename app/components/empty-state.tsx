import type { LucideIcon } from "lucide-react";
import { cn } from "~/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <span className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="size-6" aria-hidden />
        </span>
      )}
      <p className="font-semibold">{title}</p>
      {description && <div className="max-w-md text-sm text-muted-foreground">{description}</div>}
      {children && <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}
