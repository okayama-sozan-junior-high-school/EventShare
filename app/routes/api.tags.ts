import { createDb } from "~/.server/db";
import { enforceRateLimit } from "~/.server/rate-limit";
import { listSuggestedTags } from "~/.server/services/tags";
import { getRequestInfo } from "~/.server/session";
import type { Route } from "./+types/api.tags";

/** Public tag suggestions for the event form. */
export async function loader({ request, context }: Route.LoaderArgs) {
  await enforceRateLimit("fetch", getRequestInfo(context).clientIp);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const tags = await listSuggestedTags(createDb(), {
    q: q.slice(0, 50),
    limit: q.trim() ? 10 : 100,
  });
  return { tags };
}
