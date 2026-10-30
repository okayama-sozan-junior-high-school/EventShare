import { getAuth } from "~/.server/auth";
import { checkRateLimit } from "~/.server/rate-limit";
import { getRequestInfo } from "~/.server/session";
import type { Route } from "./+types/api.auth.$";

export async function loader({ request }: Route.LoaderArgs) {
  return getAuth().handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  const { clientIp } = getRequestInfo(context);
  if (!(await checkRateLimit("auth", clientIp))) {
    return Response.json(
      { message: "短時間にリクエストが集中しています。しばらく待ってから再度お試しください。" },
      { status: 429 },
    );
  }
  return getAuth().handler(request);
}
