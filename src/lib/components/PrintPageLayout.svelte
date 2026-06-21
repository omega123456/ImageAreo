<script lang="ts">
  import { print } from "../stores/print.svelte";
  import { viewer } from "../stores/viewer.svelte";
  import { paperDimensions, gridDescriptor } from "../utils/print-geometry";

  /**
   * Print-only DOM layer (store-driven, multi-page, tiled).
   *
   * Renders only while `print.open` is set. For each of `print.copies` it emits
   * one IN-FLOW page box at the real mm paper size (NOT `position: fixed` —
   * WebKit's print engine never paints fixed-positioned elements, leaving a
   * blank document). Each page is a CSS grid of `cols × rows` cells (from the
   * geometry descriptor) holding `viewer.source` at the chosen fit/fill mode,
   * with the user's `viewer.rotation` composed as a transform. Pages are
   * separated by `break-after: page` so the native print job paginates fully.
   *
   * The whole layer is `hidden` on screen and revealed only under `@media print`
   * (Tailwind `print:` → no hand-written element CSS). The page-box mm sizes,
   * grid template, cell mm sizes and the rotation transform are JS-driven inline
   * `style` bindings — the single permitted inline-style use (dynamic
   * sizes/transforms, see CLAUDE.md Styling Rule 5).
   *
   * The dynamic `@page { size: <W>mm <H>mm }` is emitted via `<svelte:head>` from
   * the store — a documented print-config exception mirroring the static
   * `@page { margin: 0 }` in app.css (page-box configuration, not element
   * styling).
   */

  // The print-only layer must exist whenever the dialog is open (so the live
  // preview path has DOM) AND throughout an in-flight native print — the OS
  // dialog is async and reads this DOM after the custom modal has closed, so
  // gating on `print.open` alone would tear it down mid-print → blank page.
  const active = $derived(print.open || print.printing);

  const paper = $derived(paperDimensions(print.paperSize, print.orientation));
  const grid = $derived(
    gridDescriptor(
      print.template,
      print.paperSize,
      print.orientation,
      print.margins,
    ),
  );

  // Identical pages: one page box per copy. In-app copies emit identical DOM
  // page boxes; the OS print panel's own Copies field multiplies on top of
  // these (e.g. 2 in-app × 3 OS = 6 sheets). Known, accepted behavior per
  // design — the two controls are independent multipliers.
  const pages = $derived(Array.from({ length: print.copies }, (_, i) => i));
  // Cells within a page: the descriptor's cols × rows.
  const cells = $derived(Array.from({ length: grid.count }, (_, i) => i));

  const objectFitClass = $derived(
    print.fit === "fill" ? "print:object-cover" : "print:object-contain",
  );

  const rotationStyle = $derived(`transform: rotate(${viewer.rotation}deg);`);

  const pageStyle = $derived(
    `width: ${paper.widthMm}mm; height: ${paper.heightMm}mm;`,
  );

  const gridStyle = $derived(
    `grid-template-columns: repeat(${grid.cols}, ${grid.cellWidthMm}mm); ` +
      `grid-template-rows: repeat(${grid.rows}, ${grid.cellHeightMm}mm);`,
  );

  const pageSizeStyleTag = $derived(
    `<style>@page { size: ${paper.widthMm}mm ${paper.heightMm}mm; }</style>`,
  );
</script>

<svelte:head>
  <!-- Dynamic page size — store-driven print-config exception (see component
       doc + app.css `@page { margin: 0 }`). Only present while the print window
       is open so it never affects the normal on-screen document. -->
  {#if active}
    {@html pageSizeStyleTag}
  {/if}
</svelte:head>

{#if active}
  {#if viewer.source}
    <div class="hidden print:block" data-testid="print-page-layout">
      {#each pages as page (page)}
        <div
          class="print:grid print:break-after-page print:justify-center print:content-center print:bg-white"
          style={pageStyle + " " + gridStyle}
          data-testid="print-page"
        >
          {#each cells as cell (cell)}
            <div class="print:overflow-hidden" data-testid="print-cell">
              <!-- The image is placed once, in the top-left cell, sized to a
                   single cell of the template (not duplicated across all cells).
                   Remaining cells stay empty. -->
              {#if cell === 0}
                <img
                  src={print.printImage || viewer.source}
                  alt={viewer.name ?? "Image"}
                  class={`print:h-full print:w-full ${objectFitClass}`}
                  style={rotationStyle}
                  draggable="false"
                />
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
{/if}
