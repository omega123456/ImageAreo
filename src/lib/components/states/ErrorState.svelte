<script lang="ts">
  import { icons, ICON_WEIGHT } from "../../icons";
  import { MAX_DISPLAY_PIXELS } from "../../utils/format";

  interface Props {
    /**
     * `"error"` — generic corrupt/unsupported failure (retry is offered).
     * `"limit"` — the image exceeds the display ceiling (retry would
     * deterministically fail, so only "Open Another" is offered).
     */
    variant?: "error" | "limit";
    /** Re-attempt opening the current image path. */
    onRetry?: () => void;
    /** Open the file dialog to pick a different image. */
    onOpenAnother?: () => void;
  }

  let { variant = "error", onRetry, onOpenAnother }: Props = $props();

  const ErrorIcon = icons.imageError;
  const LimitIcon = icons.imageTooLarge;

  // The MP figure in the limit copy is derived from the shared pixel ceiling,
  // never hardcoded, so the UI stays in lockstep with the backend constant.
  // The ceiling (16384²) is a 1024-based "megapixel" so this resolves to the
  // confirmed "256 MP" wireframe copy rather than a fractional 268.4.
  const limitMegapixels = Math.round(MAX_DISPLAY_PIXELS / (1024 * 1024));
</script>

<div class="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
  {#if variant === "limit"}
    <LimitIcon
      size={48}
      weight={ICON_WEIGHT.regular}
      class="text-warning-400"
      aria-hidden="true"
    />
    <p class="text-base font-medium text-surface-300">
      This image is too large to open
    </p>
    <p class="text-sm text-surface-500">
      The file exceeds the {limitMegapixels} MP display limit. Open a smaller
      image or export a lower-resolution version.
    </p>
    <div class="mt-2 flex items-center gap-2">
      <button
        type="button"
        class="btn preset-filled-primary-500"
        onclick={() => onOpenAnother?.()}
      >
        Open Another
      </button>
    </div>
  {:else}
    <ErrorIcon
      size={48}
      weight={ICON_WEIGHT.regular}
      class="text-error-400"
      aria-hidden="true"
    />
    <p class="text-base font-medium text-surface-300">Could not open this image</p>
    <p class="text-sm text-surface-500">File may be corrupt or unsupported.</p>
    <div class="mt-2 flex items-center gap-2">
      <button type="button" class="btn preset-tonal" onclick={() => onRetry?.()}>
        Try Again
      </button>
      <button
        type="button"
        class="btn preset-filled-primary-500"
        onclick={() => onOpenAnother?.()}
      >
        Open Another
      </button>
    </div>
  {/if}
</div>
