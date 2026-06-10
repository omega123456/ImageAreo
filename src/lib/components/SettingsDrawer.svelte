<script lang="ts">
  import { X, ArrowUpCircle } from "@lucide/svelte";
  import { getVersion } from "@tauri-apps/api/app";

  import { settings, type ThemeSetting } from "../stores/settings.svelte";
  import { folder } from "../stores/folder.svelte";
  import { ui } from "../stores/ui.svelte";
  import type { SortOrder } from "../ipc/commands";

  interface Props {
    /**
     * App version shown in the About section. Defaults to the empty string and
     * is resolved from Tauri on mount; injectable so tests stay headless.
     */
    version?: string;
    /** Whether an update is available — Phase 17 supplies this; slot only here. */
    updateAvailable?: boolean;
    /** Target version for the available update (Phase 17). */
    updateVersion?: string;
  }

  let { version = "", updateAvailable = false, updateVersion = "" }: Props =
    $props();

  let fetchedVersion = $state("");
  const resolvedVersion = $derived(version || fetchedVersion);

  $effect(() => {
    if (version) return;
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) fetchedVersion = v;
      })
      .catch(() => {
        /* headless / non-Tauri: leave version empty */
      });
    return () => {
      cancelled = true;
    };
  });

  const themeOptions: { value: ThemeSetting; label: string }[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "system", label: "System" },
  ];

  const sizeOptions = [48, 64, 80, 96, 120];

  let panel = $state<HTMLElement | null>(null);

  function close(): void {
    ui.closeSettings();
  }

  function focusables(): HTMLElement[] {
    if (!panel) return [];
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
  }

  $effect(() => {
    if (!ui.settingsOpen) return;
    // Move focus into the drawer when it opens.
    const first = focusables()[0];
    first?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey) {
      if (active === first || !panel?.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function onThemeChange(event: Event): Promise<void> {
    const value = (event.currentTarget as HTMLInputElement).value as ThemeSetting;
    await settings.setTheme(value);
  }

  async function onCountChange(event: Event): Promise<void> {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    await settings.setThumbnailCount(value);
  }

  async function onSizeChange(event: Event): Promise<void> {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    await settings.setThumbnailSize(value);
  }

  async function onSortChange(event: Event): Promise<void> {
    const value = (event.currentTarget as HTMLSelectElement).value as SortOrder;
    await settings.setSortOrder(value);
    await folder.reloadForSortOrder(value);
  }
</script>

{#if ui.settingsOpen}
  <div class="fixed inset-0 z-40 flex justify-end" role="presentation">
    <button
      type="button"
      class="absolute inset-0 bg-black/40"
      aria-label="Close settings"
      tabindex="-1"
      onclick={close}
    ></button>

    <div
      bind:this={panel}
      class="relative z-50 flex h-full w-80 flex-col gap-4 overflow-y-auto bg-surface-50-950 p-4 shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabindex="-1"
      onkeydown={onKeydown}
    >
      <header class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Settings</h2>
        <button
          type="button"
          class="btn-icon btn-icon-sm preset-tonal"
          aria-label="Close settings panel"
          title="Close"
          onclick={close}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <hr class="hr border-surface-300-700" />

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold tracking-wide text-surface-600-400 uppercase">
          Appearance
        </h3>
        <fieldset class="flex flex-col gap-1">
          <legend class="text-sm">Theme</legend>
          {#each themeOptions as option (option.value)}
            <label class="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="theme"
                class="radio"
                value={option.value}
                checked={settings.theme === option.value}
                onchange={onThemeChange}
              />
              {option.label}
            </label>
          {/each}
        </fieldset>
      </section>

      <hr class="hr border-surface-300-700" />

      <section class="flex flex-col gap-3">
        <h3 class="text-xs font-semibold tracking-wide text-surface-600-400 uppercase">
          Gallery Strip
        </h3>

        <label class="flex items-center justify-between gap-2 text-sm">
          <span>Thumbnails</span>
          <input
            type="number"
            class="input w-20"
            min="1"
            max="50"
            step="1"
            value={settings.thumbnailCount}
            onchange={onCountChange}
            aria-label="Thumbnail count"
          />
        </label>

        <label class="flex items-center justify-between gap-2 text-sm">
          <span>Size</span>
          <select
            class="select w-28"
            value={settings.thumbnailSize}
            onchange={onSizeChange}
            aria-label="Thumbnail size"
          >
            {#each sizeOptions as size (size)}
              <option value={size}>{size}px</option>
            {/each}
          </select>
        </label>

        <label class="flex items-center justify-between gap-2 text-sm">
          <span>Sort</span>
          <select
            class="select w-28"
            value={settings.sortOrder}
            onchange={onSortChange}
            aria-label="Sort order"
          >
            <option value="name">Name</option>
            <option value="date">Date modified</option>
          </select>
        </label>
      </section>

      <hr class="hr border-surface-300-700" />

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold tracking-wide text-surface-600-400 uppercase">
          About
        </h3>
        <p class="text-sm">
          ImageAreo{#if resolvedVersion}&nbsp;v{resolvedVersion}{/if}
        </p>
        {#if updateAvailable}
          <!-- Phase 17 fills the update-available behaviour; this is the slot. -->
          <div class="flex items-center gap-2 text-sm text-primary-600-400">
            <ArrowUpCircle size={16} aria-hidden="true" />
            <span>Update available{#if updateVersion}&nbsp;v{updateVersion}{/if}</span>
          </div>
        {/if}
      </section>
    </div>
  </div>
{/if}
