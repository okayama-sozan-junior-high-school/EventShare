import { z } from "zod";
import { zonedLocalToDate } from "~/lib/datetime";
import { safeExternalUrl } from "~/lib/url";

/** Trimmed optional text: empty string → null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}文字以内で入力してください`)
    .optional()
    .transform((v) => (v ? v : null));

export const requiredText = (max: number, label: string) =>
  z
    .string({ error: `${label}を入力してください` })
    .trim()
    .min(1, `${label}を入力してください`)
    .max(max, `${max}文字以内で入力してください`);

export const optionalHttpUrl = z
  .string()
  .trim()
  .max(2000, "URLが長すぎます")
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const safe = safeExternalUrl(v);
    if (!safe) {
      ctx.addIssue({
        code: "custom",
        message: "http:// または https:// から始まるURLを入力してください",
      });
      return z.NEVER;
    }
    return safe;
  });

export const optionalZonedDate = (timeZone: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = zonedLocalToDate(v, timeZone);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "日時の形式が正しくありません" });
        return z.NEVER;
      }
      return d;
    });

/** FormData → plain object; repeated keys listed in `arrays` become string[]. */
export function formDataToObject(form: FormData, arrays: string[] = []) {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key).filter((v) => typeof v === "string");
    out[key] = arrays.includes(key) ? values : values[0];
  }
  for (const key of arrays) out[key] ??= [];
  return out;
}

export type FieldErrors = Record<string, string>;

export function flattenErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    out[key] ??= issue.message;
  }
  return out;
}
