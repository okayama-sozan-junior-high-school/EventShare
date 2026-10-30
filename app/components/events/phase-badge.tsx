import { Badge } from "~/components/ui/badge";
import { PHASE_LABEL, type EventPhase } from "~/lib/event-phase";
import { cn } from "~/lib/utils";

const STYLE: Record<EventPhase, string> = {
  open: "bg-emerald-50 text-emerald-700 border-emerald-200",
  closing: "bg-amber-50 text-amber-800 border-amber-300",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
  ongoing: "bg-sky-50 text-sky-700 border-sky-200",
  ended: "bg-slate-100 text-slate-500 border-slate-200",
  unknown: "bg-slate-50 text-slate-600 border-slate-200",
};

export function PhaseBadge({ phase, className }: { phase: EventPhase; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-semibold", STYLE[phase], className)}>
      {PHASE_LABEL[phase]}
    </Badge>
  );
}
