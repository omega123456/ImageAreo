<script lang="ts">
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";

  import { icons, ICON_WEIGHT } from "../../icons";

  interface Props {
    onOpen?: () => void;
  }

  let { onOpen }: Props = $props();

  const EmptyIcon = icons.emptyPlaceholder;

  // HTML5 dragover is disabled by `dragDropEnabled` (tauri.conf.json), so the
  // drop affordance is driven by Tauri's native drag-enter/leave events rather
  // than CSS drag events. Tracked internally so callers don't have to wire it.
  let dragActive = $state(false);

  $effect(() => {
    let active = true;
    const unlisteners: UnlistenFn[] = [];

    void listen("tauri://drag-enter", () => {
      dragActive = true;
    }).then((un) => (active ? unlisteners.push(un) : un()));

    void listen("tauri://drag-leave", () => {
      dragActive = false;
    }).then((un) => (active ? unlisteners.push(un) : un()));

    return () => {
      active = false;
      for (const un of unlisteners) un();
    };
  });
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
      class="mt-2 rounded-xl border-2 border-dashed border-surface-700 px-6 py-4 text-sm text-surface-500"
    >
      Drop an image here
    </div>
  {:else}
    <p class="mt-2 text-sm text-surface-500">or drop an image here</p>
  {/if}
</div>
