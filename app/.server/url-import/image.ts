import type { Database } from "../db";
import { storeMedia } from "../media/store";
import { MEDIA_LIMITS } from "../media/validate";
import { safeFetch } from "./fetcher";
import type { Resolver } from "./ssrf";

/**
 * Copies an event image (og:image etc.) into R2 so the site never hot-links
 * third-party images. Returns the media id, or null when it cannot be used.
 */
export async function importImage(
  db: Database,
  imageUrl: string,
  ownerId: string,
  deps: { resolver?: Resolver; fetchImpl?: typeof fetch } = {},
) {
  try {
    const res = await safeFetch(imageUrl, {
      ...deps,
      maxBytes: MEDIA_LIMITS.image,
      timeoutMs: 6000,
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif",
      allowedTypes: /^image\/(png|jpe?g|webp|gif)/i,
    });
    const stored = await storeMedia(db, res.bytes, {
      ownerId,
      allowed: ["image"],
    });
    return stored.ok ? stored.media.id : null;
  } catch {
    return null;
  }
}
