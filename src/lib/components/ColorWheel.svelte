<script lang="ts">
  import type { Snippet } from 'svelte';
  import { hexToHsv, hsvToHex } from '../stores/settings.svelte';
  let { value, onchange, children }: { value: string; onchange: (hex: string) => void; children?: Snippet } = $props();

  let hsv = $state<[number, number, number]>([0, 0, 1]);
  let lastEmitted = '';
  $effect(() => {
    if (value.toLowerCase() !== lastEmitted.toLowerCase()) hsv = hexToHsv(value);
  });
  let wheel: HTMLDivElement;
  let bar: HTMLDivElement;
  let hexInput = $state('');
  $effect(() => {
    hexInput = value.toUpperCase();
  });

  function emit() {
    lastEmitted = hsvToHex(hsv[0], hsv[1], hsv[2]);
    onchange(lastEmitted);
  }
  function pickWheel(e: PointerEvent) {
    const r = wheel.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // hue 0 at the right (3 o'clock), increasing counter-clockwise to match the conic gradient
    let h = (Math.atan2(-dy, dx) * 180) / Math.PI;
    if (h < 0) h += 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    hsv = [h, s, hsv[2] || 1];
    emit();
  }
  function pickBar(e: PointerEvent) {
    const r = bar.getBoundingClientRect();
    const v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    hsv = [hsv[0], hsv[1], v];
    emit();
  }
  function drag(fn: (e: PointerEvent) => void) {
    return (e: PointerEvent) => {
      const t = e.currentTarget as HTMLElement;
      t.setPointerCapture(e.pointerId);
      fn(e);
      const mv = (ev: PointerEvent) => fn(ev);
      const up = () => {
        t.removeEventListener('pointermove', mv);
        t.removeEventListener('pointerup', up);
      };
      t.addEventListener('pointermove', mv);
      t.addEventListener('pointerup', up);
    };
  }
  const ptX = $derived(50 + Math.cos((hsv[0] * Math.PI) / 180) * hsv[1] * 50);
  const ptY = $derived(50 - Math.sin((hsv[0] * Math.PI) / 180) * hsv[1] * 50);
  const pure = $derived(hsvToHex(hsv[0], hsv[1], 1));

  function commitHex() {
    const v = hexInput.trim().replace(/^#?/, '#');
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      hsv = hexToHsv(v);
      lastEmitted = v;
      onchange(v.toLowerCase());
    } else hexInput = value.toUpperCase();
  }
</script>

<div class="color-picker">
  <div class="wheel" bind:this={wheel} onpointerdown={drag(pickWheel)} role="slider" tabindex="0" aria-label="Hue and saturation" aria-valuenow={Math.round(hsv[0])}>
    <div class="hue"></div>
    <div class="sat"></div>
    <div class="shade" style="opacity:{1 - hsv[2]}"></div>
    <div class="pt" style="left:{ptX}%;top:{ptY}%;background:{value}"></div>
  </div>
  <div class="vbar" bind:this={bar} style="background:linear-gradient({pure},#000)" onpointerdown={drag(pickBar)} role="slider" tabindex="0" aria-label="Brightness" aria-valuenow={Math.round(hsv[2] * 100)}>
    <div class="pt" style="top:{(1 - hsv[2]) * 100}%"></div>
  </div>
  <div class="color-side">
    <div class="color-preview">
      <div class="big" style="background:{value}"></div>
      <input class="input" bind:value={hexInput} onchange={commitHex} onkeydown={(e) => e.key === 'Enter' && commitHex()} maxlength="7" spellcheck="false" aria-label="Hex color" />
    </div>
    {@render children?.()}
  </div>
</div>
