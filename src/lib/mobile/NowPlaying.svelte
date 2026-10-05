<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Icon from '../components/Icon.svelte';
  import Img from '../components/Img.svelte';
  import Slider from '../components/Slider.svelte';
  import VideoStage from '../components/VideoStage.svelte';
  import QueuePane from './QueuePane.svelte';
  import LyricsPane from './LyricsPane.svelte';
  import { player } from '../player/player.svelte';
  import { lyrics } from '../player/lyrics.svelte';
  import { library } from '../stores/library.svelte';
  import { settings } from '../stores/settings.svelte';
  import { ui, type MenuAction } from '../stores/ui.svelte';
  import { go } from '../stores/router.svelte';
  import { trackMenu, showCredits, shareUrl } from '../actions';
  import { getArtist } from '../api/ytm';
  import type { PageHeader } from '../api/types';
  import { artistNames, bestThumb } from '../util/thumbs';
  import { dominantColor } from '../util/color';
  import { haptic, share } from '../native/ios.svelte';
  import { call } from '../api/transport';
  import { onMount } from 'svelte';

  const theme = $derived(settings.theme);
  const t = $derived(player.current);
  const liked = $derived(t ? library.likeOf(t) === 'LIKE' : false);
  let color = $state<string | null>(null);
  $effect(() => {
    dominantColor(bestThumb(t?.thumbnails, 60)).then((c) => (color = c));
  });
  const art = $derived(bestThumb(t?.thumbnails, 800));

  function fmt(s: number) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
  let seeking = $state<number | null>(null);
  const shownTime = $derived(seeking ?? player.time);

  function close() {
    ui.npPane = 'none';
    ui.nowPlayingOpen = false;
  }

  // ---- swipe down to close
  let startY = 0;
  let dy = $state(0);
  let dragging = false;
  let scroller: HTMLDivElement | undefined = $state();
  function ts(e: TouchEvent) {
    if ((scroller?.scrollTop ?? 0) > 0 || ui.npPane !== 'none') return;
    if ((e.target as HTMLElement).closest('.slider, .m-np-controls, button')) return;
    dragging = true;
    startY = e.touches[0].clientY;
    dy = 0;
  }
  function tm(e: TouchEvent) {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
  }
  function te() {
    if (!dragging) return;
    dragging = false;
    if (dy > 140) close();
    dy = 0;
  }

  // ---- extra cards (Spotify): about the artist
  let artist = $state.raw<{ id: string; h: PageHeader } | null>(null);
  $effect(() => {
    const id = t?.artists.find((a) => a.id?.startsWith('UC'))?.id;
    if (!id || artist?.id === id || theme !== 'spotify') return;
    getArtist(id).then((a) => (artist = { id, h: a.header })).catch(() => {});
  });
  // lyrics preview card
  $effect(() => {
    t?.videoId;
    lyrics.load();
  });

  function more(e: MouseEvent) {
    if (!t) return;
    const extra: MenuAction[] = [
      {
        label: 'Sleep timer',
        icon: 'timer',
        submenu: () => [
          ...[5, 10, 15, 30, 45, 60].map((m) => ({ label: `${m} minutes`, run: () => player.setSleep(m) })),
          { label: 'End of track', run: () => player.setSleep('track') },
          ...(player.sleepAt || player.sleepEndOfTrack ? [{ label: 'Turn off timer', run: () => player.setSleep(null) }] : []),
        ],
      },
    ];
    if (t.type === 'episode')
      extra.push({ label: `Playback speed (${player.rate}×)`, icon: 'speaker', submenu: () => [0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ label: `${r}×`, run: () => player.setRate(r) })) });
    extra.push({ label: player.video ? 'Switch to audio' : 'Switch to video', icon: player.video ? 'music' : 'video', run: () => player.setVideo(!player.video) });
    extra.push({ label: '', divider: true });
    ui.openMenu(e, [...extra, ...trackMenu(t)], t);
  }

  function go2(path: string) {
    close();
    go(path);
  }

  function toggleLike() {
    if (!t) return;
    haptic(liked ? 'light' : 'success');
    library.toggleLike(t);
  }

  onMount(() => {
    haptic('light');
    return () => {
      if (player.video) call('video_rect', {}).catch(() => {});
    };
  });

  const sourceLabel = $derived.by(() => {
    const p = player.source?.path ?? '';
    if (p.startsWith('/album')) return 'PLAYING FROM ALBUM';
    if (p.startsWith('/artist')) return 'PLAYING FROM ARTIST';
    if (p.startsWith('/playlist') || p.startsWith('/sp-playlist')) return 'PLAYING FROM PLAYLIST';
    if (p.startsWith('/search') || player.source?.title?.startsWith('Search')) return 'PLAYING FROM SEARCH';
    return 'PLAYING FROM';
  });
</script>

{#snippet controls(big = 64)}
  <div class="m-np-controls">
    {#if theme !== 'apple'}
      <button class="c-side" class:on={player.shuffle} aria-label="Shuffle" onclick={() => { haptic('select'); player.toggleShuffle(); }}><Icon name="shuffle" size={24} /></button>
    {/if}
    <button class="c-skip" aria-label="Previous" onclick={() => { haptic('light'); player.previous(); }}><Icon name={theme === 'apple' ? 'rew' : 'prev'} size={theme === 'apple' ? 40 : 34} /></button>
    <button class="c-play" style="--big:{big}px" aria-label={player.playing ? 'Pause' : 'Play'} onclick={() => { haptic('medium'); player.toggle(); }}>
      {#if player.loading && !player.playing}<span class="spinner"></span>{:else}<Icon name={player.playing ? 'pause' : 'play'} size={theme === 'apple' ? 44 : 30} />{/if}
    </button>
    <button class="c-skip" aria-label="Next" onclick={() => { haptic('light'); player.next(); }}><Icon name={theme === 'apple' ? 'fwd' : 'next'} size={theme === 'apple' ? 40 : 34} /></button>
    {#if theme !== 'apple'}
      <button class="c-side" class:on={player.repeat !== 'off'} aria-label="Repeat" onclick={() => { haptic('select'); player.cycleRepeat(); }}><Icon name={player.repeat === 'one' ? 'repeatOne' : 'repeat'} size={24} /></button>
    {/if}
  </div>
{/snippet}

{#if t}
  <div
    class="m-np {theme}"
    class:paused={!player.playing}
    style="--np-color:{color ?? '#535353'};{dy ? `transform:translateY(${dy}px);transition:none` : ''}"
    transition:fly={{ y: 900, duration: 320, easing: cubicOut, opacity: 1 }}
    role="dialog"
    aria-label="Now playing"
    tabindex="-1"
    ontouchstart={ts}
    ontouchmove={tm}
    ontouchend={te}
  >
    <div class="m-np-bg">{#if theme === 'apple'}<div class="m-np-blur" style="background-image:url('{bestThumb(t.thumbnails, 120)}')"></div>{/if}</div>
    <div class="m-np-scroll" bind:this={scroller}>
      <div class="m-np-main">
        {#if theme === 'apple'}
          <div class="m-np-grabber" role="button" tabindex="0" aria-label="Close" onclick={close} onkeydown={() => {}}></div>
        {:else}
          <header class="m-np-head">
            <button class="icon-btn" aria-label="Close" onclick={close}><Icon name="chevronDown" size={26} /></button>
            <div class="src" role="button" tabindex="0" onclick={() => player.source?.path && go2(player.source.path)} onkeydown={() => {}}>
              {#if theme === 'aero'}
                <div class="k">Now Playing</div>
              {:else}
                <div class="k">{sourceLabel}</div>
              {/if}
              <div class="v">{player.source?.title ?? ''}</div>
            </div>
            <button class="icon-btn" aria-label="More" onclick={more}><Icon name="more" size={24} /></button>
          </header>
        {/if}

        {#if t.type === 'song' && t.counterpart && theme === 'spotify'}
          <div class="m-np-switch">
            <button class:on={!player.video} onclick={() => player.setVideo(false)}>Song</button>
            <button class:on={player.video} onclick={() => player.setVideo(true)}>Video</button>
          </div>
        {/if}

        <div class="m-np-art">
          {#if player.video}
            <div class="m-np-video"><VideoStage /></div>
          {:else}
            <Img thumbs={t.thumbnails} size={800} eager />
            {#if theme === 'aero'}<div class="m-np-reflect" style="background-image:url('{art}')"></div>{/if}
          {/if}
        </div>

        <div class="m-np-info">
          <div class="txt">
            <div class="title" role="link" tabindex="0" onclick={() => t.album?.id && go2(`/album/${t.album.id}`)} onkeydown={() => {}}>{t.title}</div>
            <div class="artist">
              {#each t.artists as a, i}{#if i}{', '}{/if}{#if a.id}<a href="#/" onclick={(e) => { e.preventDefault(); go2(`/artist/${a.id}`); }}>{a.name}</a>{:else}{a.name}{/if}{/each}
            </div>
          </div>
          {#if theme === 'apple'}
            {#if t.type !== 'episode'}<button class="round-glass" class:on={liked} aria-label="Favorite" onclick={toggleLike}><Icon name={liked ? 'starFill' : 'star'} size={18} /></button>{/if}
            <button class="round-glass" aria-label="More" onclick={more}><Icon name="more" size={18} /></button>
          {:else if t.type !== 'episode'}
            <button class="like" class:on={liked} aria-label={liked ? 'Remove from Liked Music' : 'Save to Liked Music'} onclick={toggleLike}>
              <Icon name={theme === 'aero' ? (liked ? 'heartFill' : 'heart') : liked ? 'checkCircle' : 'addCircle'} size={28} />
            </button>
          {/if}
        </div>

        <div class="m-np-seek">
          <Slider value={shownTime} max={player.duration || 1} buffered={player.buffered} label="Seek" oninput={(v) => (seeking = v)} onchange={(v) => { seeking = null; player.seek(v); }} />
          <div class="times"><span>{fmt(shownTime)}</span>{#if theme === 'apple'}<span class="q">{player.stream?.mime?.includes('mp4a') ? 'AAC' : ''}</span>{/if}<span>{theme === 'apple' ? '-' + fmt(Math.max(0, player.duration - shownTime)) : fmt(player.duration)}</span></div>
        </div>

        {@render controls(theme === 'aero' ? 78 : 64)}

        <div class="m-np-extras">
          {#if theme === 'apple'}
            <button class:on={ui.npPane === 'lyrics'} aria-label="Lyrics" onclick={() => (ui.npPane = ui.npPane === 'lyrics' ? 'none' : 'lyrics')}><Icon name="quote" size={22} /></button>
            <button aria-label="AirPlay" onclick={() => call('show_route_picker').catch(() => {})}><Icon name="airplay" size={22} /></button>
            <button class:on={ui.npPane === 'queue'} aria-label="Playing Next" onclick={() => (ui.npPane = ui.npPane === 'queue' ? 'none' : 'queue')}><Icon name="list" size={22} /></button>
          {:else}
            <button aria-label="Devices" onclick={() => call('show_route_picker').catch(() => {})}><Icon name="devices" size={20} /></button>
            <span class="grow">{#if player.sleepAt || player.sleepEndOfTrack}<span class="sleep"><Icon name="timer" size={14} /> Sleep timer on</span>{/if}</span>
            {#if theme === 'aero'}<button aria-label="Lyrics" onclick={() => (ui.npPane = 'lyrics')}><Icon name="lyrics" size={20} /></button>{/if}
            <button aria-label="Share" onclick={() => share(`${t.title} – ${artistNames(t.artists)}`, shareUrl(t))}><Icon name="shareIos" size={20} /></button>
            <button aria-label="Queue" onclick={() => (ui.npPane = 'queue')}><Icon name="queue" size={20} /></button>
          {/if}
        </div>
      </div>

      {#if theme === 'spotify'}
        <div class="m-np-cards">
          <div class="m-card lyrics-card" role="button" tabindex="0" onclick={() => (ui.npPane = 'lyrics')} onkeydown={() => {}}>
            <div class="hd"><span>Lyrics preview</span><span class="open">Show lyrics</span></div>
            {#if lyrics.loading}
              <div class="ln msg">Loading…</div>
            {:else if lyrics.data?.lines?.length}
              {@const start = Math.max(0, lyrics.active)}
              {#each lyrics.data.lines.slice(start, start + 4) as l, i}<div class="ln" class:dim={i > 0}>{l.text || '♪'}</div>{/each}
            {:else if lyrics.data?.text}
              {#each lyrics.data.text.split('\n').slice(0, 4) as l}<div class="ln">{l}</div>{/each}
            {:else}
              <div class="ln msg">No lyrics for this song</div>
            {/if}
          </div>
          {#if artist}
            <div class="m-card artist-card" role="button" tabindex="0" onclick={() => go2(`/artist/${artist!.id}`)} onkeydown={() => {}}>
              <div class="img" style="background-image:url('{bestThumb(artist.h.banner ?? artist.h.thumbnails, 700)}')"><span>About the artist</span></div>
              <div class="bd">
                <div class="nm">{artist.h.title}</div>
                {#if artist.h.monthlyListeners || artist.h.subscribers}<div class="sub">{artist.h.monthlyListeners ?? `${artist.h.subscribers} subscribers`}</div>{/if}
                {#if artist.h.description}<p>{artist.h.description}</p>{/if}
              </div>
            </div>
          {/if}
          {#if t.menu?.creditsId}
            <div class="m-card">
              <div class="hd"><span>Credits</span><button class="open" onclick={() => showCredits(t.menu!.creditsId!, t.title)}>Show all</button></div>
              <div class="credit"><b>{artistNames(t.artists)}</b><span>Main artist</span></div>
            </div>
          {/if}
          {#if player.upNext.length}
            <div class="m-card">
              <div class="hd"><span>Next in queue</span><button class="open" onclick={() => (ui.npPane = 'queue')}>Open queue</button></div>
              {#each player.upNext.slice(0, 3) as n, j (n.qid)}
                <div class="q-row" role="button" tabindex="0" onclick={() => player.jump(player.index + 1 + j)} onkeydown={() => {}}>
                  <Img thumbs={n.thumbnails} size={48} />
                  <div class="m"><div class="a">{n.title}</div><div class="b">{artistNames(n.artists)}</div></div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if ui.npPane === 'queue'}<QueuePane {color} />{/if}
    {#if ui.npPane === 'lyrics'}<LyricsPane {color} />{/if}
  </div>
{/if}
