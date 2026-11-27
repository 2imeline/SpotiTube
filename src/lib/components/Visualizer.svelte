<script lang="ts">
  // Album-coloured background that moves with the music: soft colour blooms
  // that drift and swell with the bass, and fine silk ribbons that ripple with
  // the mids and highs. Everything is eased so it flows rather than flickers.
  import { onMount } from 'svelte';
  import type { RGB } from '../util/color';

  let {
    colors,
    analyser = null,
    playing = false,
    still = false,
    onbeat,
  }: {
    colors: RGB[];
    analyser?: AnalyserNode | null;
    playing?: boolean;
    /** reduced motion: a calm, almost static gradient */
    still?: boolean;
    /** 0..1 every frame: overall loudness with a lift on beats (for glows elsewhere) */
    onbeat?: (level: number) => void;
  } = $props();

  let back: HTMLCanvasElement;
  let front: HTMLCanvasElement;

  // colours glide to the next song's palette instead of jumping
  let cur: RGB[] = [];
  const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  onMount(() => {
    const bctx = back.getContext('2d')!;
    const fctx = front.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    // eased band levels 0..1
    let bass = 0, mid = 0, high = 0, beat = 0, avgBass = 0.2, lastBeat = 0;
    let W = 0, H = 0, dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = front.clientWidth;
      H = front.clientHeight;
      front.width = Math.round(W * dpr);
      front.height = Math.round(H * dpr);
      // the blooms are soft anyway: a small canvas scaled up is smooth and cheap
      back.width = Math.max(64, Math.round(W / 6));
      back.height = Math.max(36, Math.round(H / 6));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(front);

    const band = (from: number, to: number) => {
      if (!bins) return 0;
      let s = 0;
      for (let i = from; i < to; i++) s += bins[i];
      return s / ((to - from) * 255);
    };
    const ease = (v: number, target: number, dt: number) => v + (target - v) * (1 - Math.exp(-dt * (target > v ? 14 : 3)));

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (document.hidden) return;

      // ---- audio
      let tb = 0, tm = 0, th = 0;
      if (analyser && playing) {
        if (!bins || bins.length !== analyser.frequencyBinCount) bins = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);
        // bin width ≈ 22 Hz: bass ~40-170 Hz, mids ~0.3-2.6 kHz, highs ~2.6-9 kHz
        tb = band(2, 8);
        tm = band(14, 120);
        th = band(120, 420) * 1.8;
      } else if (playing) {
        // no audio data (iPhone): a slow, musical-looking breath
        tb = 0.45 + 0.15 * Math.sin(t * 2.1);
        tm = 0.35 + 0.1 * Math.sin(t * 1.3 + 1);
        th = 0.25;
      }
      if (still) tb = tm = th = 0.2;
      bass = ease(bass, tb, dt);
      mid = ease(mid, tm, dt);
      high = ease(high, Math.min(1, th), dt);
      avgBass += (tb - avgBass) * Math.min(1, dt * 1.2);
      if (!still && tb > avgBass * 1.22 && tb > 0.35 && now - lastBeat > 280) {
        beat = 1;
        lastBeat = now;
      }
      beat *= Math.exp(-dt * 3.2);
      onbeat?.(Math.min(1, bass * 0.7 + beat * 0.5));

      // ---- palette
      const target = colors.length ? colors : ([[90, 90, 110], [60, 60, 80], [120, 110, 140], [40, 40, 60]] as RGB[]);
      if (cur.length !== target.length) cur = target.map((c) => [...c] as RGB);
      cur = cur.map((c, i) => mix(c, target[i], 1 - Math.exp(-dt * 1.5)));

      // time runs a little faster when the music is loud
      t += dt * (still ? 0.15 : 0.35 + mid * 0.6 + beat * 0.4);

      // ---- blooms
      const bw = back.width, bh = back.height;
      const base = mix(cur[cur.length - 1], [0, 0, 0], 0.82);
      bctx.globalCompositeOperation = 'source-over';
      bctx.fillStyle = rgba(base, 1);
      bctx.fillRect(0, 0, bw, bh);
      bctx.globalCompositeOperation = 'lighter';
      const blobs = 5;
      for (let i = 0; i < blobs; i++) {
        const c = cur[i % cur.length];
        const ph = i * 1.7;
        const x = bw * (0.5 + 0.38 * Math.sin(t * (0.21 + i * 0.037) + ph) * Math.cos(t * 0.13 + ph * 0.5));
        const y = bh * (0.5 + 0.34 * Math.cos(t * (0.17 + i * 0.029) + ph * 1.3));
        const r = Math.max(bw, bh) * (0.32 + 0.06 * Math.sin(t * 0.5 + ph) + bass * 0.16 + beat * 0.05);
        const a = 0.26 + bass * 0.12 + beat * 0.08;
        const g = bctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(c, a));
        g.addColorStop(0.55, rgba(c, a * 0.35));
        g.addColorStop(1, rgba(c, 0));
        bctx.fillStyle = g;
        bctx.fillRect(0, 0, bw, bh);
      }

      // ---- silk ribbons
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fctx.clearRect(0, 0, W, H);
      fctx.globalCompositeOperation = 'lighter';
      fctx.lineWidth = 1;
      const ribbons = [
        { y: 0.62, amp: 0.07 + bass * 0.1, f: 1.4, s: 0.6, c: cur[0], lvl: bass },
        { y: 0.68, amp: 0.05 + mid * 0.11, f: 2.2, s: -0.45, c: cur[1], lvl: mid },
        { y: 0.74, amp: 0.035 + high * 0.08, f: 3.1, s: 0.8, c: cur[2], lvl: high },
      ];
      const threads = 14;
      const step = Math.max(6, W / 140);
      for (const r of ribbons) {
        for (let k = 0; k < threads; k++) {
          const off = k / threads;
          // threads fan out in the middle of the screen and meet at the edges
          fctx.strokeStyle = rgba(r.c, (0.05 + r.lvl * 0.09 + beat * 0.03) * (1 - Math.abs(off - 0.5)));
          fctx.beginPath();
          for (let x = 0; x <= W + step; x += step) {
            const u = x / W;
            const env = Math.sin(Math.PI * u);
            const wave =
              Math.sin(u * Math.PI * r.f + t * r.s * 2 + off * 1.2) * 0.65 +
              Math.sin(u * Math.PI * r.f * 2.3 - t * r.s * 1.4 + off * 2.1) * 0.35;
            const y = H * (r.y + (off - 0.5) * 0.05 * env) + H * r.amp * env * wave;
            if (x === 0) fctx.moveTo(x, y);
            else fctx.lineTo(x, y);
          }
          fctx.stroke();
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });
</script>

<div class="viz" aria-hidden="true">
  <canvas class="back" bind:this={back}></canvas>
  <canvas class="front" bind:this={front}></canvas>
  <div class="shade"></div>
</div>

<style>
  .viz {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #000;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .back {
    /* soften the upscaled blooms a touch more */
    filter: blur(24px) saturate(1.15);
    transform: scale(1.08);
  }
  /* keeps text readable: darker at the top (bar) and bottom (controls) */
  .shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to bottom, rgba(0, 0, 0, 0.35), transparent 22%, transparent 70%, rgba(0, 0, 0, 0.55)),
      radial-gradient(ellipse at center, transparent 40%, rgba(0, 0, 0, 0.35));
  }
</style>
