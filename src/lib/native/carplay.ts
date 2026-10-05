// Lists for the CarPlay screen (native templates ask through `cp.*` calls).
// Rows reference items by short tokens kept here.
import { getAlbum, getArtist, getHistory, getHome, getPlaylist, getPodcast, getLibrary, LIBRARY } from '../api/ytm';
import type { Card, Item, Track } from '../api/types';
import { player } from '../player/player.svelte';
import { library } from '../stores/library.svelte';
import { auth } from '../stores/auth.svelte';
import { playCard } from '../actions';
import { artistNames, bestThumb } from '../util/thumbs';

interface Row {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  kind: 'list' | 'play';
  playing?: boolean;
}
interface Section {
  title?: string;
  items: Row[];
}

type Target =
  | { t: 'card'; card: Card }
  | { t: 'list'; tracks: Track[]; index: number; title: string; path?: string; shuffle?: boolean }
  | { t: 'queue'; index: number }
  | { t: 'track'; track: Track; title: string }
  | { t: 'liked' };

const targets = new Map<string, Target>();
let n = 0;
function tok(x: Target): string {
  if (targets.size > 3000) targets.clear();
  const id = 'r' + ++n;
  targets.set(id, x);
  return id;
}

const isListCard = (c: Card) => !['song', 'video', 'episode', 'station', 'mood'].includes(c.type);
const typeLabel: Record<string, string> = { album: 'Album', single: 'Single', ep: 'EP', playlist: 'Playlist', artist: 'Artist', profile: 'Profile', podcast: 'Podcast', station: 'Mix' };

function cardRow(c: Card): Row {
  return {
    id: tok({ t: 'card', card: c }),
    title: c.title,
    subtitle: c.subtitle || typeLabel[c.type] || '',
    image: bestThumb(c.thumbnails, 120),
    kind: isListCard(c) ? 'list' : 'play',
  };
}

function trackRows(tracks: Track[], title: string, path?: string, max = 80): Row[] {
  return tracks.slice(0, max).map((t, i) => ({
    id: tok({ t: 'list', tracks, index: i, title, path }),
    title: t.title,
    subtitle: artistNames(t.artists),
    image: bestThumb(t.thumbnails, 120),
    kind: 'play' as const,
    playing: player.current?.videoId === t.videoId,
  }));
}

function itemRow(i: Item, title: string): Row {
  if (i.kind === 'card') return cardRow(i);
  // a single song plays with its radio, like tapping it on the phone
  return {
    id: tok({ t: 'track', track: i, title }),
    title: i.title,
    subtitle: artistNames(i.artists),
    image: bestThumb(i.thumbnails, 120),
    kind: 'play',
    playing: player.current?.videoId === i.videoId,
  };
}

async function listFor(c: Card): Promise<Section[]> {
  const shuffleRow = (tracks: Track[], title: string, path?: string): Row => ({
    id: tok({ t: 'list', tracks, index: 0, title, path, shuffle: true }),
    title: 'Shuffle play',
    kind: 'play',
  });
  switch (c.type) {
    case 'album':
    case 'single':
    case 'ep': {
      const a = await getAlbum(c.browseId!);
      const path = `/album/${c.browseId}`;
      return [{ items: [shuffleRow(a.tracks, a.header.title, path), ...trackRows(a.tracks, a.header.title, path)] }];
    }
    case 'playlist': {
      const id = (c.browseId ?? c.playlistId ?? '').replace(/^VL/, '');
      const p = await getPlaylist(id);
      const path = `/playlist/${id}`;
      return [{ items: [shuffleRow(p.tracks, p.header.title, path), ...trackRows(p.tracks, p.header.title, path, 150)] }];
    }
    case 'artist':
    case 'profile': {
      const a = await getArtist(c.browseId!);
      const path = `/artist/${c.browseId}`;
      const out: Section[] = [];
      if (a.topSongs.length) out.push({ title: 'Popular', items: [shuffleRow(a.topSongs, a.header.title, path), ...trackRows(a.topSongs, a.header.title, path)] });
      for (const s of a.shelves.slice(0, 4)) {
        const cards = s.items.filter((i): i is Card => i.kind === 'card' && isListCard(i));
        if (cards.length) out.push({ title: s.title, items: cards.slice(0, 12).map(cardRow) });
      }
      return out;
    }
    case 'podcast': {
      const p = await getPodcast(c.browseId!);
      return [{ items: trackRows(p.tracks, p.header.title, `/podcast/${c.browseId}`) }];
    }
  }
  return [];
}

async function home(): Promise<{ sections: Section[] }> {
  const p = await getHome();
  const sections: Section[] = [];
  for (const s of p.shelves.slice(0, 8)) {
    const items = s.items
      .filter((i) => i.kind === 'track' || (i as Card).type !== 'mood')
      .slice(0, 10)
      .map((i) => itemRow(i, s.title));
    if (items.length) sections.push({ title: s.title, items });
  }
  return { sections };
}

async function libraryLists(): Promise<{ sections: Section[] }> {
  if (!auth.loggedIn) return { sections: [{ title: 'Sign in on your iPhone to see your library', items: [] }] };
  const first: Row[] = [{ id: tok({ t: 'liked' }), title: 'Liked Music', subtitle: 'Auto playlist', kind: 'list' }];
  const sections: Section[] = [{ items: first }];
  const playlists = library.playlists.filter((p) => p.browseId !== 'VLLM');
  if (playlists.length) sections.push({ title: 'Playlists', items: playlists.slice(0, 40).map(cardRow) });
  const [albums, artists] = await Promise.all([
    getLibrary(LIBRARY.albums).catch(() => null),
    getLibrary(LIBRARY.subscriptions).catch(() => null),
  ]);
  const ac = (albums?.items ?? []).filter((i): i is Card => i.kind === 'card');
  if (ac.length) sections.push({ title: 'Albums', items: ac.slice(0, 30).map(cardRow) });
  const ar = (artists?.items ?? []).filter((i): i is Card => i.kind === 'card');
  if (ar.length) sections.push({ title: 'Artists', items: ar.slice(0, 30).map(cardRow) });
  return { sections };
}

async function recents(): Promise<{ sections: Section[] }> {
  if (!auth.loggedIn) {
    const q = player.queue.slice(0, 40);
    return { sections: [{ title: 'Recently in your queue', items: trackRows(q, player.source?.title ?? 'Queue') }] };
  }
  const h = await getHistory();
  return { sections: [{ items: trackRows(h, 'Recently played', '/history', 60) }] };
}

function queue(): { sections: Section[] } {
  const items: Row[] = player.upNext.slice(0, 60).map((t, j) => ({
    id: tok({ t: 'queue', index: player.index + 1 + j }),
    title: t.title,
    subtitle: artistNames(t.artists),
    image: bestThumb(t.thumbnails, 120),
    kind: 'play',
  }));
  return { sections: [{ title: player.source ? `From ${player.source.title}` : undefined, items }] };
}

async function open(id: string): Promise<{ sections: Section[] }> {
  const x = targets.get(id);
  if (!x) return { sections: [] };
  if (x.t === 'liked') {
    const p = await getPlaylist('LM');
    const items = [
      { id: tok({ t: 'list', tracks: p.tracks, index: 0, title: 'Liked Music', path: '/playlist/LM', shuffle: true }), title: 'Shuffle play', kind: 'play' as const },
      ...trackRows(p.tracks, 'Liked Music', '/playlist/LM', 150),
    ];
    return { sections: [{ items }] };
  }
  if (x.t === 'card') return { sections: await listFor(x.card) };
  return { sections: [] };
}

async function play(id: string) {
  const x = targets.get(id);
  if (!x) return;
  if (x.t === 'card') return playCard(x.card);
  if (x.t === 'queue') return player.jump(x.index);
  if (x.t === 'track') return player.playTrack(x.track, { title: x.title });
  if (x.t === 'list') return player.playTracks(x.tracks, x.index, { title: x.title, path: x.path }, { shuffle: !!x.shuffle });
}

export async function carplay(name: string, args: any): Promise<unknown> {
  switch (name) {
    case 'cp.home':
      return home();
    case 'cp.library':
      return libraryLists();
    case 'cp.recents':
      return recents();
    case 'cp.open':
      return open(args.id);
    case 'cp.play':
      await play(args.id);
      return true;
    case 'cp.queue':
      return queue();
  }
  return null;
}
