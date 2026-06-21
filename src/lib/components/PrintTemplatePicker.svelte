<script lang="ts">
  import { print } from "../stores/print.svelte";
  import { icons, ICON_WEIGHT } from "../icons";
  import { TEMPLATES, TEMPLATE_ORDER, type TemplateId } from "../utils/print-presets";

  // Card diagram glyph size — larger than the 16px chrome default so the layout
  // diagram is recognizable at a glance (recognition-over-recall card pattern).
  const CARD_ICON_SIZE = 32;

  let cardEls = $state<(HTMLButtonElement | null)[]>([]);

  const selectedIndex = $derived(TEMPLATE_ORDER.indexOf(print.template));

  function select(id: TemplateId): void {
    print.setTemplate(id);
  }

  function focusCard(index: number): void {
    const count = TEMPLATE_ORDER.length;
    const wrapped = ((index % count) + count) % count;
    const id = TEMPLATE_ORDER[wrapped];
    select(id);
    cardEls[wrapped]?.focus();
  }

  function onKeydown(event: KeyboardEvent, index: number): void {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusCard(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusCard(index - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        select(TEMPLATE_ORDER[index]);
        break;
    }
  }
</script>

<div role="radiogroup" aria-label="Layout template" class="grid grid-cols-3 gap-2">
  {#each TEMPLATE_ORDER as id, index (id)}
    {@const template = TEMPLATES[id]}
    {@const selected = print.template === id}
    {@const Icon = icons[template.icon]}
    <button
      bind:this={cardEls[index]}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={template.label}
      tabindex={index === selectedIndex ? 0 : -1}
      class="flex min-h-16 w-full flex-col items-center justify-center gap-1.5 rounded-xl p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      class:preset-filled={selected}
      class:preset-tonal={!selected}
      class:ring-2={selected}
      class:ring-primary-500={selected}
      onclick={() => select(id)}
      onkeydown={(event) => onKeydown(event, index)}
    >
      <Icon size={CARD_ICON_SIZE} weight={ICON_WEIGHT.regular} aria-hidden="true" />
      <span class="text-xs">{template.label}</span>
    </button>
  {/each}
</div>
