<script lang="ts">
  import { settings } from '../stores/settings.svelte';
  const bubbles = [
    { x: 8, y: 70, r: 120, d: 0 },
    { x: 22, y: 30, r: 60, d: -8 },
    { x: 38, y: 82, r: 90, d: -16 },
    { x: 55, y: 18, r: 140, d: -4 },
    { x: 70, y: 60, r: 70, d: -20 },
    { x: 86, y: 28, r: 110, d: -12 },
    { x: 92, y: 85, r: 50, d: -2 },
    { x: 48, y: 52, r: 36, d: -26 },
  ];
</script>

<div class="aero-backdrop {settings.aeroWallpaper}" aria-hidden="true">
  {#if settings.aeroWallpaper === 'aurora'}
    <svg class="streaks" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="ag1" cx="30%" cy="60%" r="70%">
          <stop offset="0" stop-color="var(--accent)" stop-opacity=".55" />
          <stop offset="1" stop-color="var(--accent)" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="ag2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#fff" stop-opacity="0" />
          <stop offset=".5" stop-color="#fff" stop-opacity=".55" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="1600" height="1000" fill="url(#ag1)" />
      <path d="M-100 720 C 300 520, 700 900, 1100 600 S 1600 420, 1800 520" stroke="url(#ag2)" stroke-width="60" fill="none" opacity=".55" />
      <path d="M-100 780 C 320 600, 760 960, 1140 660 S 1600 500, 1800 600" stroke="url(#ag2)" stroke-width="18" fill="none" opacity=".8" />
      <path d="M-100 650 C 260 470, 640 820, 1060 540 S 1580 360, 1800 450" stroke="url(#ag2)" stroke-width="8" fill="none" opacity=".9" />
      <path d="M200 1000 C 500 640, 900 760, 1300 380 S 1600 160, 1700 120" stroke="url(#ag2)" stroke-width="90" fill="none" opacity=".25" />
    </svg>
  {:else if settings.aeroWallpaper === 'sky'}
    <div class="sun"></div>
    <div class="cloud c1"></div>
    <div class="cloud c2"></div>
    <div class="cloud c3"></div>
    <svg class="hills" viewBox="0 0 1600 400" preserveAspectRatio="none">
      <defs>
        <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#8fe05a" />
          <stop offset=".5" stop-color="#3fae2a" />
          <stop offset="1" stop-color="#1f7a1a" />
        </linearGradient>
        <linearGradient id="hg2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#b8f07a" />
          <stop offset="1" stop-color="#4cbd34" />
        </linearGradient>
      </defs>
      <path d="M0 220 C 300 80, 700 120, 1000 200 S 1450 260, 1600 150 L1600 400 L0 400Z" fill="url(#hg2)" opacity=".9" />
      <path d="M0 300 C 400 160, 800 220, 1100 280 S 1500 320, 1600 260 L1600 400 L0 400Z" fill="url(#hg)" />
    </svg>
  {:else}
    {#each bubbles as b}
      <div class="bubble" style="left:{b.x}%;top:{b.y}%;width:{b.r}px;height:{b.r}px;animation-delay:{b.d}s"></div>
    {/each}
  {/if}
  <div class="vignette"></div>
</div>

<style>
  .aero-backdrop {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    pointer-events: none;
  }
  .aurora {
    background: radial-gradient(ellipse at 70% 0%, #3aa0ff 0%, transparent 55%), linear-gradient(160deg, #0a3d8f 0%, #0d5bc7 35%, #1b86e6 60%, #0a4aa8 100%);
  }
  .streaks {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .sky {
    background: linear-gradient(#1565d8 0%, #3f9bf0 35%, #9ad7ff 70%, #e7f7ff 100%);
  }
  .sun {
    position: absolute;
    right: 12%;
    top: 8%;
    width: 220px;
    height: 220px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 255, 230, 0.95) 0, rgba(255, 255, 200, 0.35) 35%, transparent 70%);
  }
  .cloud {
    position: absolute;
    height: 60px;
    border-radius: 60px;
    background: rgba(255, 255, 255, 0.85);
    filter: blur(6px);
    box-shadow: 40px -20px 0 10px rgba(255, 255, 255, 0.8), 100px 0 0 0 rgba(255, 255, 255, 0.75);
  }
  .c1 {
    width: 180px;
    left: 8%;
    top: 14%;
  }
  .c2 {
    width: 240px;
    left: 45%;
    top: 26%;
    opacity: 0.8;
  }
  .c3 {
    width: 140px;
    left: 70%;
    top: 40%;
    opacity: 0.7;
  }
  .hills {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 42%;
  }
  .bubbles {
    background: radial-gradient(ellipse at 50% 120%, rgba(var(--accent-rgb), 0.55) 0, transparent 60%), linear-gradient(170deg, #00a2d8 0%, #26c6e8 40%, #8ee8f5 75%, #e3fbff 100%);
  }
  .bubble {
    position: absolute;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.95) 0, rgba(255, 255, 255, 0.35) 18%, rgba(255, 255, 255, 0.08) 45%, rgba(255, 255, 255, 0.25) 70%, rgba(255, 255, 255, 0.55) 100%);
    box-shadow: inset 0 0 20px rgba(255, 255, 255, 0.5), 0 0 10px rgba(255, 255, 255, 0.25);
    animation: float 38s ease-in-out infinite alternate;
  }
  @keyframes float {
    to {
      transform: translate(30px, -60px);
    }
  }
  .vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at center, transparent 55%, rgba(0, 20, 60, 0.25) 100%);
  }
</style>
