<script lang="ts">
  import { getVersion } from "@tauri-apps/api/app";
  import { fly } from "svelte/transition";

  import { icons, ICON_SIZE, ICON_WEIGHT, iconWeightFor } from "../icons";
  import {
    settings,
    type GalleryDensity,
    type ThemeSetting,
  } from "../stores/settings.svelte";
  import { folder } from "../stores/folder.svelte";
  import { ui } from "../stores/ui.svelte";
  import { updater } from "../stores/updater.svelte";
  import type { SortOrder } from "../ipc/commands";

  interface Props {
    /**
     * App version shown in the About section. Defaults to the empty string and
     * is resolved from Tauri on mount; injectable so tests stay headless.
     */
    version?: string;
    /**
     * Whether an update is available. Defaults to the updater store so the
     * prop-less mount in App.svelte reflects live state; tests override it.
     */
    updateAvailable?: boolean;
    /** Target version for the available update. Defaults to the updater store. */
    updateVersion?: string;
  }

  let {
    version = "",
    updateAvailable = undefined,
    updateVersion = undefined,
  }: Props = $props();

  const showUpdate = $derived(updateAvailable ?? updater.showBadge);
  const updateVersionLabel = $derived(
    updateVersion ?? updater.updateVersion ?? "",
  );

  function installUpdate(): void {
    void updater.installUpdate();
  }

  const CloseIcon = icons.close;
  const SettingsIcon = icons.settings;
  const UpdateIcon = icons.updateAvailable;

  // Reduced-motion gates the slide-in; instant under the user preference.
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const slideDuration = reducedMotion ? 0 : 200;

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

  const densityOptions: { value: GalleryDensity; label: string }[] = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];

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

  async function onDensityChange(event: Event): Promise<void> {
    const value = (event.currentTarget as HTMLSelectElement)
      .value as GalleryDensity;
    await settings.setGalleryDensity(value);
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
      class="absolute inset-0 bg-surface-950/40"
      aria-label="Close settings"
      tabindex="-1"
      onclick={close}
    ></button>

    <div
      bind:this={panel}
      class="relative z-50 flex h-full w-80 flex-col gap-5 overflow-y-auto bg-chrome-surface p-5 shadow-xl scrollbar-thin scrollbar-thumb-surface-400-600"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      tabindex="-1"
      onkeydown={onKeydown}
      transition:fly={{ x: 320, duration: slideDuration, opacity: 1 }}
    >
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <SettingsIcon size={ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
          <h2 class="text-base font-semibold">Settings</h2>
        </div>
        <button
          type="button"
          class="btn-icon btn-icon-sm preset-tonal"
          aria-label="Close settings panel"
          title="Close"
          onclick={close}
        >
          <CloseIcon size={ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
        </button>
      </header>

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
          Appearance
        </h3>
        <div class="flex flex-col gap-1" role="radiogroup" aria-labelledby="theme-label">
          <span id="theme-label" class="text-sm">Theme</span>
          {#each themeOptions as option (option.value)}
            <label class="flex h-7 items-center gap-2 text-sm">
              <input
                type="radio"
                name="theme"
                class="radio size-5 shrink-0 transition-colors"
                value={option.value}
                checked={settings.theme === option.value}
                onchange={onThemeChange}
              />
              {option.label}
            </label>
          {/each}
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h3 class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
          Gallery Strip
        </h3>

        <label class="flex items-center justify-between gap-2 text-sm">
          <span>Density</span>
          <select
            class="select w-28"
            value={settings.galleryDensity}
            onchange={onDensityChange}
            aria-label="Density"
          >
            {#each densityOptions as option (option.value)}
              <option value={option.value}>{option.label}</option>
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

      <section class="flex flex-col gap-2">
        <h3 class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
          About
        </h3>
        <p class="text-sm">
          ImageAreo{#if resolvedVersion}&nbsp;v{resolvedVersion}{/if}
        </p>
        {#if showUpdate}
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm text-primary-600-400">
              <UpdateIcon
                size={ICON_SIZE}
                weight={iconWeightFor("updateAvailable", true)}
                aria-hidden="true"
              />
              <span
                >Update available{#if updateVersionLabel}&nbsp;v{updateVersionLabel}{/if}</span
              >
            </div>
            <button
              type="button"
              class="btn btn-sm preset-filled-primary-500"
              onclick={installUpdate}
            >
              Update
            </button>
          </div>
        {/if}
      </section>
    </div>
  </div>
{/if}
