<script lang="ts">
  import { icons, ICON_SIZE, ICON_WEIGHT } from "../icons";
  import { print } from "../stores/print.svelte";
  import { type FitMode, type Orientation } from "../utils/print-presets";

  const OrientationIcon = icons.printNamed;
  const FitIcon = icons.printFit;
  // ArrowsOut is dual-use: the generic "fit-to-screen" view action AND the
  // Fill print-fit mode here. Reusing it keeps the iconography minimal.
  const FillIcon = icons.fit;

  const fitOptions: { value: FitMode; label: string; icon: typeof FitIcon }[] = [
    { value: "fit", label: "Fit", icon: FitIcon },
    { value: "fill", label: "Fill", icon: FillIcon },
  ];

  const orientationOptions: { value: Orientation; label: string; rotate: boolean }[] = [
    { value: "portrait", label: "Portrait", rotate: false },
    { value: "landscape", label: "Landscape", rotate: true },
  ];
</script>

<!--
  Paper size, margins, and copies are intentionally NOT here: those belong to the
  OS-native print dialog that opens when the user clicks Print. This panel is the
  pre-step that only owns the image layout decisions (orientation + fit); the
  template/layout grid lives in PrintTemplatePicker.
-->
<div class="flex flex-col gap-6">
  <section class="flex flex-col gap-2">
    <h3 class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
      Orientation
    </h3>
    <div
      class="btn-group preset-outlined-surface-200-800 flex p-1"
      role="group"
      aria-label="Orientation"
    >
      {#each orientationOptions as option (option.value)}
        {@const active = print.orientation === option.value}
        <button
          type="button"
          class="btn btn-sm flex-1 {active ? 'preset-filled-primary-500' : ''}"
          aria-label={option.label}
          aria-pressed={active}
          title={option.label}
          onclick={() => print.setOrientation(option.value)}
        >
          <!-- Single rectangle glyph; landscape rotates it 90° (only permitted inline style). -->
          <span
            class="inline-flex"
            style={option.rotate ? "transform: rotate(90deg)" : undefined}
          >
            <OrientationIcon size={ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
          </span>
        </button>
      {/each}
    </div>
  </section>

  <section class="flex flex-col gap-2">
    <h3 class="text-xs font-semibold tracking-wider text-surface-500 uppercase">
      Image
    </h3>
    <div
      class="btn-group preset-outlined-surface-200-800 flex p-1"
      role="group"
      aria-label="Image fit"
    >
      {#each fitOptions as option (option.value)}
        {@const active = print.fit === option.value}
        {@const FitOptionIcon = option.icon}
        <button
          type="button"
          class="btn btn-sm flex-1 gap-1.5 {active ? 'preset-filled-primary-500' : ''}"
          aria-label={option.label}
          aria-pressed={active}
          onclick={() => print.setFit(option.value)}
        >
          <FitOptionIcon size={ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
          {option.label}
        </button>
      {/each}
    </div>
  </section>
</div>
