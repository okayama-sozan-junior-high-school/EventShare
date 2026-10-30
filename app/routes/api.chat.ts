import { data } from "react-router";
import { z } from "zod";
import { getAiClient } from "~/.server/ai/client";
import { runChatTurn } from "~/.server/chat/engine";
import { appendChatTurn, deleteChatSession, recommendationCards } from "~/.server/chat/store";
import { chatStateSchema, emptyState } from "~/.server/chat/types";
import { getConfig } from "~/.server/config";
import { createDb } from "~/.server/db";
import { categoryIdsForSlugs, getActiveCategories } from "~/.server/services/events";
import { addInterests } from "~/.server/services/users";
import { checkRateLimit } from "~/.server/rate-limit";
import { getRequestInfo, getUser } from "~/.server/session";
import type { Route } from "./+types/api.chat";

const messageSchema = z.object({
  message: z.string().trim().min(1, "メッセージを入力してください").max(500, "500文字以内で入力してください"),
  sessionId: z.string().uuid().optional().or(z.literal("")),
});

function parseState(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string" || raw.length > 5000) return emptyState();
  try {
    const parsed = chatStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : emptyState();
  } catch {
    return emptyState();
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = getUser(context);
  const form = await request.formData();
  const intent = form.get("intent") ?? "message";
  const db = createDb();

  if (intent === "save_interests") {
    if (!user) return data({ ok: false, error: "ログインが必要です" }, { status: 401 });
    const state = parseState(form.get("state"));
    const ids = await categoryIdsForSlugs(db, state.categories);
    await addInterests(db, user.id, ids, state.keywords);
    return { ok: true, error: null };
  }

  if (intent === "delete_session") {
    if (!user) return data({ ok: false, error: "ログインが必要です" }, { status: 401 });
    await deleteChatSession(db, user.id, String(form.get("sessionId")));
    return { ok: true, error: null };
  }

  const key = user?.id ?? getRequestInfo(context).clientIp;
  if (!(await checkRateLimit("ai", key))) {
    return data(
      { ok: false, error: "短時間にメッセージが集中しています。少し待ってから送ってください。" },
      { status: 429 },
    );
  }
  const parsed = messageSchema.safeParse({
    message: form.get("message"),
    sessionId: form.get("sessionId") ?? undefined,
  });
  if (!parsed.success) {
    return data({ ok: false, error: parsed.error.issues[0].message }, { status: 400 });
  }

  const now = new Date();
  const { timeZone } = getConfig();
  const turn = await runChatTurn(
    { db, ai: getAiClient(), categories: await getActiveCategories(db), now, timeZone },
    parseState(form.get("state")),
    parsed.data.message,
  );

  let sessionId: string | null = null;
  if (user) {
    sessionId = await appendChatTurn(db, user.id, parsed.data.sessionId || null, {
      userMessage: parsed.data.message,
      reply: turn.reply,
      recommendations: turn.recommendations,
      state: turn.state,
    });
  }

  return {
    ok: true,
    error: null,
    reply: turn.reply,
    quickReplies: turn.quickReplies,
    recommendations: await recommendationCards(db, turn.recommendations, now),
    state: turn.state,
    sessionId,
    usedAi: turn.usedAi,
    canSaveInterests: turn.canSaveInterests && !!user,
  };
}
