/**
 * Resolve an image source to a self-contained `data:` URL so the print render
 * tree needs no external resource load.
 *
 * The printed output is a hidden `@media print` DOM whose `<img>` normally
 * points at a Tauri `asset://` (custom-scheme) URL. macOS WKWebView's print
 * formatter re-lays-out the page and does NOT reliably re-fetch custom-scheme
 * resources, so the printed image comes out blank even though it renders fine
 * on screen. Inlining the bytes as a `data:` URL removes the external load and
 * fixes the blank image on macOS; it is harmless (and equally correct) on the
 * Windows WebView2 browser print path.
 *
 * Uses `fetch` → `Blob` → `FileReader` (not a canvas) so the result is never
 * tainted by cross-origin canvas rules. `fetch` is a plain browser API (not the
 * `invoke` IPC seam), so it is fine to call from a util.
 */
export async function toPrintableDataUrl(source: string): Promise<string> {
  const response = await fetch(source);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("failed to read image bytes"));
    reader.readAsDataURL(blob);
  });
}
