import { ImageIcon } from "lucide-react";
import { FormField } from "~/components/form-field";
import { Badge } from "~/components/ui/badge";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import { Textarea } from "~/components/ui/textarea";
import { FEE_LABEL, FORMAT_LABEL } from "~/lib/labels";
import { cn } from "~/lib/utils";

export type EventFormValues = Partial<Record<string, string | string[] | undefined>> & {
  categoryIds?: string[];
};

export type FieldSource = "structured" | "meta" | "text" | "ai" | "previous";

const SOURCE_BADGE: Record<FieldSource, { label: string; className: string }> = {
  structured: { label: "ページから取得", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  meta: { label: "ページから取得", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  text: { label: "本文から抽出・要確認", className: "border-amber-300 bg-amber-50 text-amber-800" },
  ai: { label: "AIが推定・要確認", className: "border-violet-300 bg-violet-50 text-violet-800" },
  previous: { label: "前回から引き継ぎ・要確認", className: "border-amber-300 bg-amber-50 text-amber-800" },
};

type Props = {
  categories: { id: number; name: string }[];
  values: EventFormValues;
  errors?: Record<string, string>;
  sources?: Partial<Record<string, FieldSource>>;
  /** Shown under the date heading, e.g. the previous edition's schedule. */
  dateHint?: string;
  /** Fields that cannot be changed (add-info mode: already filled). */
  locked?: string[];
  imagePreviewUrl?: string | null;
  allowRemoveImage?: boolean;
};

function str(v: unknown) {
  return typeof v === "string" ? v : "";
}

export function EventForm({
  categories,
  values,
  errors = {},
  sources = {},
  dateHint,
  locked = [],
  imagePreviewUrl,
  allowRemoveImage,
}: Props) {
  const isLocked = (f: string) => locked.includes(f);
  const label = (text: string, field: string) => {
    const src = sources[field === "image" ? "imageUrl" : field];
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {text}
        {src && (
          <Badge variant="outline" className={cn("h-5 text-[10px] font-medium", SOURCE_BADGE[src].className)}>
            {SOURCE_BADGE[src].label}
          </Badge>
        )}
        {isLocked(field) && (
          <Badge variant="outline" className="h-5 text-[10px] font-normal text-muted-foreground">
            登録済み
          </Badge>
        )}
      </span>
    );
  };
  const field = (name: string) => ({
    id: `ev-${name}`,
    name,
    defaultValue: str(values[name]),
    disabled: isLocked(name),
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `ev-${name}-error` : undefined,
  });
  const selected = new Set(values.categoryIds ?? []);

  return (
    <div className="grid gap-8">
      <section className="grid gap-5" aria-labelledby="sec-basic">
        <h2 id="sec-basic" className="text-base font-semibold">
          基本情報
        </h2>
        <FormField id="ev-title" label={label("イベント名", "title")} error={errors.title} required>
          <Input {...field("title")} maxLength={120} required placeholder="例: 高校生AIハッカソン 2026" />
        </FormField>

        <fieldset className="grid min-w-0 gap-2">
          <legend className="mb-1.5 text-sm font-medium">
            カテゴリ <span className="ml-1 text-xs font-normal text-destructive">必須</span>
            <span className="ml-2 text-xs font-normal text-muted-foreground">複数選択できます（最大5つ）</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <label key={c.id} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="categoryIds"
                  value={c.id}
                  defaultChecked={selected.has(String(c.id))}
                  className="peer sr-only"
                />
                <span className="inline-block rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground transition peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50">
                  {c.name}
                </span>
              </label>
            ))}
          </div>
          {errors.categoryIds && <p className="text-xs font-medium text-destructive">{errors.categoryIds}</p>}
        </fieldset>

        <FormField
          id="ev-description"
          label={label("概要・説明", "description")}
          error={errors.description}
          hint="どんなイベントか、何ができるか、参加するメリットなど。個人の連絡先は書かないでください。"
        >
          <Textarea {...field("description")} rows={6} maxLength={5000} />
        </FormField>

        <div className="grid gap-2">
          <Label htmlFor="ev-image">{label("イベント画像（任意）", "image")}</Label>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid aspect-[16/9] w-full max-w-56 place-items-center overflow-hidden rounded-lg border bg-muted">
              {imagePreviewUrl ? (
                <img src={imagePreviewUrl} alt="現在の画像" className="size-full object-cover" />
              ) : (
                <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
              )}
            </div>
            <div className="grid gap-2">
              <Input id="ev-image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" />
              <p className="text-xs text-muted-foreground">JPEG / PNG / WebP / GIF、5MBまで。ポスターやバナーなど。</p>
              {allowRemoveImage && imagePreviewUrl && (
                <div className="flex items-center gap-2">
                  <Checkbox id="ev-remove-image" name="removeImage" />
                  <Label htmlFor="ev-remove-image" className="text-sm font-normal">
                    画像を削除する
                  </Label>
                </div>
              )}
            </div>
          </div>
          {errors.image && <p className="text-xs font-medium text-destructive">{errors.image}</p>}
          {values.importedImageId && (
            <input type="hidden" name="importedImageId" value={str(values.importedImageId)} />
          )}
        </div>
      </section>

      <section className="grid gap-5" aria-labelledby="sec-date">
        <h2 id="sec-date" className="text-base font-semibold">
          日時
        </h2>
        {dateHint && <p className="-mt-3 text-xs text-muted-foreground">{dateHint}</p>}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="ev-startAt" label={label("開催日時", "startAt")} error={errors.startAt} hint="未定の場合は空欄">
            <Input {...field("startAt")} type="datetime-local" />
          </FormField>
          <FormField id="ev-endAt" label={label("終了日時（任意）", "endAt")} error={errors.endAt}>
            <Input {...field("endAt")} type="datetime-local" />
          </FormField>
        </div>
        <FormField
          id="ev-applicationDeadline"
          label={label("応募締切", "applicationDeadline")}
          error={errors.applicationDeadline}
          hint="締切がない・不明な場合は空欄"
          className="sm:max-w-[calc(50%-0.625rem)]"
        >
          <Input {...field("applicationDeadline")} type="datetime-local" />
        </FormField>
      </section>

      <section className="grid gap-5" aria-labelledby="sec-place">
        <h2 id="sec-place" className="text-base font-semibold">
          開催場所
        </h2>
        <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
          <FormField id="ev-format" label={label("開催形式", "format")} error={errors.format}>
            <NativeSelect {...field("format")} defaultValue={str(values.format) || "unknown"}>
              {Object.entries(FORMAT_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="ev-location" label={label("開催場所", "location")} error={errors.location} hint="会場名・住所（市区町村まで）など">
            <Input {...field("location")} maxLength={200} placeholder="例: 岡山県立図書館（岡山市北区）" />
          </FormField>
        </div>
      </section>

      <section className="grid gap-5" aria-labelledby="sec-cond">
        <h2 id="sec-cond" className="text-base font-semibold">
          参加条件
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="ev-organizer" label={label("主催者", "organizer")} error={errors.organizer}>
            <Input {...field("organizer")} maxLength={120} />
          </FormField>
          <FormField id="ev-targetAudience" label={label("対象者", "targetAudience")} error={errors.targetAudience}>
            <Input {...field("targetAudience")} maxLength={200} placeholder="例: 中学生・高校生" />
          </FormField>
        </div>
        <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
          <FormField id="ev-feeType" label={label("参加費", "feeType")} error={errors.feeType}>
            <NativeSelect {...field("feeType")} defaultValue={str(values.feeType) || "unknown"}>
              {Object.entries(FEE_LABEL).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField id="ev-feeDetail" label={label("参加費の詳細（任意）", "feeDetail")} error={errors.feeDetail}>
            <Input {...field("feeDetail")} maxLength={200} placeholder="例: 学生 500円" />
          </FormField>
        </div>
      </section>

      <section className="grid gap-5" aria-labelledby="sec-links">
        <h2 id="sec-links" className="text-base font-semibold">
          リンク
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="ev-officialUrl" label={label("公式サイトURL（任意）", "officialUrl")} error={errors.officialUrl}>
            <Input {...field("officialUrl")} type="url" inputMode="url" placeholder="https://" />
          </FormField>
          <FormField id="ev-applicationUrl" label={label("応募フォームURL（任意）", "applicationUrl")} error={errors.applicationUrl}>
            <Input {...field("applicationUrl")} type="url" inputMode="url" placeholder="https://" />
          </FormField>
        </div>
      </section>
      {values.sourceUrl && <input type="hidden" name="sourceUrl" value={str(values.sourceUrl)} />}
    </div>
  );
}
