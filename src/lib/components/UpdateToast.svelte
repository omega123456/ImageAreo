<script lang="ts">
  import { fly } from "svelte/transition";

  import { icons, ICON_SIZE, iconWeightFor } from "../icons";
  import { updater } from "../stores/updater.svelte";

  const UpdateIcon = icons.updateAvailable;

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const flyDuration = reducedMotion ? 0 : 200;

  function onUpdateNow(): void {
    void updater.installUpdate();
  }

  function onLater(): void {
    updater.dismissUpdate();
  }
</script>

{#if updater.showToast}
  <div
    class="fixed right-4 bottom-4 z-50 flex max-w-xs flex-col gap-3 rounded-xl border border-surface-300-700 bg-chrome-surface p-4 shadow-xl"
    role="status"
    aria-live="polite"
    data-testid="update-toast"
    transition:fly={{ y: 16, duration: flyDuration }}
  >
    <div class="flex items-center gap-2">
      <UpdateIcon
        size={ICON_SIZE}
        weight={iconWeightFor("updateAvailable", true)}
        class="text-primary-600-400"
        aria-hidden="true"
      />
      <p class="text-sm font-medium">
        ImageAreo{#if updater.updateVersion}&nbsp;{updater.updateVersion}{/if} is
        available
      </p>
    </div>
    <div class="flex items-center justify-end gap-2">
      <button
        type="button"
        class="btn btn-sm preset-tonal-surface"
        onclick={onLater}
      >
        Later
      </button>
      <button
        type="button"
        class="btn btn-sm preset-filled-primary-500"
        disabled={updater.installing}
        onclick={onUpdateNow}
      >
        Update Now
      </button>
    </div>
  </div>
{/if}
