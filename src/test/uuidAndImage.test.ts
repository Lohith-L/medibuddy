import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateUUID } from "../lib/uuid";
import { validateImageFile, fileToOptimizedDataUrl } from "../lib/imageUtils";

describe("Safe UUID Generation in HTTP / Insecure Contexts", () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    // Restore crypto
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      writable: true,
      configurable: true,
    });
  });

  it("should generate a valid v4 UUID when crypto.randomUUID is available", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("should generate a valid v4 UUID when crypto.randomUUID is undefined (HTTP non-secure context)", () => {
    // Simulate HTTP environment where window.crypto.randomUUID is undefined
    const mockCrypto = {
      getRandomValues: originalCrypto?.getRandomValues?.bind(originalCrypto),
      randomUUID: undefined,
    };

    Object.defineProperty(globalThis, "crypto", {
      value: mockCrypto,
      writable: true,
      configurable: true,
    });

    const uuid = generateUUID();
    expect(uuid).toBeDefined();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("should generate a valid v4 UUID when crypto is completely unavailable (Math.random fallback)", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const uuid = generateUUID();
    expect(uuid).toBeDefined();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("should generate unique values on consecutive calls", () => {
    const u1 = generateUUID();
    const u2 = generateUUID();
    const u3 = generateUUID();
    expect(u1).not.toBe(u2);
    expect(u2).not.toBe(u3);
    expect(u1).not.toBe(u3);
  });
});

describe("Image Validation & Processing", () => {
  it("should accept valid JPG, PNG, and WEBP files", () => {
    const jpgFile = new File(["dummy jpg content"], "rantac.jpg", { type: "image/jpeg" });
    const pngFile = new File(["dummy png content"], "strip.png", { type: "image/png" });
    const webpFile = new File(["dummy webp content"], "medicine.webp", { type: "image/webp" });

    expect(validateImageFile(jpgFile).valid).toBe(true);
    expect(validateImageFile(pngFile).valid).toBe(true);
    expect(validateImageFile(webpFile).valid).toBe(true);
  });

  it("should reject unsupported file formats", () => {
    const txtFile = new File(["text"], "notes.txt", { type: "text/plain" });
    const pdfFile = new File(["pdf"], "prescription.pdf", { type: "application/pdf" });
    const exeFile = new File(["exe"], "malware.exe", { type: "application/x-msdownload" });

    expect(validateImageFile(txtFile).valid).toBe(false);
    expect(validateImageFile(pdfFile).valid).toBe(false);
    expect(validateImageFile(exeFile).valid).toBe(false);
    expect(validateImageFile(txtFile).error).toContain("JPG, PNG, or WEBP");
  });

  it("should reject files exceeding 5MB limit", () => {
    const largeContent = new Uint8Array(6 * 1024 * 1024); // 6MB
    const largeFile = new File([largeContent], "huge.jpg", { type: "image/jpeg" });

    const result = validateImageFile(largeFile);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("5MB");
  });

  it("should convert a small image file to a base64 Data URL", async () => {
    const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // minimal fake jpeg header
    const file = new File([content], "rantac.jpg", { type: "image/jpeg" });

    const dataUrl = await fileToOptimizedDataUrl(file);
    expect(dataUrl).toBeDefined();
    expect(dataUrl.startsWith("data:image/")).toBe(true);
  });
});
