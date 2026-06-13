/**
 * Centralized semantic icon module.
 *
 * Single source of truth mapping semantic action/indicator names to Phosphor
 * icon components. This is the ONLY place the icon library is referenced, so
 * swapping or restyling iconography is a one-file edit.
 *
 * Phosphor encodes weight as a prop (`weight="regular" | "fill" | ...`) rather
 * than shipping a separate component per weight. Per the Phosphor design system
 * we standardize on Regular as the default and Fill to signal active/toggled
 * ("on"/"selected") state. Components consume:
 *   - `icons.<name>` — the icon component (rendered at Regular by default).
 *   - `ICON_WEIGHT.regular` / `ICON_WEIGHT.fill` — the weight value to pass.
 *   - `ACTIVE_CAPABLE_ICONS` — the set of semantic names that have an active
 *     state and should be rendered with the Fill weight when active.
 *
 * Default render size for chrome icons is 16px (Phosphor Regular @16px).
 */
import {
  ArrowCircleUpIcon,
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowsOutIcon,
  CornersInIcon,
  CornersOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  ClipboardIcon,
  CopyIcon,
  FilePlusIcon,
  FilmStripIcon,
  FolderOpenIcon,
  FrameCornersIcon,
  GearIcon,
  ImageBrokenIcon,
  ImageIcon,
  MagnifyingGlassIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PaletteIcon,
  ProhibitIcon,
  WarningCircleIcon,
  XIcon,
} from "phosphor-svelte";
import type { Component } from "svelte";

/** Phosphor weight values used by ImageAreo. */
export const ICON_WEIGHT = {
  regular: "regular",
  fill: "fill",
} as const;

export type IconWeight = (typeof ICON_WEIGHT)[keyof typeof ICON_WEIGHT];

/** Default chrome icon size, in pixels (Phosphor Regular @16px). */
export const ICON_SIZE = 16;

/**
 * Semantic-name → Phosphor icon component map.
 *
 * Every action and indicator referenced by the chrome resolves through this
 * map. Components import `icons` and reference entries by their semantic role
 * (e.g. `icons.openFile`) rather than the underlying glyph name.
 */
export const icons = {
  // --- File actions ---
  openFile: FilePlusIcon,
  openFolder: FolderOpenIcon,

  // --- View actions ---
  fit: ArrowsOutIcon,
  actualSize: FrameCornersIcon,
  zoomIn: MagnifyingGlassPlusIcon,
  zoomOut: MagnifyingGlassMinusIcon,
  fullscreenEnter: CornersOutIcon,
  fullscreenExit: CornersInIcon,

  // --- Rotate actions ---
  rotateLeft: ArrowCounterClockwiseIcon,
  rotateRight: ArrowClockwiseIcon,

  // --- Context-menu actions ---
  copyImage: CopyIcon,
  copyPath: ClipboardIcon,
  reveal: MagnifyingGlassIcon,

  // --- Chrome toggles / panels ---
  filmstrip: FilmStripIcon,
  settings: GearIcon,
  appearance: PaletteIcon,
  close: XIcon,

  // --- Filmstrip navigation ---
  previous: CaretLeftIcon,
  next: CaretRightIcon,

  // --- Indicators / states ---
  updateAvailable: ArrowCircleUpIcon,
  imageFailed: ImageBrokenIcon,
  imageError: WarningCircleIcon,
  imageTooLarge: ProhibitIcon,
  emptyPlaceholder: ImageIcon,
} as const satisfies Record<string, Component>;

/** A semantic icon name resolvable through {@link icons}. */
export type IconName = keyof typeof icons;

/**
 * Semantic names that have an active/toggled state and should be rendered with
 * the Fill weight when active (Regular otherwise). The filmstrip toggle fills
 * when the filmstrip is visible; the update indicator fills to draw attention.
 */
export const ACTIVE_CAPABLE_ICONS = new Set<IconName>([
  "filmstrip",
  "updateAvailable",
]);

/**
 * Resolve the weight to render a semantic icon at, given whether it is active.
 * Non-active-capable icons always render Regular.
 */
export function iconWeightFor(name: IconName, active: boolean): IconWeight {
  return active && ACTIVE_CAPABLE_ICONS.has(name)
    ? ICON_WEIGHT.fill
    : ICON_WEIGHT.regular;
}
