// Client-side avatar preparation: downscale + square-crop a picked file into a small data URI so it
// can live directly in the warehouse `users.image` column (no upload infra; the CSP already allows
// `img-src data:`). Kept deliberately small - webp (jpeg fallback) at 256px is ~10-30KB, far under
// the server's ~100KB JSON body limit even base64-encoded.

/** Hard ceiling for the encoded result - stays clear of the body-parser limit with room for the
 *  rest of the upsert payload. */
const MAX_DATA_URI_CHARS = 90_000

function encode(canvas: HTMLCanvasElement, quality: number): string {
  const webp = canvas.toDataURL('image/webp', quality)
  // A browser without webp encoding silently falls back to PNG - detect and use jpeg instead.
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality)
}

/**
 * Read an image file and return a cover-cropped square data URI (max `size` px). Throws on
 * unreadable/unsupported files (caller shows the error); retries smaller if the encode is
 * somehow still too large for the upsert body.
 */
export async function fileToAvatarDataUri(file: File, size = 256): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    for (const [target, quality] of [
      [Math.min(size, side), 0.85],
      [128, 0.7],
    ] as const) {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = target
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d context unavailable')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, target, target)
      const uri = encode(canvas, quality)
      if (uri.length <= MAX_DATA_URI_CHARS) return uri
    }
    throw new Error('image encodes too large even at 128px')
  } finally {
    bitmap.close()
  }
}
