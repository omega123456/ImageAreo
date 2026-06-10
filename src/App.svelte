<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import ImageViewer from "./lib/components/ImageViewer.svelte";
  import ZoomHud from "./lib/components/ZoomHud.svelte";
  import { viewer } from "./lib/stores/viewer.svelte";
  import { NATIVE_EXTENSIONS } from "./lib/utils/format";
  import type { ZoomPanController } from "./lib/utils/zoom-pan-controller";

  let controller = $state<ZoomPanController | null>(null);

  async function handleOpen(): Promise<void> {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: [...NATIVE_EXTENSIONS] }],
    });
    if (typeof selected !== "string") return;
    openPath(selected);
  }

  function openPath(path: string): void {
    const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "Image";
    // TODO(P9): route non-native formats through decode_image instead of convertFileSrc
    viewer.load(convertFileSrc(path), name);
  }

  function toggleFitActual(): void {
    if (viewer.fitMode === "actual") {
      controller?.fitToScreen();
    } else {
      controller?.setActualSize();
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (viewer.status !== "ready") return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    switch (e.key) {
      case "+":
      case "=":
        e.preventDefault();
        controller?.zoomIn();
        break;
      case "-":
      case "_":
        e.preventDefault();
        controller?.zoomOut();
        break;
      case "f":
      case "F":
        controller?.fitToScreen();
        break;
      case "1":
        controller?.setActualSize();
        break;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="flex h-screen w-screen flex-col overflow-hidden">
  <Toolbar
    onOpen={handleOpen}
    onFit={() => controller?.fitToScreen()}
    onActualSize={() => controller?.setActualSize()}
    onZoomIn={() => controller?.zoomIn()}
    onZoomOut={() => controller?.zoomOut()}
  />

  <main class="relative flex flex-grow overflow-hidden">
    <ImageViewer bind:controller onOpen={handleOpen} />
    <ZoomHud onToggle={toggleFitActual} />
  </main>
</div>
