import { env } from "cloudflare:workers";
import { createDb } from "~/.server/db";
import { getMedia } from "~/.server/media/store";
import type { Route } from "./+types/media.$id";

const ID_RE = /^[0-9a-f-]{36}$/;

export async function loader({ params, request }: Route.LoaderArgs) {
  if (!ID_RE.test(params.id)) return new Response("Not found", { status: 404 });
  const media = await getMedia(createDb(), params.id);
  if (!media) return new Response("Not found", { status: 404 });

  const object = await env.MEDIA.get(media.key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", media.contentType);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  headers.set("content-disposition", "inline");
  headers.set("accept-ranges", "bytes");

  if (!("body" in object) || !object.body) {
    return new Response(null, { status: 304, headers });
  }
  if (request.headers.has("range") && object.range && "offset" in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}
