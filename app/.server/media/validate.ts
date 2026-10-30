export type MediaKind = "image" | "video";

export const MEDIA_LIMITS = {
  image: 5 * 1024 * 1024,
  video: 50 * 1024 * 1024,
} as const;

type Detected = { kind: MediaKind; contentType: string; ext: string };

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  sig.every((b, i) => bytes[offset + i] === b);

/**
 * Detect file type from magic bytes. The client-provided MIME type is never
 * trusted; SVG and other active content types are rejected.
 */
export function sniffMediaType(bytes: Uint8Array): Detected | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff]))
    return { kind: "image", contentType: "image/jpeg", ext: "jpg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { kind: "image", contentType: "image/png", ext: "png" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]))
    return { kind: "image", contentType: "image/gif", ext: "gif" };
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return { kind: "image", contentType: "image/webp", ext: "webp" };
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (/^(isom|iso2|mp41|mp42|avc1|M4V |dash)/.test(brand))
      return { kind: "video", contentType: "video/mp4", ext: "mp4" };
    if (/^(qt  )/.test(brand))
      return { kind: "video", contentType: "video/quicktime", ext: "mov" };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]))
    return { kind: "video", contentType: "video/webm", ext: "webm" };
  return null;
}

export type MediaValidation =
  | { ok: true; detected: Detected }
  | { ok: false; error: string };

export function validateMedia(
  bytes: Uint8Array,
  allowed: readonly MediaKind[],
): MediaValidation {
  if (bytes.byteLength === 0) return { ok: false, error: "ファイルが空です" };
  const detected = sniffMediaType(bytes);
  if (!detected || !allowed.includes(detected.kind)) {
    const names = allowed
      .map((k) => (k === "image" ? "画像(JPEG/PNG/WebP/GIF)" : "動画(MP4/WebM/MOV)"))
      .join("・");
    return { ok: false, error: `対応していないファイル形式です。${names}を選んでください` };
  }
  const limit = MEDIA_LIMITS[detected.kind];
  if (bytes.byteLength > limit) {
    return {
      ok: false,
      error: `ファイルサイズが大きすぎます（上限 ${Math.round(limit / 1024 / 1024)}MB）`,
    };
  }
  return { ok: true, detected };
}
