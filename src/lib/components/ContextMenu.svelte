<script lang="ts">
  import { tick } from "svelte";
  import { writeText } from "@tauri-apps/plugin-clipboard-manager";

  import { viewer } from "../stores/viewer.svelte";
  import {
    copyImageToClipboard,
    printCurrentView,
    revealInFileManager,
  } from "../ipc";
  import { icons, ICON_SIZE, ICON_WEIGHT } from "../icons";
  import type { Component } from "svelte";

  interface MenuItem {
    /** Stable id used for keying and tests. */
    id: string;
    label: string;
    icon: Component;
    /** Optional inline keyboard-shortcut hint. */
    shortcut?: string;
    /** Whether a divider is rendered above this item. */
    dividerBefore?: boolean;
    run: () => void | Promise<void>;
  }

  const items: MenuItem[] = [
    {
      id: "rotate-left",
      label: "Rotate Left",
      icon: icons.rotateLeft,
      shortcut: "Ctrl+[",
      run: () => viewer.rotateLeft(),
    },
    {
      id: "rotate-right",
      label: "Rotate Right",
      icon: icons.rotateRight,
      shortcut: "Ctrl+]",
      run: () => viewer.rotateRight(),
    },
    {
      id: "copy-image",
      label: "Copy Image",
      icon: icons.copyImage,
      dividerBefore: true,
      run: async () => {
        if (viewer.path) await copyImageToClipboard({ path: viewer.path });
      },
    },
    {
      id: "copy-path",
      label: "Copy File Path",
      icon: icons.copyPath,
      run: async () => {
        if (viewer.path) await writeText(viewer.path);
      },
    },
    {
      id: "reveal",
      label: "Reveal in Finder/Explorer",
      icon: icons.reveal,
      run: async () => {
        if (viewer.path) await revealInFileManager({ path: viewer.path });
      },
    },
    {
      id: "print",
      label: "Print…",
      icon: icons.print,
      shortcut: "Ctrl+P",
      dividerBefore: true,
      run: () => printCurrentView(),
    },
  ];

  let open = $state(false);
  let x = $state(0);
  let y = $state(0);
  let activeIndex = $state(0);
  let menuEl = $state<HTMLElement | null>(null);
  let itemEls = $state<(HTMLButtonElement | null)[]>([]);

  /**
   * Open the menu at the given client coordinates. No-op when no image is
   * loaded — the menu's actions all require `viewer.path`. Bound out so the
   * canvas can drive it from a `contextmenu` / `Shift+F10` handler.
   */
  export async function openAt(clientX: number, clientY: number): Promise<void> {
    if (!viewer.path) return;
    x = clientX;
    y = clientY;
    activeIndex = 0;
    open = true;
    await tick();
    itemEls[0]?.focus();
  }

  function close(): void {
    open = false;
  }

  function focusItem(index: number): void {
    const count = items.length;
    activeIndex = ((index % count) + count) % count;
    itemEls[activeIndex]?.focus();
  }

  async function select(item: MenuItem): Promise<void> {
    close();
    // Action bodies hit the OS (clipboard, reveal-in-file-manager) and can
    // reject — e.g. the file was deleted, the clipboard is busy, or the Rust
    // reveal command returns a structured error. Swallow the rejection so it
    // never becomes an unhandled promise rejection; the failure is non-fatal.
    try {
      await item.run();
    } catch (error) {
      console.error(`Context-menu action "${item.id}" failed:`, error);
    }
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(activeIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        void select(items[activeIndex]);
        break;
    }
  }

  // Close on any click that lands outside the menu (capture so it fires before
  // the click's own target handlers).
  function onWindowPointerdown(event: MouseEvent): void {
    if (!open) return;
    const target = event.target as Node | null;
    if (menuEl && target && menuEl.contains(target)) return;
    close();
  }
</script>

<svelte:window onpointerdown={onWindowPointerdown} />

{#if open}
  <!--
    Menu is positioned at the cursor via the single permitted JS-driven inline
    style (left/top). Skeleton tokens drive every color/spacing decision.
  -->
  <div
    bind:this={menuEl}
    class="bg-chrome-surface fixed z-50 min-w-56 rounded-lg border border-surface-400-600 py-1 shadow-xl"
    style="left: {x}px; top: {y}px;"
    role="menu"
    aria-label="Image actions"
    tabindex="-1"
    onkeydown={onMenuKeydown}
  >
    {#each items as item, index (item.id)}
      {#if item.dividerBefore}
        <div
          class="bg-separator my-1 h-px w-full"
          role="separator"
          aria-orientation="horizontal"
        ></div>
      {/if}
      <button
        bind:this={itemEls[index]}
        type="button"
        role="menuitem"
        class="flex h-8 w-full items-center px-3 text-sm focus:outline-none hover:bg-primary-500 hover:text-primary-contrast-500"
        class:bg-primary-500={index === activeIndex}
        class:text-primary-contrast-500={index === activeIndex}
        tabindex={index === activeIndex ? 0 : -1}
        onclick={() => select(item)}
        onpointerenter={() => (activeIndex = index)}
      >
        <item.icon
          size={ICON_SIZE}
          weight={ICON_WEIGHT.regular}
          class="mr-2 shrink-0"
          aria-hidden="true"
        />
        <span class="grow text-left">{item.label}</span>
        {#if item.shortcut}
          <span class="ml-4 text-xs text-surface-400">{item.shortcut}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
