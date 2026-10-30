import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";

export function ProfileHeader({
  name,
  grade,
  bio,
  interests,
  actions,
}: {
  name: string;
  grade: string | null;
  bio: string | null;
  interests: string[];
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 sm:flex-row sm:items-start">
      <Avatar className="size-16">
        <AvatarFallback className="bg-brand-soft text-2xl font-bold text-primary">{name.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{name}</h1>
          {grade && <Badge variant="secondary">{grade}</Badge>}
        </div>
        {bio && <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">{bio}</p>}
        {interests.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {interests.map((i) => (
              <Badge key={i} variant="outline" className="font-normal">
                {i}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
