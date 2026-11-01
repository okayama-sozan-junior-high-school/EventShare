import { z } from "zod";
import { EVENT_FORMATS, FEE_TYPES } from "../db/schema";
import {
  optionalHttpUrl,
  optionalText,
  optionalZonedDate,
  requiredText,
} from "./common";

export function eventInputSchema(timeZone: string) {
  return z
    .object({
      title: requiredText(120, "イベント名"),
      description: optionalText(5000),
      startAt: optionalZonedDate(timeZone),
      endAt: optionalZonedDate(timeZone),
      applicationDeadline: optionalZonedDate(timeZone),
      location: optionalText(200),
      format: z.enum(EVENT_FORMATS).default("unknown"),
      organizer: optionalText(120),
      targetAudience: optionalText(200),
      feeType: z.enum(FEE_TYPES).default("unknown"),
      feeDetail: optionalText(200),
      officialUrl: optionalHttpUrl,
      applicationUrl: optionalHttpUrl,
      categoryIds: z
        .array(z.coerce.number().int().positive())
        .min(1, "カテゴリを1つ以上選んでください")
        .max(5, "カテゴリは5つまで選べます")
        .transform((ids) => [...new Set(ids)]),
      /** Media id of an image fetched during URL import. */
      importedImageId: z.string().uuid().optional().or(z.literal("")),
      removeImage: z.literal("on").optional(),
      sourceUrl: optionalHttpUrl,
    })
    .superRefine((v, ctx) => {
      if (v.startAt && v.endAt && v.endAt < v.startAt) {
        ctx.addIssue({
          code: "custom",
          path: ["endAt"],
          message: "終了日時は開始日時より後にしてください",
        });
      }
      if (v.startAt && v.applicationDeadline && v.applicationDeadline > (v.endAt ?? v.startAt)) {
        ctx.addIssue({
          code: "custom",
          path: ["applicationDeadline"],
          message: "応募締切は開催日時より前にしてください",
        });
      }
    });
}

export type EventInput = z.infer<ReturnType<typeof eventInputSchema>>;

/** Fields that make up the event itself (excludes form-only helpers). */
export const EVENT_FIELDS = [
  "title",
  "description",
  "startAt",
  "endAt",
  "applicationDeadline",
  "location",
  "format",
  "organizer",
  "targetAudience",
  "feeType",
  "feeDetail",
  "officialUrl",
  "applicationUrl",
] as const;

export type EventField = (typeof EVENT_FIELDS)[number];

export const EVENT_FIELD_LABEL: Record<
  EventField | "categories" | "image" | "tags" | "series" | "editionLabel",
  string
> = {
  title: "イベント名",
  description: "概要",
  startAt: "開催日時",
  endAt: "終了日時",
  applicationDeadline: "応募締切",
  location: "開催場所",
  format: "開催形式",
  organizer: "主催者",
  targetAudience: "対象者",
  feeType: "参加費",
  feeDetail: "参加費の詳細",
  officialUrl: "公式サイトURL",
  applicationUrl: "応募フォームURL",
  categories: "カテゴリ",
  image: "画像",
  tags: "タグ",
  series: "開催回のつながり",
  editionLabel: "回ラベル",
};
