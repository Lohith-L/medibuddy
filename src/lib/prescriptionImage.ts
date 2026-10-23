// Shrinks a prescription photo before it is sent to the AI: phone cameras give
// 3-8 MB images, which made uploads and the model call slow. Longest side
// 2048 px, JPEG ~0.85, camera rotation (EXIF) applied. Target < 1.2 MB:
// 1600 px / 500 KB was faster but lost the detail in handwritten medicine names.
// PDFs are sent unchanged.
//
// Android app: native resize (ImageToolsPlugin). Decoding a 12 MP JPEG in the
// WebView took ~4 s; Android decodes it at reduced size in a fraction of that.
import { Capacitor, registerPlugin } from "@capacitor/core";

const ImageTools = registerPlugin<{
  shrinkImage(o: { base64: string; maxSide: number; quality: number }): Promise<{ base64: string; bytes: number; ms: number }>;
}>("ImageTools");

export interface PreparedUpload {
  base64: string;
  mimeType: string;
  bytes: number;
  originalBytes: number;
  ms: number;
}

const MAX_SIDE = 2048;
const TARGET_BYTES = 1200 * 1024;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * Decodes with the EXIF rotation applied, already scaled so the longest side is
 * at most maxSide. Scaling inside the decoder is fast; drawing a 12 MP bitmap
 * onto a canvas took ~4 s in the Android WebView.
 */
async function decode(file: Blob, maxSide: number): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const probe = await createImageBitmap(file, { imageOrientation: "from-image" }); // fast: size + rotation
      const { width, height } = probe;
      if (Math.max(width, height) <= maxSide) return { source: probe, width, height, close: () => probe.close() };
      probe.close();
      const opts: ImageBitmapOptions = { imageOrientation: "from-image", resizeQuality: "high" };
      if (width >= height) opts.resizeWidth = maxSide;
      else opts.resizeHeight = maxSide;
      const bmp = await createImageBitmap(file, opts);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* older WebView: fall through */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not compress the image"))), "image/jpeg", quality),
  );
}

export async function prepareForUpload(file: File): Promise<PreparedUpload> {
  const t0 = performance.now();
  if (!file.type.startsWith("image/")) {
    return { base64: await blobToBase64(file), mimeType: file.type, bytes: file.size, originalBytes: file.size, ms: Math.round(performance.now() - t0) };
  }
  if (Capacitor.isNativePlatform()) {
    try {
      const raw = await blobToBase64(file);
      let r = await ImageTools.shrinkImage({ base64: raw, maxSide: MAX_SIDE, quality: 85 });
      if (r.bytes > TARGET_BYTES) r = await ImageTools.shrinkImage({ base64: raw, maxSide: 1800, quality: 78 });
      return { base64: r.base64, mimeType: "image/jpeg", bytes: r.bytes, originalBytes: file.size, ms: Math.round(performance.now() - t0) };
    } catch (e) {
      console.warn("[prescription] native resize failed, using the canvas:", e);
    }
  }
  const img = await decode(file, MAX_SIDE);
  try {
    let side = MAX_SIDE;
    let quality = 0.85;
    let blob: Blob | null = null;
    // Usually one pass; very detailed photos get one or two smaller tries.
    for (let attempt = 0; attempt < 3; attempt++) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      // CPU-backed canvas: the GPU one made JPEG encoding take seconds in the Android WebView.
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "#fff"; // transparent PNGs: white, not black
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img.source, 0, 0, w, h);
      blob = await encode(canvas, quality);
      if (blob.size <= TARGET_BYTES) break;
      quality = Math.max(0.7, quality - 0.07);
      side = Math.round(side * 0.9);
    }
    return {
      base64: await blobToBase64(blob!),
      mimeType: "image/jpeg",
      bytes: blob!.size,
      originalBytes: file.size,
      ms: Math.round(performance.now() - t0),
    };
  } finally {
    img.close();
  }
}
