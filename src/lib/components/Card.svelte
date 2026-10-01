<script lang="ts">
  import type { Card } from '../api/types';
  import Img from './Img.svelte';
  import PlayButton from './PlayButton.svelte';
  import { openCard, playCard, cardMenu } from '../actions';
  import { player } from '../player/player.svelte';
  import { cardRoute } from '../api/ytm';
  import { ui } from '../stores/ui.svelte';
  import { go } from '../stores/router.svelte';

  let { card, onRemoved }: { card: Card; onRemoved?: () => void } = $props();
  const round = $derived(card.type === 'artist' || card.type === 'profile');
  const route = $derived(cardRoute(card));
  const isCurrent = $derived(
    (card.track && player.current?.videoId === card.track.videoId) || (!!route && player.source?.path === route),
  );
  const menuOpen = $derived(!!ui.menu && ui.menu.owner === card);

  function play() {
    if (isCurrent) player.toggle();
    else playCard(card);
  }
  function ctx(e: MouseEvent) {
    ui.openMenu(e, cardMenu(card, { onRemoved }), card);
  }
  const typeLabel: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP', playlist: 'Playlist', artist: 'Artist', profile: 'Profile', podcast: 'Podcast', episode: 'Episode', song: 'Song', video: 'Video', station: 'Mix' };
</script>

<div
  class="card"
  class:round
  class:playing={isCurrent}
  class:menu-open={menuOpen}
  role="button"
  tabindex="0"
  onclick={() => openCard(card)}
  onkeydown={(e) => e.key === 'Enter' && openCard(card)}
  oncontextmenu={ctx}
>
  <div class="card-img" class:wide={card.wide}>
    <Img thumbs={card.thumbnails} size={card.wide ? 300 : 180} alt="" icon={round ? 'user' : 'music'} />
    {#if card.type !== 'mood'}
      <div class="card-play" class:visible={isCurrent && player.playing}>
        <PlayButton playing={isCurrent && player.playing} onclick={play} />
      </div>
    {/if}
  </div>
  <div class="card-title" title={card.title}>{card.title}</div>
  <div class="card-sub">
    {#if card.rank}
      #{card.rank} · {card.subtitle || typeLabel[card.type]}
    {:else if round}
      {typeLabel[card.type]}
    {:else if card.subtitle}
      {card.subtitle}
    {:else if card.artists?.length}
      {#each card.artists as a, i}{#if i}{', '}{/if}<a href="#/" onclick={(e) => { e.preventDefault(); e.stopPropagation(); if (a.id) go(`/artist/${a.id}`); }}>{a.name}</a>{/each}
    {:else}
      {typeLabel[card.type] ?? ''}
    {/if}
  </div>
</div>
