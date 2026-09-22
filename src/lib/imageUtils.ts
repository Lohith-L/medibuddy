/**
 * Image utilities for validation, preview management, and persistence formatting.
 */

export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates image type and size.
 */
export function validateImageFile(file: File): ImageValidationResult {
  if (!file) {
    return { valid: false, error: "No file selected." };
  }

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const isTypeValid =
    ALLOWED_IMAGE_TYPES.includes(file.type) ||
    ALLOWED_IMAGE_EXTENSIONS.includes(ext);

  if (!isTypeValid) {
    return {
      valid: false,
      error: "Please select a valid image file (JPG, PNG, or WEBP).",
    };
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return {
      valid: false,
      error: "Image must be under 5MB. Please choose a smaller photo.",
    };
  }

  return { valid: true };
}

/**
 * Safely creates an object URL for preview with memory-leak protection.
 */
export function createSafePreviewUrl(file: File): string {
  if (typeof window !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      return URL.createObjectURL(file);
    } catch (e) {
      console.warn("createObjectURL failed, falling back:", e);
    }
  }
  return "";
}

/**
 * Safely revokes an object URL if it is a blob URL.
 */
export function revokeSafePreviewUrl(url?: string | null): void {
  if (!url || typeof url !== "string") return;
  if (url.startsWith("blob:") && typeof window !== "undefined" && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn("revokeObjectURL failed:", e);
    }
  }
}

/**
 * Converts a File into an optimized base64 Data URL.
 * Scales down large images (>1200px) to prevent bloating while preserving readability of medicine packaging.
 */
export async function fileToOptimizedDataUrl(
  file: File,
  maxDimension = 1200,
  quality = 0.85
): Promise<string> {
  // If in non-browser environment or canvas unsupported, use standard FileReader
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof HTMLCanvasElement === "undefined"
  ) {
    return readAsDataUrl(file);
  }

  // Fast-path: small files (<= 250KB) don't need downscaling
  if (file.size <= 250 * 1024) {
    return readAsDataUrl(file);
  }

  return new Promise((resolve) => {
    const objectUrl = createSafePreviewUrl(file);
    const img = new Image();
    let settled = false;

    const cleanup = () => {
      if (objectUrl) revokeSafePreviewUrl(objectUrl);
    };

    // Safety timeout: if image decoding stalls or in headless testing, fall back
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        readAsDataUrl(file).then(resolve).catch(() => resolve(""));
      }
    }, 1500);

    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      try {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (!width || !height) {
          cleanup();
          readAsDataUrl(file).then(resolve).catch(() => resolve(""));
          return;
        }

        // Only scale down if larger than maxDimension
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          cleanup();
          readAsDataUrl(file).then(resolve).catch(() => resolve(""));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mimeType, quality);
        cleanup();
        resolve(dataUrl);
      } catch (err) {
        console.warn("Canvas compression failed, falling back to raw data URL:", err);
        cleanup();
        readAsDataUrl(file).then(resolve).catch(() => resolve(""));
      }
    };

    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      readAsDataUrl(file).then(resolve).catch(() => resolve(""));
    };

    if (objectUrl) {
      img.src = objectUrl;
    } else {
      settled = true;
      clearTimeout(timeout);
      readAsDataUrl(file).then(resolve).catch(() => resolve(""));
    }
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (e) => reject(e);
    reader.readAsDataURL(file);
  });
}
