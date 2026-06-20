<script lang="ts">
  import { viewer } from "../stores/viewer.svelte";

  /**
   * Print-only image layer.
   *
   * Hidden on screen (`hidden`) and revealed only for print (`print:flex`,
   * compiled by Tailwind to `@media print` — no hand-written CSS). It holds the
   * already-loaded high-resolution `viewer.source` at fit-to-page size with no
   * zoom/pan/rotation transform, so the native print dialog (triggered by the
   * Rust `print_current_view` command, which renders under print media) prints
   * only the image in its natural, EXIF-correct orientation.
   *
   * The print box is a normal-flow, page-height (`print:h-full`) flex box —
   * NOT `position: fixed`. WebKit's print engine does not paint fixed-positioned
   * elements, and since the on-screen chrome is `print:hidden` (display:none),
   * fixed positioning here would leave the printed document with no in-flow
   * content and produce a blank page. A page-height in-flow box gives WebKit
   * real content to paginate and centers the image on the sheet.
   *
   * Height is `h-full` (100% of the page-sized `body`, see the print `@media`
   * block in app.css) rather than `h-screen` (100vh): WebKit computes `100vh`
   * as slightly taller than the printable page, which both spills a blank page
   * and pushes the centered image low. `h-full` resolves to the exact page box.
   *
   * The on-screen chrome and the live (transformed) viewer carry `print:hidden`
   * so this is the sole printed layer.
   */
</script>

{#if viewer.source}
  <div
    class="hidden print:flex print:h-full print:w-full print:items-center print:justify-center print:bg-white"
    data-testid="print-layout"
  >
    <img
      src={viewer.source}
      alt={viewer.name ?? "Image"}
      class="print:max-h-full print:max-w-full print:object-contain"
      draggable="false"
    />
  </div>
{/if}
