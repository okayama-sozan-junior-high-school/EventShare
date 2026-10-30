import { data } from "react-router";
import { createDb } from "~/.server/db";
import { enforceRateLimit } from "~/.server/rate-limit";
import { createReport } from "~/.server/services/interactions";
import { getUser } from "~/.server/session";
import { flattenErrors, formDataToObject } from "~/.server/validation/common";
import { reportSchema } from "~/.server/validation/interaction";
import type { Route } from "./+types/api.report";

export async function action({ request, context }: Route.ActionArgs) {
  const user = getUser(context);
  if (!user) {
    return data({ ok: false, error: "通報するにはログインが必要です。" }, { status: 401 });
  }
  await enforceRateLimit("write", user.id);
  const parsed = reportSchema.safeParse(formDataToObject(await request.formData()));
  if (!parsed.success) {
    const errors = flattenErrors(parsed.error);
    return data({ ok: false, error: Object.values(errors)[0] }, { status: 400 });
  }
  const created = await createReport(createDb(), { reporterId: user.id, ...parsed.data });
  return {
    ok: true,
    error: null,
    message: created
      ? "報告を受け付けました。管理者が内容を確認します。"
      : "この内容はすでに報告済みです。",
  };
}
