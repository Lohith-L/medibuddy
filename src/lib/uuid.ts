/**
 * Safe UUID v4 generator with multiple fallbacks.
 * In non-secure HTTP contexts (e.g. http://172.22.44.82:8080), standard browsers
 * do not expose window.crypto.randomUUID. This utility provides seamless fallbacks
 * using crypto.getRandomValues and Math.random with high-resolution timestamps.
 */
export function generateUUID(): string {
  // 1. Native crypto.randomUUID (available in Secure Contexts: HTTPS or localhost)
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through if invocation fails
    }
  }

  // 2. crypto.getRandomValues fallback (often available even in HTTP contexts)
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);

      // Set version 4 (0100xxxx) and variant RFC4122 (10xxxxxx)
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;

      return [...bytes]
        .map((b, i) => {
          const hex = b.toString(16).padStart(2, "0");
          return [4, 6, 8, 10].includes(i) ? "-" + hex : hex;
        })
        .join("");
    } catch {
      // Fall through to Math.random
    }
  }

  // 3. Last-resort RFC4122 v4 generator using Math.random + high-res time
  let d = Date.now();
  let d2 =
    (typeof performance !== "undefined" &&
      typeof performance.now === "function" &&
      performance.now() * 1000) ||
    0;

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    let r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else if (d2 > 0) {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    } else {
      r = r | 0;
    }
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
