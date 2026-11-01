import { APIError } from "better-auth/api";
import { PartyPopper } from "lucide-react";
import { useEffect } from "react";
import { data, Form, useActionData, useNavigation, useSearchParams } from "react-router";
import { toast } from "sonner";
import { getAuth } from "~/.server/auth";
import { createDb } from "~/.server/db";
import { getActiveCategories } from "~/.server/services/events";
import {
  getNotificationSettings,
  saveNotificationSettings,
} from "~/.server/services/notifications";
import { getInterests, getUserById, replaceInterests, updateProfile } from "~/.server/services/users";
import { enforceRateLimit } from "~/.server/rate-limit";
import { requireUser } from "~/.server/session";
import { flattenErrors, formDataToObject } from "~/.server/validation/common";
import { interestsSchema, passwordSchema, profileSchema } from "~/.server/validation/user";
import { FormField } from "~/components/form-field";
import { PageContainer, PageHeader } from "~/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { GRADE_OPTIONS, NOTIFICATION_TYPE_LABEL, VISIBILITY_LABEL } from "~/lib/labels";
import type { Route } from "./+types/settings";

export const meta = () => [{ title: "設定 | Event Share" }];

export async function loader({ context, request }: Route.LoaderArgs) {
  const sessionUser = requireUser(context, request);
  const db = createDb();
  const [profile, interests, categories, notifications] = await Promise.all([
    getUserById(db, sessionUser.id),
    getInterests(db, sessionUser.id),
    getActiveCategories(db),
    getNotificationSettings(db, sessionUser.id),
  ]);
  if (!profile) throw data("Not found", { status: 404 });
  return {
    profile: {
      name: profile.name,
      email: profile.email,
      grade: profile.grade,
      bio: profile.bio,
      profileVisibility: profile.profileVisibility,
    },
    interests,
    categories,
    notifications,
  };
}

type ActionResult = { section: string; ok: boolean; errors?: Record<string, string>; message?: string };

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context, request);
  await enforceRateLimit("write", user.id);
  const db = createDb();
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "profile") {
    const parsed = profileSchema.safeParse(formDataToObject(form));
    if (!parsed.success) {
      return data<ActionResult>({ section: intent, ok: false, errors: flattenErrors(parsed.error) }, { status: 400 });
    }
    await updateProfile(db, user.id, parsed.data);
    return { section: intent, ok: true, message: "プロフィールを保存しました" } satisfies ActionResult;
  }
  if (intent === "interests") {
    const parsed = interestsSchema.parse(formDataToObject(form, ["categoryIds"]));
    await replaceInterests(db, user.id, parsed.categoryIds, parsed.keywords, "manual");
    return { section: intent, ok: true, message: "興味・関心を保存しました" } satisfies ActionResult;
  }
  if (intent === "notifications") {
    await saveNotificationSettings(db, user.id, {
      newEvent: form.get("newEvent") === "on",
      deadlineSoon: form.get("deadlineSoon") === "on",
      eventSoon: form.get("eventSoon") === "on",
      comment: form.get("comment") === "on",
      reaction: form.get("reaction") === "on",
      newEdition: form.get("newEdition") === "on",
    });
    return { section: intent, ok: true, message: "通知設定を保存しました" } satisfies ActionResult;
  }
  if (intent === "password") {
    const parsed = passwordSchema.safeParse(formDataToObject(form));
    if (!parsed.success) {
      return data<ActionResult>({ section: intent, ok: false, errors: flattenErrors(parsed.error) }, { status: 400 });
    }
    try {
      const { headers } = await getAuth().api.changePassword({
        body: {
          currentPassword: parsed.data.currentPassword,
          newPassword: parsed.data.newPassword,
          revokeOtherSessions: true,
        },
        headers: request.headers,
        returnHeaders: true,
      });
      return data<ActionResult>(
        { section: intent, ok: true, message: "パスワードを変更しました（他の端末はログアウトされました）" },
        { headers },
      );
    } catch (error) {
      const message =
        error instanceof APIError ? "現在のパスワードが正しくありません" : "パスワードを変更できませんでした";
      return data<ActionResult>(
        { section: intent, ok: false, errors: { currentPassword: message } },
        { status: 400 },
      );
    }
  }
  throw data("不正なリクエストです", { status: 400 });
}

function SaveButton({ intent }: { intent: string }) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting" && navigation.formData?.get("intent") === intent;
  return (
    <Button type="submit" name="intent" value={intent} disabled={busy}>
      {busy ? "保存中…" : "保存する"}
    </Button>
  );
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { profile, interests, categories, notifications } = loaderData;
  const actionData = useActionData<ActionResult>();
  const [params] = useSearchParams();
  const errorsFor = (section: string) =>
    actionData?.section === section ? (actionData.errors ?? {}) : {};
  const interestIds = new Set(interests.map((i) => i.categoryId).filter(Boolean));
  const keywords = interests.filter((i) => !i.categoryId).map((i) => i.label);

  useEffect(() => {
    if (actionData?.ok && actionData.message) toast.success(actionData.message);
  }, [actionData]);

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title="設定" description="プロフィール・興味のある分野・通知を設定できます。" />
      {params.get("welcome") && (
        <Alert className="mb-6 border-primary/30 bg-brand-soft/60">
          <PartyPopper />
          <AlertTitle>Event Share へようこそ！</AlertTitle>
          <AlertDescription>
            興味のある分野を登録すると、トップページのおすすめや新着イベントの通知があなた向けになります。
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>プロフィール</CardTitle>
            <CardDescription>公開範囲を選べます。メールアドレスは公開されません。</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-4">
              <FormField id="name" label="表示名" error={errorsFor("profile").name} required>
                <Input id="name" name="name" defaultValue={profile.name} maxLength={30} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="grade" label="学年（任意）">
                  <NativeSelect id="grade" name="grade" defaultValue={profile.grade ?? ""}>
                    <option value="">未設定</option>
                    {GRADE_OPTIONS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField id="profileVisibility" label="プロフィールの公開範囲">
                  <NativeSelect id="profileVisibility" name="profileVisibility" defaultValue={profile.profileVisibility}>
                    {Object.entries(VISIBILITY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
              </div>
              <FormField
                id="bio"
                label="自己紹介（任意）"
                error={errorsFor("profile").bio}
                hint="本名・学校名・連絡先などの個人情報は書かないでください。"
              >
                <Textarea id="bio" name="bio" defaultValue={profile.bio ?? ""} rows={4} maxLength={500} />
              </FormField>
              <div className="flex justify-end">
                <SaveButton intent="profile" />
              </div>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>興味・関心のある分野</CardTitle>
            <CardDescription>おすすめイベントや新着イベントの通知に使われます。</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-4">
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <label key={c.id} className="cursor-pointer">
                    <input
                      type="checkbox"
                      name="categoryIds"
                      value={c.id}
                      defaultChecked={interestIds.has(c.id)}
                      className="peer sr-only"
                    />
                    <span className="inline-block rounded-full border bg-card px-3 py-1 text-sm text-muted-foreground transition peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50">
                      {c.name}
                    </span>
                  </label>
                ))}
              </div>
              <FormField id="keywords" label="キーワード（任意）" hint="読点やスペース区切りで入力（例: ロボット、宇宙、Python）">
                <Input id="keywords" name="keywords" defaultValue={keywords.join("、")} maxLength={300} />
              </FormField>
              <div className="flex justify-end">
                <SaveButton intent="interests" />
              </div>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>通知設定</CardTitle>
            <CardDescription>受け取る通知の種類を選べます（サイト内の通知ページに届きます）。</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-3">
              {(
                [
                  ["newEvent", "new_event", "興味のある分野のイベントが投稿されたとき"],
                  ["deadlineSoon", "deadline_soon", "お気に入りイベントの応募締切の3日前"],
                  ["eventSoon", "event_soon", "お気に入り・参加予定イベントの開催2日前"],
                  ["comment", "comment", "投稿・コメントしたイベントに新しいコメントがあったとき"],
                  ["reaction", "reaction", "自分の投稿にいいね・お気に入りがあったとき"],
                  ["newEdition", "new_edition", "ウォッチ中のシリーズや、お気に入り・参加した回の新しい回が登録されたとき"],
                ] as const
              ).map(([name, type, description]) => (
                <div key={name} className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <Label htmlFor={`n-${name}`} className="grid gap-0.5 font-normal">
                    <span className="font-medium">{NOTIFICATION_TYPE_LABEL[type]}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
                  </Label>
                  <Switch id={`n-${name}`} name={name} defaultChecked={notifications[name]} />
                </div>
              ))}
              <div className="flex justify-end">
                <SaveButton intent="notifications" />
              </div>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>アカウント</CardTitle>
            <CardDescription>ログイン用メールアドレス: {profile.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-4">
              <FormField id="currentPassword" label="現在のパスワード" error={errorsFor("password").currentPassword}>
                <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="newPassword" label="新しいパスワード" error={errorsFor("password").newPassword} hint="8文字以上">
                  <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" />
                </FormField>
                <FormField id="confirmPassword" label="新しいパスワード（確認）" error={errorsFor("password").confirmPassword}>
                  <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" />
                </FormField>
              </div>
              <div className="flex justify-end">
                <Button type="submit" name="intent" value="password" variant="outline">
                  パスワードを変更
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
