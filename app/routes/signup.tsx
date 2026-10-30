import { APIError } from "better-auth/api";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { getAuth } from "~/.server/auth";
import { getConfig } from "~/.server/config";
import { checkRateLimit } from "~/.server/rate-limit";
import { getRequestInfo, getUser, safeRedirectPath } from "~/.server/session";
import { flattenErrors, formDataToObject } from "~/.server/validation/common";
import { signupSchema } from "~/.server/validation/auth";
import { AuthCard } from "~/components/auth-card";
import { FormError, FormField } from "~/components/form-field";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import type { Route } from "./+types/signup";

export const meta = () => [{ title: "新規登録 | Event Share" }];

export function loader({ context }: Route.LoaderArgs) {
  if (getUser(context)) throw redirect("/");
  const config = getConfig();
  return {
    domains: config.signupMode === "domain" ? config.schoolEmailDomains : [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { clientIp } = getRequestInfo(context);
  if (!(await checkRateLimit("auth", clientIp))) {
    return data(
      { errors: {} as Record<string, string>, formError: "短時間に登録が集中しています。しばらく待ってから再度お試しください。" },
      { status: 429 },
    );
  }
  const parsed = signupSchema.safeParse(formDataToObject(await request.formData()));
  if (!parsed.success) {
    return data({ errors: flattenErrors(parsed.error), formError: null }, { status: 400 });
  }
  const { name, email, password, redirectTo } = parsed.data;
  try {
    const { headers } = await getAuth().api.signUpEmail({
      body: { name, email, password },
      headers: request.headers,
      returnHeaders: true,
    });
    return redirect(safeRedirectPath(redirectTo, "/settings?welcome=1"), { headers });
  } catch (error) {
    let message = "登録できませんでした。入力内容を確認してください。";
    if (error instanceof APIError) {
      if (error.status === "FORBIDDEN") message = error.body?.message ?? message;
      else if (error.body?.code?.includes("USER_ALREADY_EXISTS"))
        message = "このメールアドレスは既に登録されています。";
      else if (error.body?.code?.includes("PASSWORD"))
        message = "パスワードの条件を満たしていません（8〜128文字）。";
    }
    return data({ errors: {} as Record<string, string>, formError: message }, { status: 400 });
  }
}

export default function Signup({ loaderData, actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const errors: Record<string, string> = actionData?.errors ?? {};
  const redirectTo = params.get("redirectTo") ?? "";
  return (
    <AuthCard
      title="新規登録"
      description="Event Share に参加して、イベント情報を共有しましょう。"
      footer={
        <>
          すでにアカウントをお持ちの方は{" "}
          <Link to="/login" className="font-medium text-primary underline-offset-2 hover:underline">
            ログイン
          </Link>
        </>
      }
    >
      <Form method="post" className="grid gap-4" noValidate>
        {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
        <FormError message={actionData?.formError} />
        <FormField
          id="name"
          label="表示名"
          error={errors.name}
          hint="サイト上に表示される名前です。本名である必要はありません。"
        >
          <Input id="name" name="name" autoComplete="nickname" maxLength={30} required />
        </FormField>
        <FormField
          id="email"
          label="メールアドレス"
          error={errors.email}
          hint={
            loaderData.domains.length > 0
              ? `学校のメールアドレス（${loaderData.domains.map((d) => `@${d}`).join("、")}）で登録してください。メールアドレスは公開されません。`
              : "メールアドレスは他のユーザーに公開されません。"
          }
        >
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </FormField>
        <FormField id="password" label="パスワード" error={errors.password} hint="8文字以上">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </FormField>
        <div className="grid gap-1.5">
          <div className="flex items-start gap-2">
            <Checkbox id="agree" name="agree" className="mt-0.5" />
            <Label htmlFor="agree" className="text-sm leading-snug font-normal">
              <span>
                <Link to="/guidelines" target="_blank" className="text-primary underline underline-offset-2">
                  利用ガイドライン
                </Link>
                に同意します（個人情報を投稿しない・他の人を傷つけない など）
              </span>
            </Label>
          </div>
          {errors.agree && <p className="text-xs font-medium text-destructive">{errors.agree}</p>}
        </div>
        <Button type="submit" disabled={navigation.state !== "idle"} className="mt-2">
          {navigation.state === "submitting" ? "登録中…" : "登録する"}
        </Button>
      </Form>
    </AuthCard>
  );
}
