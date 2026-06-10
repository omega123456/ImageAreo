<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import Toolbar from "./lib/components/Toolbar.svelte";
  import ImageViewer from "./lib/components/ImageViewer.svelte";
  import ZoomHud from "./lib/components/ZoomHud.svelte";
  import { folder } from "./lib/stores/folder.svelte";
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
    await openPath(selected);
  }

  async function openPath(path: string): Promise<void> {
    await folder.open(path);
    await viewer.openPath(path);
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
