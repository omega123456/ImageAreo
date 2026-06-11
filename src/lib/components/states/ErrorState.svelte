<script lang="ts">
  import { icons, ICON_WEIGHT } from "../../icons";

  interface Props {
    /** Re-attempt opening the current image path. */
    onRetry?: () => void;
    /** Open the file dialog to pick a different image. */
    onOpenAnother?: () => void;
  }

  let { onRetry, onOpenAnother }: Props = $props();

  const ErrorIcon = icons.imageError;
</script>

<div class="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
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
</div>
