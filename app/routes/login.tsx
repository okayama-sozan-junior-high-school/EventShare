import { APIError } from "better-auth/api";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { getAuth } from "~/.server/auth";
import { checkRateLimit } from "~/.server/rate-limit";
import { getRequestInfo, getUser, safeRedirectPath } from "~/.server/session";
import { formDataToObject, flattenErrors } from "~/.server/validation/common";
import { loginSchema } from "~/.server/validation/auth";
import { AuthCard } from "~/components/auth-card";
import { FormError, FormField } from "~/components/form-field";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { Route } from "./+types/login";

export const meta = () => [{ title: "ログイン | Event Share" }];

export function loader({ context, request }: Route.LoaderArgs) {
  if (getUser(context)) {
    const to = new URL(request.url).searchParams.get("redirectTo");
    throw redirect(safeRedirectPath(to));
  }
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { clientIp } = getRequestInfo(context);
  if (!(await checkRateLimit("auth", clientIp))) {
    return data(
      { errors: {}, formError: "ログインの試行回数が多すぎます。しばらく待ってから再度お試しください。" },
      { status: 429 },
    );
  }
  const parsed = loginSchema.safeParse(formDataToObject(await request.formData()));
  if (!parsed.success) {
    return data({ errors: flattenErrors(parsed.error), formError: null }, { status: 400 });
  }
  const { email, password, redirectTo } = parsed.data;
  try {
    const { headers } = await getAuth().api.signInEmail({
      body: { email, password },
      headers: request.headers,
      returnHeaders: true,
    });
    return redirect(safeRedirectPath(redirectTo), { headers });
  } catch (error) {
    const message =
      error instanceof APIError && error.status === "FORBIDDEN"
        ? (error.body?.message ?? "このアカウントは利用できません。")
        : "メールアドレスまたはパスワードが正しくありません。";
    return data({ errors: {}, formError: message }, { status: 400 });
  }
}

export default function Login({ actionData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const errors: Record<string, string> = actionData?.errors ?? {};
  const redirectTo = params.get("redirectTo") ?? "/";
  return (
    <AuthCard
      title="ログイン"
      description="イベントの投稿・コメント・お気に入りにはログインが必要です。"
      footer={
        <>
          アカウントをお持ちでない方は{" "}
          <Link to={`/signup?redirectTo=${encodeURIComponent(redirectTo)}`} className="font-medium text-primary underline-offset-2 hover:underline">
            新規登録
          </Link>
        </>
      }
    >
      <Form method="post" className="grid gap-4" noValidate>
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <FormError message={actionData?.formError} />
        <FormField id="email" label="メールアドレス" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!errors.email} />
        </FormField>
        <FormField id="password" label="パスワード" error={errors.password}>
          <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!errors.password} />
        </FormField>
        <Button type="submit" disabled={navigation.state !== "idle"} className="mt-2">
          {navigation.state === "submitting" ? "ログイン中…" : "ログイン"}
        </Button>
      </Form>
    </AuthCard>
  );
}
