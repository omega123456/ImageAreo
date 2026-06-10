<script lang="ts">
  import { Image as ImageIcon } from "@lucide/svelte";

  interface Props {
    onOpen?: () => void;
  }

  let { onOpen }: Props = $props();
</script>

<div class="flex h-full w-full flex-col items-center justify-center gap-4 text-center">
  <ImageIcon size={64} class="text-surface-600" aria-hidden="true" />
  <p class="text-base text-surface-700-300">Open an image to get started</p>
  {#if onOpen}
    <button type="button" class="btn preset-filled-primary-500" onclick={onOpen}>
      Open File
    </button>
  {/if}
  <p class="text-sm text-surface-600">or drag &amp; drop an image anywhere</p>
</div>
