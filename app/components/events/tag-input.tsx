import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import {
  groupTagsByFacet,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_EVENT,
  normalizeTagName,
  TAG_FACETS,
  type TagFacetKey,
} from "~/lib/tags";

type Suggestion = { name: string; slug: string; facet: TagFacetKey };

function initialTags(value: readonly string[] | undefined) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value ?? []) {
    const name = item.trim();
    const slug = normalizeTagName(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(name);
  }
  return out;
}

export function TagInput({
  id,
  defaultTags,
  lockedTags = [],
  error,
  disabled,
}: {
  id: string;
  defaultTags?: string[];
  /** Normalized or display names that cannot be removed (add-info). */
  lockedTags?: string[];
  error?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [chips, setChips] = useState(() => initialTags(defaultTags));
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const locked = new Set(lockedTags.map((name) => normalizeTagName(name)));

  const isLocked = (name: string) => locked.has(normalizeTagName(name));

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const q = draft.trim();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = q ? `?q=${encodeURIComponent(q)}` : "";
      fetch(`/api/tags${params}`, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) return;
          const body = (await res.json()) as { tags?: Suggestion[] };
          setSuggestions(Array.isArray(body.tags) ? body.tags : []);
        })
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, q ? 150 : 0);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [draft, open]);

  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  function addNames(rawNames: string[]) {
    setChips((prev) => {
      const next = [...prev];
      const seen = new Set(next.map((name) => normalizeTagName(name)));
      for (const raw of rawNames) {
        const slug = normalizeTagName(raw);
        if (!slug) continue;
        if (slug.length > MAX_TAG_LENGTH) {
          setLocalError("タグは1〜20文字で入力してください");
          continue;
        }
        if (seen.has(slug)) continue;
        if (next.length >= MAX_TAGS_PER_EVENT) {
          setLocalError("タグは8個までです");
          break;
        }
        const known = suggestions.find((tag) => tag.slug === slug);
        next.push(known?.name ?? slug);
        seen.add(slug);
        setLocalError(null);
      }
      return next;
    });
  }

  function takeDraft(value: string) {
    if (!/[,、\s]/.test(value)) {
      setDraft(value);
      setLocalError(null);
      return;
    }
    const parts = value.split(/[,、\s]+/);
    const endsWithSeparator = /[,、\s]$/.test(value);
    const complete = endsWithSeparator ? parts : parts.slice(0, -1);
    const rest = endsWithSeparator ? "" : (parts.at(-1) ?? "");
    addNames(complete);
    setDraft(rest);
  }

  function commitDraft() {
    const name = draft;
    setDraft("");
    if (name.trim()) addNames([name]);
  }

  function removeAt(index: number) {
    setChips((prev) => prev.filter((_, i) => i !== index));
    setLocalError(null);
  }

  function removeLastUnlocked() {
    setChips((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (!isLocked(next[i] ?? "")) {
          next.splice(i, 1);
          return next;
        }
      }
      return prev;
    });
  }

  const selected = new Set(chips.map((name) => normalizeTagName(name)));
  const visible = suggestions.filter((tag) => !selected.has(tag.slug));
  const grouped = normalizeTagName(draft) ? null : groupTagsByFacet(visible);
  const message = localError && !error ? localError : null;

  function renderSuggestion(tag: Suggestion) {
    return (
      <li key={tag.slug}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            addNames([tag.name]);
            setDraft("");
          }}
        >
          <span>{tag.name}</span>
          <span className="text-xs text-muted-foreground">{TAG_FACETS[tag.facet]}</span>
        </button>
      </li>
    );
  }

  return (
    <div ref={rootRef} className="grid gap-1.5">
      {chips.map((name) => (
        <input key={normalizeTagName(name)} type="hidden" name="tags" value={name} />
      ))}
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border bg-transparent px-2 py-1.5 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {chips.map((name, index) => {
          const chipLocked = isLocked(name);
          return (
            <Badge key={`${normalizeTagName(name)}-${index}`} variant="secondary" className="gap-1 font-normal">
              {name}
              {chipLocked ? null : (
                <button
                  type="button"
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  aria-label={`${name}を削除`}
                  onClick={() => removeAt(index)}
                  disabled={disabled}
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          );
        })}
        <Input
          id={id}
          value={draft}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={error || message ? true : undefined}
          placeholder={chips.length === 0 ? "タグを入力" : ""}
          className="h-7 min-w-32 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
          onFocus={() => setOpen(true)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            takeDraft(event.currentTarget.value);
          }}
          onChange={(event) => {
            if (composing.current) {
              setDraft(event.target.value);
              return;
            }
            takeDraft(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key === "Process") return;
            if (event.key === "Enter" || event.key === "," || event.key === "、") {
              event.preventDefault();
              commitDraft();
              return;
            }
            if (event.key === "Backspace" && draft === "") {
              event.preventDefault();
              removeLastUnlocked();
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {message && (
        <p className="text-xs font-medium text-destructive" role="alert">
          {message}
        </p>
      )}
      {open && (
        <div className="relative">
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 max-h-60 w-full overflow-auto rounded-lg border bg-card py-1 shadow-md"
          >
            {loading && visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">読み込み中…</li>
            )}
            {!loading && visible.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {normalizeTagName(draft) ? "一致するタグはありません" : "候補がありません"}
              </li>
            )}
            {grouped
              ? grouped.map((group) => (
                  <li key={group.facet}>
                    <p className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</p>
                    <ul>{group.tags.map(renderSuggestion)}</ul>
                  </li>
                ))
              : visible.map(renderSuggestion)}
          </ul>
        </div>
      )}
      <noscript>
        <input
          name="tags"
          className="h-8 w-full rounded-lg border px-2.5 text-sm"
          placeholder="カンマや空白で区切って入力"
        />
      </noscript>
    </div>
  );
}
