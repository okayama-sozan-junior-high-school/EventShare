import { z } from "zod";
import { endorsementCommentError } from "~/lib/endorsement";
import { ENDORSEMENT_AUDIENCES } from "../db/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const endorsementSchema = z.object({
  audience: z.enum(ENDORSEMENT_AUDIENCES, { error: "向いている人を選んでください" }),
  comment: z
    .string({ error: "一言を入力してください" })
    .superRefine((value, ctx) => {
      const message = endorsementCommentError(value);
      if (message) ctx.addIssue({ code: "custom", message });
    })
    .transform((value) => value.trim()),
  activityReportId: z
    .string()
    .trim()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || UUID_RE.test(value), "活動報告の指定が正しくありません"),
});

export type EndorsementInput = z.infer<typeof endorsementSchema>;
