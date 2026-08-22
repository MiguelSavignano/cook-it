/**
 * Client-side photo downscaling for the pantry flow.
 *
 * A modern phone camera produces 3-12 MP JPEGs, and none of that resolution
 * helps identify a tomato. Shrinking here rather than server-side keeps the
 * upload small over wifi and cuts what the vision model has to chew on --
 * which is the slowest step of the whole flow on the local backend, and the
 * only metered one on the Claude backend (image tokens scale with pixels).
 *
 * 1024px on the long edge is the sweet spot: enough detail to read a label
 * on a jar, small enough to stay ~1k tokens.
 */
const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.85;

export async function downscaleImage(file: File | Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));

  // Already small enough -- don't re-encode (that would only lose quality).
  if (scale === 1 && file.type === 'image/jpeg') {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file; // no 2d context: send the original rather than failing.
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ?? (file as Blob)),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
