import { Capacitor, registerPlugin } from "@capacitor/core";

export interface ReportPluginInterface {
  printReport(options: { html: string; title: string }): Promise<void>;
  downloadReport(options: { html: string; fileName: string }): Promise<{ success: boolean; fileName: string }>;
  shareReport(options: { html: string; fileName: string; title: string }): Promise<void>;
}

export const NativeReportPlugin = registerPlugin<ReportPluginInterface>("ReportPlugin");

/**
 * Triggers printing / Save as PDF for the health report.
 * - On Native (Android): Uses Android PrintManager so the system print preview opens,
 *   allowing one-tap "Save as PDF" to device storage.
 * - On Web / Mobile browser: Uses a hidden iframe to trigger window.print() reliably
 *   without being blocked by popup blockers or opening empty blank tabs.
 */
export async function printHealthReport(html: string, title: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await NativeReportPlugin.printReport({ html, title });
    return;
  }

  // Web / Mobile browser: Use a hidden iframe for clean, unblocked printing
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      // Fallback if iframe contentWindow is blocked
      const printWindow = window.open("", "_blank");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
          resolve();
        }, 500);
      } else {
        resolve();
      }
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error("Print failed:", err);
      } finally {
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
          resolve();
        }, 2000);
      }
    }, 400);
  });
}

/**
 * Downloads the report file directly to the device's storage.
 * - On Native (Android): Saves directly to the public Downloads folder via MediaStore/Storage.
 * - On Web / Mobile browser: Triggers browser blob file download.
 */
export async function downloadHealthReportFile(html: string, fileName: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await NativeReportPlugin.downloadReport({ html, fileName });
    return;
  }

  // Web / Mobile browser: standard Blob download
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Shares the report file / content.
 * - On Native (Android): Saves to cache and launches Android's native share intent via FileProvider.
 * - On Web / Mobile browser: Uses the Web Share API if supported, or falls back to direct download.
 */
export async function shareHealthReport(html: string, fileName: string, title: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    await NativeReportPlugin.shareReport({ html, fileName, title });
    return true;
  }

  // Check if Web Share API with files is supported
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      const file = new File([blob], fileName, { type: "text/html" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title,
          files: [file],
        });
        return true;
      }
      // If file sharing is not supported, share title and URL
      await navigator.share({
        title,
        text: title,
        url: window.location.href,
      });
      return true;
    } catch (err) {
      // User cancelled share or aborted
      if ((err as Error)?.name === "AbortError") {
        return false;
      }
    }
  }

  // Fallback: download directly
  await downloadHealthReportFile(html, fileName);
  return true;
}
