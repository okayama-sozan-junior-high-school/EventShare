import { z } from "zod";
import { optionalHttpUrl, optionalText } from "./common";

export const profileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "表示名を入力してください")
    .max(30, "表示名は30文字以内で入力してください"),
  grade: optionalText(20),
  bio: optionalText(500),
  profileVisibility: z.enum(["public", "members", "private"]).catch("members"),
});

export const interestsSchema = z.object({
  categoryIds: z.array(z.coerce.number().int().positive()).max(20).catch([]),
  keywords: z
    .string()
    .max(300)
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(/[,、\s]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 30)
        .slice(0, 20),
    ),
});

export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください").max(128),
    newPassword: z.string().min(8, "8文字以上にしてください").max(128),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "確認用パスワードが一致しません",
  });

export const activitySchema = z.object({
  eventId: z.string().uuid("参加したイベントを選んでください"),
  title: z.string().trim().min(1, "タイトルを入力してください").max(100, "100文字以内で入力してください"),
  motivation: optionalText(2000),
  activity: z
    .string()
    .trim()
    .min(1, "活動内容を入力してください")
    .max(5000, "5000文字以内で入力してください"),
  reflection: optionalText(5000),
  relatedUrl: optionalHttpUrl,
});
