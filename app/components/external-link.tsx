import { ExternalLink as ExternalIcon } from "lucide-react";
import { safeExternalUrl } from "~/lib/url";
import { cn } from "~/lib/utils";

/** Renders nothing when the URL is missing or not http(s). */
export function ExternalLink({
  href,
  children,
  className,
  icon = true,
}: {
  href: string | null | undefined;
  children: React.ReactNode;
  className?: string;
  icon?: boolean;
}) {
  const safe = safeExternalUrl(href);
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className={cn("inline-flex items-center gap-1", className)}
    >
      {children}
      {icon && <ExternalIcon className="size-3.5 shrink-0" aria-hidden />}
      <span className="sr-only">（外部サイトが新しいタブで開きます）</span>
    </a>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Plain text with http(s) URLs turned into safe external links. */
export function Linkified({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <p className={cn("break-words whitespace-pre-wrap", className)}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <ExternalLink key={i} href={part} icon={false} className="text-primary underline underline-offset-2">
            {part}
          </ExternalLink>
        ) : (
          part
        ),
      )}
    </p>
  );
}
