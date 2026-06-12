<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import ImageViewer from "./lib/components/ImageViewer.svelte";
  import ZoomHud from "./lib/components/ZoomHud.svelte";
  import SettingsDrawer from "./lib/components/SettingsDrawer.svelte";
  import UpdateToast from "./lib/components/UpdateToast.svelte";
  import Filmstrip from "./lib/components/Filmstrip.svelte";
  import { updater } from "./lib/stores/updater.svelte";
  import { galleryUi } from "./lib/stores/gallery-ui.svelte";
  import { chrome } from "./lib/stores/chrome.svelte";
  import { ui } from "./lib/stores/ui.svelte";
  import { viewer } from "./lib/stores/viewer.svelte";
  import { supportedExtensions } from "./lib/utils/format";
  import {
    goNext,
    goPrev,
    goToIndex,
    openPath,
    registerEntryPoints,
  } from "./lib/utils/open-entry";
  import { createKeyHandler } from "./lib/utils/keybindings";
  import { windowTitle, writeTitle } from "./lib/utils/native-window";
  import type { ZoomPanController } from "./lib/utils/zoom-pan-controller";

  let controller = $state<ZoomPanController | null>(null);
  let imageViewer = $state<ImageViewer | null>(null);

  const chromeVisibilityClass = $derived(
    chrome.chromeVisible
      ? "visible opacity-100"
      : "pointer-events-none invisible opacity-0",
  );

  const chromeTransitionClass = $derived(
    chrome.instant ? "transition-none" : "transition-opacity duration-200 ease-out",
  );

  /**
   * Toolbar chrome. Outside fullscreen it fades (opacity); in fullscreen it
   * slides up out of view (`-translate-y-full`) with a 300ms transform so the
   * canvas reads as edge-to-edge. Activity (any mouse move / keypress) reveals
   * it again via {@link chrome.chromeVisible}.
   */
  const toolbarChromeClass = $derived(
    !ui.fullscreen
      ? `${chromeVisibilityClass} ${chromeTransitionClass}`
      : chrome.chromeVisible
        ? `translate-y-0 ${chrome.instant ? "transition-none" : "transition-transform duration-300 ease-out"}`
        : `-translate-y-full pointer-events-none ${chrome.instant ? "transition-none" : "transition-transform duration-300 ease-out"}`,
  );

  /**
   * Filmstrip chrome. Outside fullscreen it is always shown (product decision);
   * in fullscreen it slides down out of view (`translate-y-full`) on idle and
   * slides back on activity. Kept mounted (not `{#if}`-removed) so it animates.
   */
  const filmstripChromeClass = $derived(
    !ui.fullscreen
      ? "translate-y-0"
      : chrome.chromeVisible
        ? `translate-y-0 ${chrome.instant ? "transition-none" : "transition-transform duration-300 ease-out"}`
        : `translate-y-full pointer-events-none ${chrome.instant ? "transition-none" : "transition-transform duration-300 ease-out"}`,
  );

  /**
   * Hide the OS cursor while fullscreen chrome is idle; restore it on any
   * activity (activity also reveals chrome, so the two move together).
   */
  $effect(() => {
    if (typeof document === "undefined") return;
    const hide = ui.fullscreen && !chrome.chromeVisible;
    document.body.style.cursor = hide ? "none" : "";
    return () => {
      document.body.style.cursor = "";
    };
  });

  /** Esc closes the settings drawer first; otherwise exits fullscreen. */
  function handleEscape(): void {
    if (ui.settingsOpen) {
      ui.closeSettings();
      return;
    }
    void ui.exitFullscreen();
  }

  function registerActivity(): void {
    chrome.registerActivity();
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    registerActivity();
    // Shift+F10 is the keyboard context-menu request. Handle it at the window
    // level: the canvas container is non-focusable, so a container-bound
    // listener could never receive this. Only acts when an image is loaded.
    if (event.shiftKey && event.key === "F10" && viewer.path) {
      event.preventDefault();
      imageViewer?.openContextMenuAtCenter();
      return;
    }
    onKeydown(event);
  }

  $effect(() => {
    chrome.setFullscreen(ui.fullscreen);
  });

  /** Reflect the current image's name and path in the OS window title bar. */
  $effect(() => {
    void writeTitle(windowTitle(viewer.path, viewer.name));
  });

  const onKeydown = createKeyHandler(
    {
      prev: () => void goPrev(),
      next: () => void goNext(),
      zoomIn: () => controller?.zoomIn(),
      zoomOut: () => controller?.zoomOut(),
      fit: () => controller?.fitToScreen(),
      actualSize: () => controller?.setActualSize(),
      rotateLeft: () => viewer.rotateLeft(),
      rotateRight: () => viewer.rotateRight(),
      toggleFullscreen: () => void ui.toggleFullscreen(),
      escape: handleEscape,
    },
    () => viewer.status === "ready",
    (binding) => ui.settingsOpen && binding !== "escape",
    (binding) =>
      viewer.path !== null &&
      viewer.status === "loading" &&
      (binding === "prev" || binding === "next"),
  );

  async function handleOpen(): Promise<void> {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: supportedExtensions() }],
    });
    if (typeof selected !== "string") return;
    await openPath(selected);
  }

  async function handleOpenFolder(): Promise<void> {
    const selected = await open({ multiple: false, directory: true });
    if (typeof selected !== "string") return;
    await openPath(selected);
  }

  onMount(() => {
    let unlisten: UnlistenFn | undefined;
    chrome.start();
    const cancelUpdateCheck = updater.scheduleLaunchCheck();
    void ui.initializeFullscreen();
    void registerEntryPoints({
      openDialog: handleOpen,
      openFolderDialog: handleOpenFolder,
      fit: () => controller?.fitToScreen(),
      actualSize: () => controller?.setActualSize(),
      toggleGallery: () => galleryUi.toggle(),
      toggleFullscreen: () => void ui.toggleFullscreen(),
      openSettings: () => ui.openSettings(),
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      chrome.stop();
      cancelUpdateCheck();
      unlisten?.();
    };
  });

  function toggleFitActual(): void {
    if (viewer.fitMode === "actual") {
      controller?.fitToScreen();
    } else {
      controller?.setActualSize();
    }
  }

  async function handleGallerySelect(index: number): Promise<void> {
    await goToIndex(index);
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} onpointermove={registerActivity} />

<div class="flex h-screen w-screen min-h-0 flex-col overflow-hidden select-none">
  <main class="relative min-h-0 flex-1 overflow-hidden">
    <ImageViewer
      bind:this={imageViewer}
      bind:controller
      onOpen={handleOpen}
      fullscreen={ui.fullscreen}
    />

    <div
      class={`pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3 ${toolbarChromeClass}`}
      data-testid="toolbar-overlay"
    >
      <div class="pointer-events-auto">
        <Toolbar
          onOpen={handleOpen}
          onOpenFolder={handleOpenFolder}
          onFit={() => controller?.fitToScreen()}
          onActualSize={() => controller?.setActualSize()}
          onZoomIn={() => controller?.zoomIn()}
          onZoomOut={() => controller?.zoomOut()}
          onToggleFullscreen={() => void ui.toggleFullscreen()}
          onRotateLeft={() => viewer.rotateLeft()}
          onRotateRight={() => viewer.rotateRight()}
          onSettings={() => ui.openSettings()}
          onToggleGallery={() => galleryUi.toggle()}
          galleryVisible={galleryUi.visible}
          fullscreen={ui.fullscreen}
        />
      </div>
    </div>

    <div
      class={`pointer-events-none absolute inset-0 z-20 ${chromeVisibilityClass} ${chromeTransitionClass}`}
      data-testid="zoom-hud-overlay"
    >
      <div class="relative h-full w-full pointer-events-none">
        <div class="pointer-events-auto">
          <ZoomHud onToggle={toggleFitActual} />
        </div>
      </div>
    </div>
  </main>

  {#if galleryUi.visible}
    <div class={filmstripChromeClass} data-testid="filmstrip-overlay">
      <Filmstrip onSelect={handleGallerySelect} />
    </div>
  {/if}
</div>

<SettingsDrawer />
<UpdateToast />
