import {
  queryFileAssociations,
  setDefaultAssociations,
} from "../ipc";
import type { ExtAssociation } from "../ipc/commands";

function extSet(entries: ExtAssociation[]): Set<string> {
  return new Set(entries.filter((entry) => entry.isDefault).map((entry) => entry.ext));
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

class AssociationsStore {
  entries = $state<ExtAssociation[]>([]);
  selected = $state<Set<string>>(new Set());
  isLoading = $state(false);
  isApplying = $state(false);
  error = $state<string | null>(null);

  #loaded = false;

  get hasEntries(): boolean {
    return this.entries.length > 0;
  }

  get canApply(): boolean {
    return (
      !this.isLoading &&
      !this.isApplying &&
      this.selected.size > 0 &&
      this.hasPendingChanges
    );
  }

  get hasPendingChanges(): boolean {
    return !setsEqual(this.selected, extSet(this.entries));
  }

  async load(force = false): Promise<void> {
    if (this.isLoading) {
      return;
    }

    if (this.#loaded && !force) {
      return;
    }

    this.isLoading = true;
    this.error = null;

    try {
      const entries = await queryFileAssociations();
      this.entries = entries;
      this.selected = extSet(entries);
      this.#loaded = true;
    } catch (error) {
      this.entries = [];
      this.selected = new Set();
      this.error =
        error instanceof Error ? error.message : "Failed to load file associations";
    } finally {
      this.isLoading = false;
    }
  }

  toggle(ext: string): void {
    const normalized = ext.trim().replace(/^\./, "").toLowerCase();
    const next = new Set(this.selected);

    if (next.has(normalized)) {
      next.delete(normalized);
    } else {
      next.add(normalized);
    }

    this.selected = next;
  }

  isSelected(ext: string): boolean {
    const normalized = ext.trim().replace(/^\./, "").toLowerCase();
    return this.selected.has(normalized);
  }

  async apply(): Promise<void> {
    if (!this.canApply) {
      return;
    }

    this.isApplying = true;
    this.error = null;

    try {
      await setDefaultAssociations({
        exts: this.entries
          .map((entry) => entry.ext)
          .filter((ext) => this.selected.has(ext)),
      });
      await this.load(true);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to apply file associations";
    } finally {
      this.isApplying = false;
    }
  }

  resetForTests(): void {
    this.entries = [];
    this.selected = new Set();
    this.isLoading = false;
    this.isApplying = false;
    this.error = null;
    this.#loaded = false;
  }
}

export const associations = new AssociationsStore();
