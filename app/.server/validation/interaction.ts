import { z } from "zod";
import { REPORT_REASONS, REPORT_TARGETS } from "../db/schema";
import { optionalText } from "./common";

export const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "コメントを入力してください")
    .max(1000, "コメントは1000文字以内で入力してください"),
});

export const reportSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS, { error: "理由を選んでください" }),
  detail: optionalText(1000),
  duplicateOfEventId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => {
      if (!v) return null;
      // Accept either a raw id or a pasted event URL.
      const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(v);
      return m ? m[1].toLowerCase() : null;
    }),
});
