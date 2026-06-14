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
  import EnhanceControl from "./lib/components/EnhanceControl.svelte";
  import ImageInfoCard from "./lib/components/ImageInfoCard.svelte";
  import SharpenIndicator from "./lib/components/SharpenIndicator.svelte";
  import { updater } from "./lib/stores/updater.svelte";
  import { galleryUi } from "./lib/stores/gallery-ui.svelte";
  import { chrome } from "./lib/stores/chrome.svelte";
  import { folder } from "./lib/stores/folder.svelte";
  import { uiScale } from "./lib/stores/ui-scale.svelte";
  import { ui } from "./lib/stores/ui.svelte";
  import { viewer } from "./lib/stores/viewer.svelte";
  import { imageInfo } from "./lib/stores/image-info.svelte";
  import { isRawFormat, supportedExtensions } from "./lib/utils/format";
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
  let enhanceBounds = $state<DOMRect | null>(null);
  let sharpenBounds = $state<DOMRect | null>(null);
  let infoBounds = $state<DOMRect | null>(null);
  let toolbarHost = $state<HTMLDivElement | null>(null);
  let toolbarBounds = $state<DOMRect | null>(null);

  /** Measured filmstrip height; reserved by "fit" so fitted images stay above
   *  the strip while zoomed images render behind its translucent glass. Only
   *  reserved in windowed mode — in fullscreen the strip auto-hides on idle. */
  let stripHeight = $state(0);
  const fitBottomInset = $derived(
    !ui.fullscreen && galleryUi.visible ? stripHeight : 0,
  );

  /**
   * The "Enhance" control is RAW-only, shown once the capped display image is
   * ready (`enhanceAvailable`) and never while the display image is still being
   * prepared (`upgrading`).
   */
  const showEnhanceControl = $derived(
    viewer.path !== null &&
      isRawFormat(viewer.path) &&
      viewer.enhanceAvailable &&
      !viewer.upgrading,
  );

  $effect(() => {
    if (!showEnhanceControl) enhanceBounds = null;
  });

  $effect(() => {
    if (typeof ResizeObserver === "undefined" || !toolbarHost) return;

    const updateBounds = () => {
      toolbarBounds = toolbarHost?.getBoundingClientRect() ?? null;
    };

    updateBounds();
    const observer = new ResizeObserver(() => updateBounds());
    observer.observe(toolbarHost);
    return () => observer.disconnect();
  });

  const hasImage = $derived(viewer.status !== "idle");

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
    !hasImage
      ? "visible opacity-100 transition-none"
      : !ui.fullscreen
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

  /** Esc closes the info card first, then the settings drawer; otherwise exits fullscreen. */
  function handleEscape(): void {
    if (ui.infoOpen) {
      ui.closeInfo();
      return;
    }
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

  // Ensure full metadata is loaded for the current image so the title bar can
  // report the true source dimensions (matching the info card) even while the
  // card is closed. Cached per path; a header+EXIF read is ~0.1ms.
  $effect(() => {
    void imageInfo.ensureLoaded(viewer.path);
  });

  /** Reflect the current image's name and path in the OS window title bar. */
  $effect(() => {
    // Prefer the true source dimensions from metadata (the same numbers the info
    // card shows, correct for RAW and downsized backend derivatives). Fall back
    // to the displayed image's intrinsic size until metadata resolves.
    const meta = imageInfo.current;
    const matches = meta?.filePath === viewer.path;
    const width = matches ? meta!.width : viewer.naturalWidth;
    const height = matches ? meta!.height : viewer.naturalHeight;
    void writeTitle(windowTitle(viewer.path, viewer.name, width, height));
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
      toggleInfo: () => ui.toggleInfo(),
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
    folder.startAutoScan();
    void uiScale.start();
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
      folder.stopAutoScan();
      uiScale.stop();
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

<!--
  Register key and wheel activity in the *capture* phase so it fires for every
  event regardless of where focus is or whether a child (e.g. the filmstrip's
  roving navigation, or the viewer's wheel-zoom) stops propagation in the bubble
  phase. This keeps chrome alive while navigating with the arrow keys or scrolling
  with the mouse wheel.
-->
<svelte:window
  onkeydowncapture={registerActivity}
  onwheelcapture={registerActivity}
  onkeydown={handleWindowKeydown}
  onpointermove={registerActivity}
/>

<div class="flex h-screen w-screen min-h-0 flex-col overflow-hidden select-none">
  <main class="relative min-h-0 flex-1 overflow-hidden">
    <ImageViewer
      bind:this={imageViewer}
      bind:controller
      onOpen={handleOpen}
      fullscreen={ui.fullscreen}
      bottomInset={fitBottomInset}
      enhanceBounds={enhanceBounds}
      toolbarBounds={toolbarBounds}
      sharpenBounds={sharpenBounds}
      infoBounds={infoBounds}
    />

    <div
      class={`pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-3 ${toolbarChromeClass}`}
      data-testid="toolbar-overlay"
    >
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:this={toolbarHost}
        class="pointer-events-auto"
        onpointerenter={() => chrome.holdVisible()}
        onpointerleave={() => chrome.releaseVisible()}
      >
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
          infoOpen={ui.infoOpen}
          onToggleInfo={() => ui.toggleInfo()}
          hasImage={hasImage}
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

    {#if galleryUi.visible}
      <div
        class={`absolute inset-x-0 bottom-0 z-20 ${filmstripChromeClass}`}
        data-testid="filmstrip-overlay"
        bind:clientHeight={stripHeight}
      >
        <Filmstrip onSelect={handleGallerySelect} />
      </div>
    {/if}

    <!--
      Top-left status zone: the interactive "Enhance" control for RAW images.
      Lives above the chrome overlays (z-30) and in the top-left corner so it
      clears the centered toolbar, the filmstrip, and the bottom-right update
      toast. The wrapper is pointer-transparent; the control opts back in.
    -->
    <div
      class="pointer-events-none absolute left-3 top-3 z-30 flex flex-col gap-2"
    >
      {#if showEnhanceControl}
        <div class="pointer-events-auto">
          <EnhanceControl onBoundsChange={(rect) => (enhanceBounds = rect)} />
        </div>
      {/if}

      {#if ui.infoOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class={`pointer-events-auto ${toolbarChromeClass}`}
          onpointerenter={() => chrome.holdVisible()}
          onpointerleave={() => chrome.releaseVisible()}
        >
          <ImageInfoCard onBoundsChange={(rect) => (infoBounds = rect)} />
        </div>
      {/if}
    </div>

    <!--
      Bottom-right status zone: the debounced "Sharpening…" pill, stacked just
      above the ZoomHud readout so the two never overlap. The pill is
      pointer-transparent throughout and manages its own debounced visibility.
    -->
    <div class="pointer-events-none absolute right-3 bottom-12 z-30">
      <SharpenIndicator onBoundsChange={(rect) => (sharpenBounds = rect)} />
    </div>
  </main>
</div>

<SettingsDrawer />
<UpdateToast />
