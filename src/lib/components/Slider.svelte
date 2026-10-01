<script lang="ts">
  let {
    value = 0,
    max = 1,
    buffered = 0,
    oninput,
    onchange,
    label = '',
    class: cls = '',
  }: { value?: number; max?: number; buffered?: number; oninput?: (v: number) => void; onchange?: (v: number) => void; label?: string; class?: string } = $props();
  let el: HTMLDivElement;
  let dragging = $state(false);
  let dragVal = $state(0);
  const shown = $derived(dragging ? dragVal : value);
  const pct = $derived(max > 0 ? Math.max(0, Math.min(100, (shown / max) * 100)) : 0);
  const bpct = $derived(max > 0 ? Math.max(0, Math.min(100, (buffered / max) * 100)) : 0);

  function at(e: PointerEvent) {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * max;
  }
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    dragging = true;
    dragVal = at(e);
    el.setPointerCapture(e.pointerId);
    oninput?.(dragVal);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    dragVal = at(e);
    oninput?.(dragVal);
  }
  function up(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    onchange?.(at(e));
  }
  function key(e: KeyboardEvent) {
    const step = max / 20;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onchange?.(Math.min(max, value + step));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onchange?.(Math.max(0, value - step));
    else return;
    e.preventDefault();
  }
</script>

<div
  class="slider {cls}"
  class:dragging
  bind:this={el}
  role="slider"
  tabindex="0"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={max}
  aria-valuenow={value}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
>
  <div class="track-bg">
    <div class="buf" style="width:{bpct}%"></div>
    <div class="fill" style="width:{pct}%"></div>
  </div>
  <div class="knob" style="left:{pct}%"></div>
</div>
