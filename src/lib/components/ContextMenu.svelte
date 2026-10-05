<script lang="ts">
  import { ui, type MenuAction } from '../stores/ui.svelte';
  import Icon from './Icon.svelte';
  import Img from './Img.svelte';
  import { tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { isMobile } from '../native/platform';
  import { artistNames } from '../util/thumbs';

  // ---- phone: bottom action sheet (submenus slide in place)
  let sheetSub = $state<{ title: string; items: MenuAction[] } | null>(null);
  $effect(() => {
    ui.menu;
    sheetSub = null;
  });
  const owner = $derived(ui.menu?.owner as any);
  const head = $derived(owner && typeof owner === 'object' && 'title' in owner ? owner : null);
  async function sheetOpen(a: MenuAction) {
    if (a.disabled) return;
    if (a.submenu) {
      sheetSub = { title: a.label, items: await a.submenu() };
      return;
    }
    ui.closeMenu();
    a.run?.();
  }

  let el: HTMLDivElement | undefined = $state();
  let subEl: HTMLDivElement | undefined = $state();
  let pos = $state({ x: 0, y: 0 });
  let sub = $state<{ items: MenuAction[]; x: number; y: number; idx: number } | null>(null);
  let subPos = $state({ x: 0, y: 0 });

  $effect(() => {
    const m = ui.menu;
    sub = null;
    if (!m) return;
    pos = { x: m.x, y: m.y };
    tick().then(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      pos = {
        x: Math.max(4, Math.min(m.x, window.innerWidth - r.width - 8)),
        y: Math.max(4, m.y + r.height > window.innerHeight - 8 ? m.y - r.height : m.y),
      };
    });
  });

  $effect(() => {
    if (!sub) return;
    subPos = { x: sub.x, y: sub.y };
    tick().then(() => {
      if (!subEl || !sub) return;
      const r = subEl.getBoundingClientRect();
      const parent = el!.getBoundingClientRect();
      let x = parent.right - 4;
      if (x + r.width > window.innerWidth - 8) x = parent.left - r.width + 4;
      subPos = { x, y: Math.max(4, Math.min(sub.y, window.innerHeight - r.height - 8)) };
    });
  });

  async function openSub(a: MenuAction, idx: number, e: MouseEvent) {
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    const items = await a.submenu!();
    sub = { items, x: r.right, y: r.top - 4, idx };
  }

  function run(a: MenuAction) {
    if (a.disabled) return;
    ui.closeMenu();
    a.run?.();
  }

  function onDocDown(e: MouseEvent) {
    if (!ui.menu) return;
    const t = e.target as Node;
    if (el?.contains(t) || subEl?.contains(t)) return;
    ui.closeMenu();
  }
</script>

<svelte:window onmousedown={(e) => !isMobile && onDocDown(e)} onkeydown={(e) => e.key === 'Escape' && ui.closeMenu()} onblur={() => !isMobile && ui.closeMenu()} onresize={() => !isMobile && ui.closeMenu()} />

{#if isMobile}
  {#if ui.menu}
    <div class="m-sheet-backdrop" role="presentation" transition:fade={{ duration: 180 }} onclick={() => ui.closeMenu()}></div>
    <div class="m-sheet" role="menu" tabindex="-1" transition:fly={{ y: 500, duration: 240, opacity: 1 }}>
      <div class="m-sheet-grab"></div>
      {#if head && !sheetSub}
        <div class="m-sheet-head">
          <Img thumbs={head.thumbnails} size={96} class={head.type === 'artist' ? 'round' : ''} />
          <div class="m">
            <div class="a">{head.title}</div>
            <div class="b">{head.artists?.length ? artistNames(head.artists) : head.subtitle ?? ''}</div>
          </div>
        </div>
      {/if}
      {#if sheetSub}
        <button class="m-sheet-item back" onclick={() => (sheetSub = null)}><Icon name="chevronLeft" size={22} /><span>{sheetSub.title}</span></button>
      {/if}
      <div class="m-sheet-list">
        {#each sheetSub?.items ?? ui.menu.actions as a}
          {#if !a.divider}
            <button class="m-sheet-item" class:danger={a.danger} disabled={a.disabled} onclick={() => sheetOpen(a)}>
              {#if a.icon}<Icon name={a.icon} size={22} />{:else}<span style="width:22px"></span>{/if}<span>{a.label}</span>
              {#if a.submenu}<Icon name="chevronRight" size={16} />{/if}
            </button>
          {/if}
        {/each}
      </div>
      <button class="m-sheet-cancel" onclick={() => ui.closeMenu()}>Close</button>
    </div>
  {/if}
{:else}

{#if ui.menu}
  <div class="ctx-menu" bind:this={el} style="left:{pos.x}px;top:{pos.y}px" role="menu" tabindex="-1" oncontextmenu={(e) => e.preventDefault()}>
    {#each ui.menu.actions as a, i}
      {#if a.divider}
        {#if i > 0 && i < ui.menu.actions.length - 1}<div class="ctx-sep"></div>{/if}
      {:else if a.submenu}
        <button class="ctx-item" class:open={sub?.idx === i} role="menuitem" onmouseenter={(e) => openSub(a, i, e)} onclick={(e) => openSub(a, i, e)}>
          {#if a.icon}<Icon name={a.icon} />{/if}<span class="lbl">{a.label}</span><Icon name="chevronRight" size={12} />
        </button>
      {:else}
        <button class="ctx-item" class:danger={a.danger} role="menuitem" disabled={a.disabled} onmouseenter={() => (sub = null)} onclick={() => run(a)}>
          {#if a.icon}<Icon name={a.icon} />{/if}<span class="lbl">{a.label}</span>
        </button>
      {/if}
    {/each}
  </div>
  {#if sub}
    <div class="ctx-menu" bind:this={subEl} style="left:{subPos.x}px;top:{subPos.y}px" role="menu" tabindex="-1">
      {#each sub.items as a}
        {#if a.divider}<div class="ctx-sep"></div>
        {:else}<button class="ctx-item" role="menuitem" disabled={a.disabled} onclick={() => run(a)}>{#if a.icon}<Icon name={a.icon} />{/if}<span class="lbl">{a.label}</span></button>{/if}
      {/each}
    </div>
  {/if}
{/if}
{/if}
