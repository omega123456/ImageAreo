<script lang="ts">
  interface Props {
    /**
     * Source of the previously-displayed image, shown ghosted behind the
     * spinner. Empty/undefined when there was no prior image (e.g. cold open).
     */
    previousSource?: string;
    /** Accessible name for the ghosted previous image. */
    previousName?: string | null;
    /** Delay before the "Decoding…" hint appears, in ms (slow decodes only). */
    decodingDelayMs?: number;
  }

  let {
    previousSource = "",
    previousName = null,
    decodingDelayMs = 1500,
  }: Props = $props();

  let showDecoding = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Start the slow-decode hint timer when this component mounts (i.e. when a
  // load begins). RAW and other exotic formats can take seconds; the hint
  // reassures the user that work is happening without flashing on fast decodes.
  $effect(() => {
    timer = setTimeout(() => {
      showDecoding = true;
    }, decodingDelayMs);
    return () => clearTimeout(timer);
  });
</script>

{#if previousSource}
  <img
    src={previousSource}
    alt={previousName ?? "Previous image"}
    draggable="false"
    decoding="async"
    class="pointer-events-none max-h-full max-w-full select-none object-contain opacity-50"
  />
{/if}

<div
  class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
  aria-live="polite"
>
  <div
    class="size-12 animate-spin rounded-full border-2 border-surface-400-600 border-t-primary-500"
    role="status"
    aria-label="Loading image"
  ></div>
  {#if showDecoding}
    <p class="text-xs text-surface-500">Decoding…</p>
  {/if}
</div>
