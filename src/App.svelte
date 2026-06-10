<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import type { UnlistenFn } from "@tauri-apps/api/event";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import ImageViewer from "./lib/components/ImageViewer.svelte";
  import ZoomHud from "./lib/components/ZoomHud.svelte";
  import SettingsDrawer from "./lib/components/SettingsDrawer.svelte";
  import GalleryStrip from "./lib/components/GalleryStrip.svelte";
  import { galleryUi } from "./lib/stores/gallery-ui.svelte";
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
  import type { ZoomPanController } from "./lib/utils/zoom-pan-controller";

  let controller = $state<ZoomPanController | null>(null);

  /** Esc closes the settings drawer first; otherwise exits fullscreen. */
  function handleEscape(): void {
    if (ui.settingsOpen) {
      ui.closeSettings();
      return;
    }
    ui.exitFullscreen();
  }

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
      toggleFullscreen: () => ui.toggleFullscreen(),
      escape: handleEscape,
    },
    () => viewer.status === "ready",
    (binding) => ui.settingsOpen && binding !== "escape",
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

  // Phase 12: register file-association launch, drag-drop, and native-menu
  // listeners, then complete the ready-handshake. The fullscreen handler is a
  // placeholder until P16 owns it; gallery/settings dispatch to existing stores.
  onMount(() => {
    let unlisten: UnlistenFn | undefined;
    void registerEntryPoints({
      openDialog: handleOpen,
      openFolderDialog: handleOpenFolder,
      fit: () => controller?.fitToScreen(),
      actualSize: () => controller?.setActualSize(),
      toggleGallery: () => galleryUi.toggle(),
      toggleFullscreen: () => ui.toggleFullscreen(),
      openSettings: () => ui.openSettings(),
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
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

<svelte:window onkeydown={onKeydown} />

<div class="flex h-screen w-screen flex-col overflow-hidden">
  <Toolbar
    onOpen={handleOpen}
    onOpenFolder={handleOpenFolder}
    onFit={() => controller?.fitToScreen()}
    onActualSize={() => controller?.setActualSize()}
    onZoomIn={() => controller?.zoomIn()}
    onZoomOut={() => controller?.zoomOut()}
    onRotateLeft={() => viewer.rotateLeft()}
    onRotateRight={() => viewer.rotateRight()}
    onSettings={() => ui.openSettings()}
    onToggleGallery={() => galleryUi.toggle()}
    galleryVisible={galleryUi.visible}
  />

  <main class="relative flex flex-grow overflow-hidden">
    <ImageViewer bind:controller onOpen={handleOpen} />
    <ZoomHud onToggle={toggleFitActual} />
  </main>

  {#if galleryUi.visible}
    <GalleryStrip onSelect={handleGallerySelect} />
  {/if}
</div>

<SettingsDrawer />
