import { data, redirect, type RouterContextProvider } from "react-router";
import { getAuth } from "./auth";
import { requestInfoContext, sessionContext } from "./context";

type Ctx = Readonly<RouterContextProvider>;

export async function loadSession(request: Request) {
  try {
    return await getAuth().api.getSession({ headers: request.headers });
  } catch {
    return null;
  }
}

export function getSession(context: Ctx) {
  return context.get(sessionContext);
}

export function getUser(context: Ctx) {
  return context.get(sessionContext)?.user ?? null;
}

export function isAdmin(user: { role?: string | null } | null | undefined) {
  return user?.role === "admin";
}

/** Redirects anonymous users to the login page and returns to `request.url` afterwards. */
export function requireUser(context: Ctx, request: Request) {
  const user = getUser(context);
  if (!user) {
    const url = new URL(request.url);
    const redirectTo = `${url.pathname}${url.search}`;
    throw redirect(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  }
  return user;
}

export function requireAdmin(context: Ctx, request: Request) {
  const user = requireUser(context, request);
  if (!isAdmin(user)) {
    throw data("この操作には管理者権限が必要です。", { status: 403 });
  }
  return user;
}

export function getRequestInfo(context: Ctx) {
  return context.get(requestInfoContext);
}

/** Only allow same-site relative redirect targets. */
export function safeRedirectPath(value: unknown, fallback = "/") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return fallback;
  return value;
}
