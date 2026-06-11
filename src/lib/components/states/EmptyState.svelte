<script lang="ts">
  import { icons, ICON_WEIGHT } from "../../icons";

  interface Props {
    onOpen?: () => void;
    /** Whether an image is currently being dragged over the window. */
    dragActive?: boolean;
  }

  let { onOpen, dragActive = false }: Props = $props();

  const EmptyIcon = icons.emptyPlaceholder;
</script>

<div class="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
  <EmptyIcon size={48} weight={ICON_WEIGHT.regular} class="text-surface-500" aria-hidden="true" />
  <p class="text-base font-medium text-surface-900-100">No image open</p>
  <p class="text-sm text-surface-500">Open an image to get started</p>
  {#if onOpen}
    <button type="button" class="btn preset-tonal" onclick={onOpen}>
      Open File
    </button>
  {/if}
  {#if dragActive}
    <div
      class="mt-2 rounded-lg border-2 border-dashed border-primary-500 px-6 py-4 text-sm text-surface-500"
    >
      Drop an image here
    </div>
  {:else}
    <p class="mt-2 text-sm text-surface-500">or drop an image here</p>
  {/if}
</div>
