import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません").max(254),
  password: z.string().min(1, "パスワードを入力してください").max(128),
  redirectTo: z.string().optional(),
});

export const signupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "表示名を入力してください")
    .max(30, "表示名は30文字以内で入力してください"),
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません").max(254),
  password: z
    .string()
    .min(8, "パスワードは8文字以上にしてください")
    .max(128, "パスワードは128文字以内にしてください"),
  agree: z.literal("on", { error: "利用ガイドラインへの同意が必要です" }),
  redirectTo: z.string().optional(),
});
