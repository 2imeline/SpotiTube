// Shared item actions: playing cards, context menus, add-to-playlist flow.
import type { Card, Endpoint, Item, Track } from './api/types';
import {
  addToPlaylist,
  cardRoute,
  createPlaylist,
  deletePlaylist,
  deleteUpload,
  getAlbum,
  getArtist,
  getCredits,
  getPlaylist,
  getPodcast,
  loadAll,
  removeFromPlaylist,
  sendFeedback,
} from './api/ytm';
import { player } from './player/player.svelte';
import { go } from './stores/router.svelte';
import { ui, type MenuAction } from './stores/ui.svelte';
import { library } from './stores/library.svelte';
import { auth } from './stores/auth.svelte';

export function artistRoute(id?: string | null) {
  return id ? `/artist/${id}` : null;
}

export function endpointRoute(m?: Endpoint): string | null {
  if (!m?.browseId) return null;
  const id = m.browseId;
  if (id === '__search__') {
    const [q, f] = (m.params ?? '').split('\u0000');
    return `/search?q=${encodeURIComponent(q)}&f=${f}`;
  }
  if (id.startsWith('VL')) return `/playlist/${id.slice(2)}`;
  if (id.startsWith('MPRE')) return `/album/${id}`;
  if (id.startsWith('MPSP')) return `/podcast/${id}`;
  if (id === 'FEmusic_moods_and_genres') return '/moods';
  if (id === 'FEmusic_charts') return '/charts';
  if (id === 'FEmusic_library_landing') return '/library';
  if (id === 'FEmusic_history') return '/history';
  if ((id.startsWith('UC') || id.startsWith('MPLA')) && !m.params) return `/artist/${id}`;
  return `/browse/${id}${m.params ? '?p=' + encodeURIComponent(m.params) : ''}`;
}

export function shareUrl(i: Item): string {
  if (i.kind === 'track') return `https://music.youtube.com/watch?v=${i.videoId}`;
  if (i.browseId?.startsWith('VL')) return `https://music.youtube.com/playlist?list=${i.browseId.slice(2)}`;
  if (i.type === 'artist' || i.type === 'profile') return `https://music.youtube.com/channel/${i.browseId}`;
  if (i.playlistId) return `https://music.youtube.com/playlist?list=${i.playlistId}`;
  if (i.videoId) return `https://music.youtube.com/watch?v=${i.videoId}`;
  return `https://music.youtube.com/browse/${i.browseId}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    ui.toast('Link copied to clipboard');
  } catch {
    ui.toast(text);
  }
}

export async function playCard(c: Card, shuffle = false) {
  try {
    const source = { title: c.title, path: cardRoute(c) ?? undefined };
    switch (c.type) {
      case 'song':
      case 'video':
      case 'episode':
        if (c.track) return player.playTrack(c.track, source);
        if (c.videoId) return player.playWatch({ videoId: c.videoId, playlistId: c.playlistId }, source);
        break;
      case 'album':
      case 'single':
      case 'ep': {
        if (c.playlistId) return player.playWatch({ playlistId: c.playlistId, shuffle }, source);
        const a = await getAlbum(c.browseId!);
        return player.playTracks(a.tracks, 0, source, { shuffle });
      }
      case 'playlist': {
        const id = c.browseId?.replace(/^VL/, '') ?? c.playlistId;
        if (!id) return;
        return playPlaylist(id, shuffle, source);
      }
      case 'station':
        return player.playWatch({ playlistId: c.playlistId, params: c.params, shuffle }, source);
      case 'artist':
      case 'profile': {
        const ep = shuffle ? c.menu?.shuffle ?? c.menu?.radio : c.menu?.radio ?? c.menu?.shuffle;
        if (ep?.playlistId) return player.playWatch({ playlistId: ep.playlistId, params: ep.params, shuffle }, source);
        const a = await getArtist(c.browseId!);
        const e2 = a.header.shuffle ?? a.header.radio;
        if (e2?.playlistId) return player.playWatch({ playlistId: e2.playlistId, params: e2.params }, source);
        return player.playTracks(a.topSongs, 0, source, { shuffle });
      }
      case 'podcast': {
        const p = await getPodcast(c.browseId!);
        return player.playTracks(p.tracks, 0, source, { shuffle });
      }
      default: {
        const r = cardRoute(c);
        if (r) go(r);
      }
    }
  } catch (e) {
    ui.error(e);
  }
}

/** Play a whole playlist (all pages are queued, shuffle covers everything). */
export async function playPlaylist(id: string, shuffle: boolean, source: { title: string; path?: string }) {
  try {
    const p = await getPlaylist(id);
    if (!p.tracks.length) return player.playWatch({ playlistId: id, shuffle }, source);
    player.playTracks(p.tracks, 0, source, { shuffle, more: p.more });
  } catch {
    // some auto-generated lists (mixes) can't be browsed: let YouTube Music build the queue
    return player.playWatch({ playlistId: id, shuffle }, source);
  }
}

export function openCard(c: Card) {
  if (c.type === 'station' || ((c.type === 'song' || c.type === 'video') && !c.browseId)) return playCard(c);
  const r = cardRoute(c);
  if (r) go(r);
}

/** Get all tracks behind a card (for "add to queue" etc). */
export async function cardTracks(c: Card): Promise<Track[]> {
  if (c.track) return [c.track];
  if (c.type === 'album' || c.type === 'single' || c.type === 'ep') return (await getAlbum(c.browseId!)).tracks;
  if (c.type === 'playlist') {
    const p = await getPlaylist(c.browseId ?? c.playlistId!);
    return loadAll({ items: p.tracks, continuation: p.more }, 1000);
  }
  if (c.type === 'podcast') return (await getPodcast(c.browseId!)).tracks;
  if (c.type === 'artist') return (await getArtist(c.browseId!)).topSongs;
  return [];
}

// ------------------------------------------------------------- playlists

export async function newPlaylistDialog(videoIds?: string[], sourcePlaylist?: string): Promise<string | null> {
  if (!auth.loggedIn) {
    ui.toast('Sign in to create playlists');
    return null;
  }
  const r = await ui.ask<Record<string, string>>({
    kind: 'prompt',
    title: 'Create playlist',
    confirmLabel: 'Create',
    fields: [
      { key: 'title', label: 'Name', value: '' },
      { key: 'description', label: 'Description', value: '', multiline: true },
      { key: 'privacy', label: 'Privacy', value: 'PRIVATE', options: ['PRIVATE', 'UNLISTED', 'PUBLIC'] },
    ],
  });
  if (!r?.title?.trim()) return null;
  try {
    const id = await createPlaylist(r.title.trim(), r.description, r.privacy, videoIds, sourcePlaylist);
    ui.toast(`Created "${r.title}"`);
    library.refresh();
    return id;
  } catch (e) {
    ui.error(e);
    return null;
  }
}

export async function addTracksToPlaylist(playlistId: string, title: string, videoIds: string[], sourcePlaylist?: string) {
  try {
    let res = await addToPlaylist(playlistId, videoIds, false, sourcePlaylist);
    if (res === 'duplicate') {
      const ok = await ui.ask<boolean>({ kind: 'confirm', title: 'Already added', message: `This is already in "${title}". Add it anyway?`, confirmLabel: 'Add anyway' });
      if (!ok) return;
      res = await addToPlaylist(playlistId, videoIds, true, sourcePlaylist);
    }
    ui.toast(`Added to ${title}`);
  } catch (e) {
    ui.error(e);
  }
}

function playlistSubmenu(getIds: () => Promise<{ videoIds: string[]; source?: string }>): () => MenuAction[] {
  return () => {
    const items: MenuAction[] = [
      {
        label: 'New playlist',
        icon: 'plus',
        run: async () => {
          const { videoIds, source } = await getIds();
          newPlaylistDialog(videoIds, source);
        },
      },
      { label: '', divider: true },
    ];
    if (!library.owned.length) items.push({ label: auth.loggedIn ? 'No playlists yet' : 'Sign in to use playlists', disabled: true });
    for (const p of library.owned) {
      items.push({
        label: p.title,
        run: async () => {
          const { videoIds, source } = await getIds();
          addTracksToPlaylist(p.browseId!.replace(/^VL/, ''), p.title, videoIds, source);
        },
      });
    }
    return items;
  };
}

// ------------------------------------------------------------- menus

export interface TrackMenuContext {
  /** owned playlist the track is listed in */
  playlistId?: string;
  onRemoved?: () => void;
  queueIndex?: number;
}

export function trackMenu(t: Track, ctx: TrackMenuContext = {}): MenuAction[] {
  const like = library.likeOf(t);
  const a: MenuAction[] = [
    { label: 'Add to playlist', icon: 'plus', submenu: playlistSubmenu(async () => ({ videoIds: [t.videoId] })) },
  ];
  if (ctx.playlistId && t.menu?.setVideoId) {
    a.push({
      label: 'Remove from this playlist',
      icon: 'trash',
      run: async () => {
        try {
          await removeFromPlaylist(ctx.playlistId!, [{ videoId: t.videoId, setVideoId: t.menu!.setVideoId! }]);
          ui.toast('Removed from playlist');
          ctx.onRemoved?.();
        } catch (e) {
          ui.error(e);
        }
      },
    });
  }
  a.push(
    { label: like === 'LIKE' ? 'Remove from Liked Music' : 'Save to Liked Music', icon: like === 'LIKE' ? 'heartFill' : 'heart', run: () => library.toggleLike(t) },
    { label: like === 'DISLIKE' ? 'Remove dislike' : 'Dislike', icon: 'dislike', run: () => library.rate(t, like === 'DISLIKE' ? 'INDIFFERENT' : 'DISLIKE') },
  );
  if (t.menu?.libraryAdd || t.menu?.libraryRemove) {
    const inLib = library.inLibrary(t);
    a.push({ label: inLib ? 'Remove from library' : 'Save to library', icon: 'library', run: () => library.setInLibrary(t, !inLib) });
  }
  a.push({ label: '', divider: true });
  if (ctx.queueIndex != null) {
    a.push({ label: 'Remove from queue', icon: 'close', run: () => player.removeAt(ctx.queueIndex!) });
  } else {
    a.push(
      { label: 'Play next', icon: 'queue', run: () => player.playNext([t]) },
      { label: 'Add to queue', icon: 'queue', run: () => player.addToQueue([t]) },
    );
  }
  a.push({ label: 'Start radio', icon: 'radio', run: () => player.startRadio({ videoId: t.videoId, title: t.title }) });
  if (t.type === 'episode' && auth.loggedIn) {
    a.push({ label: 'Save episode for later', icon: 'clock', run: () => addTracksToPlaylist('SE', 'Episodes for later', [t.videoId]) });
  }
  a.push({ label: '', divider: true });
  const artistId = t.artists.find((x) => x.id)?.id ?? t.menu?.artistId;
  if (artistId) a.push({ label: t.type === 'episode' ? 'Go to podcast' : 'Go to artist', icon: 'artist', run: () => go(t.type === 'episode' && artistId.startsWith('MPSP') ? `/podcast/${artistId}` : `/artist/${artistId}`) });
  const albumId = t.album?.id ?? t.menu?.albumId;
  if (albumId) a.push({ label: 'Go to album', icon: 'album', run: () => go(`/album/${albumId}`) });
  if (t.browseId?.startsWith('MPED')) a.push({ label: 'Go to episode', icon: 'podcast', run: () => go(`/episode/${t.browseId}`) });
  if (t.menu?.creditsId) a.push({ label: 'View song credits', icon: 'info', run: () => showCredits(t.menu!.creditsId!, t.title) });
  if (t.menu?.pinToken || t.menu?.unpinToken) {
    const pinned = !!t.menu.pinned;
    a.push({
      label: pinned ? 'Unpin from Listen again' : 'Pin to Listen again',
      icon: 'pin',
      run: () => sendFeedback([pinned ? t.menu!.unpinToken! : t.menu!.pinToken!]).then(() => ui.toast(pinned ? 'Unpinned' : 'Pinned to Listen again'), ui.error.bind(ui)),
    });
  }
  if (t.menu?.removeHistoryToken) {
    a.push({
      label: 'Remove from history',
      icon: 'trash',
      run: () => sendFeedback([t.menu!.removeHistoryToken!]).then(() => { ui.toast('Removed from history'); ctx.onRemoved?.(); }, ui.error.bind(ui)),
    });
  }
  if (t.menu?.uploadEntityId) {
    a.push({
      label: 'Delete upload',
      icon: 'trash',
      danger: true,
      run: async () => {
        const ok = await ui.ask<boolean>({ kind: 'confirm', title: 'Delete upload', message: `Permanently delete "${t.title}" from your uploads?`, confirmLabel: 'Delete' });
        if (!ok) return;
        deleteUpload(t.menu!.uploadEntityId!).then(() => { ui.toast('Upload deleted'); ctx.onRemoved?.(); }, ui.error.bind(ui));
      },
    });
  }
  a.push({ label: 'Copy song link', icon: 'share', run: () => copy(shareUrl(t)) });
  return a;
}

export function cardMenu(c: Card, opts: { onRemoved?: () => void } = {}): MenuAction[] {
  const a: MenuAction[] = [];
  const playable = c.type !== 'mood';
  if (playable) {
    a.push({ label: 'Play', icon: 'play', run: () => playCard(c) });
    if (['album', 'single', 'ep', 'playlist', 'artist', 'profile', 'podcast'].includes(c.type)) a.push({ label: 'Shuffle play', icon: 'shuffle', run: () => playCard(c, true) });
    if (c.menu?.radio) a.push({ label: 'Start radio', icon: 'radio', run: () => player.playWatch({ playlistId: c.menu!.radio!.playlistId, params: c.menu!.radio!.params }, { title: `${c.title} Radio` }) });
    else if (c.track) a.push({ label: 'Start radio', icon: 'radio', run: () => player.startRadio({ videoId: c.track!.videoId, title: c.title }) });
    a.push(
      { label: 'Play next', icon: 'queue', run: async () => player.playNext(await cardTracks(c)) },
      { label: 'Add to queue', icon: 'queue', run: async () => player.addToQueue(await cardTracks(c)) },
      { label: '', divider: true },
    );
  }
  if (c.track) {
    a.push({ label: 'Add to playlist', icon: 'plus', submenu: playlistSubmenu(async () => ({ videoIds: [c.track!.videoId] })) });
  } else if (['album', 'single', 'ep', 'playlist'].includes(c.type)) {
    a.push({
      label: 'Add to playlist',
      icon: 'plus',
      submenu: playlistSubmenu(async () => {
        if (c.playlistId) return { videoIds: [], source: c.playlistId };
        return { videoIds: (await cardTracks(c)).map((t) => t.videoId) };
      }),
    });
  }
  const pid = c.type === 'playlist' ? c.browseId?.replace(/^VL/, '') : c.playlistId;
  if (pid && ['album', 'single', 'ep', 'playlist'].includes(c.type) && pid !== 'LM' && pid !== 'SE') {
    const owned = c.menu?.editablePlaylistId === pid;
    if (owned) {
      a.push({
        label: 'Delete playlist',
        icon: 'trash',
        danger: true,
        run: async () => {
          const ok = await ui.ask<boolean>({ kind: 'confirm', title: 'Delete playlist', message: `Delete "${c.title}"? This can't be undone.`, confirmLabel: 'Delete' });
          if (!ok) return;
          try {
            await deletePlaylist(pid);
            ui.toast('Playlist deleted');
            library.refresh();
            opts.onRemoved?.();
          } catch (e) {
            ui.error(e);
          }
        },
      });
    } else {
      const saved = library.isSaved(pid, c.menu?.inLibrary ?? library.playlists.some((p) => p.browseId === c.browseId));
      a.push({ label: saved ? 'Remove from Your Library' : 'Save to Your Library', icon: saved ? 'checkCircle' : 'addCircle', run: () => library.setSaved(pid, !saved) });
    }
  }
  if ((c.type === 'artist' || c.type === 'profile') && c.browseId?.startsWith('UC')) {
    const sub = library.isSubscribed(c.browseId);
    a.push({ label: sub ? 'Unsubscribe' : 'Subscribe', icon: 'user', run: () => library.setSubscribed(c.browseId!, !sub) });
  }
  const artist = c.artists?.find((x) => x.id);
  if (artist && c.type !== 'artist') a.push({ label: 'Go to artist', icon: 'artist', run: () => go(`/artist/${artist.id}`) });
  if (c.menu?.uploadEntityId) {
    a.push({
      label: 'Delete upload',
      icon: 'trash',
      danger: true,
      run: () => deleteUpload(c.menu!.uploadEntityId!).then(() => { ui.toast('Upload deleted'); opts.onRemoved?.(); }, ui.error.bind(ui)),
    });
  }
  if (c.type !== 'mood') a.push({ label: 'Copy link', icon: 'share', run: () => copy(shareUrl(c)) });
  return a;
}

export async function showCredits(id: string, title: string) {
  try {
    const credits = await getCredits(id);
    await ui.ask({ kind: 'credits', title: `Credits · ${title}`, data: credits });
  } catch (e) {
    ui.error(e);
  }
}

export function itemMenu(i: Item, e: MouseEvent, ctx?: TrackMenuContext) {
  ui.openMenu(e, i.kind === 'track' ? trackMenu(i, ctx) : cardMenu(i));
}

/** Avatar / account menu (shared by both themes). */
export function openAccountMenu(e: MouseEvent) {
  const actions: MenuAction[] = [];
  if (auth.loggedIn) {
    actions.push({ label: auth.account?.name ?? 'Account', icon: 'user', disabled: true });
    actions.push({
      label: 'Switch account',
      icon: 'user',
      submenu: async () => {
        await auth.loadAccounts();
        if (!auth.accounts.length) return [{ label: 'No other accounts', disabled: true }];
        return auth.accounts.map((a) => ({ label: (a.selected ? '✓ ' : '') + a.name + (a.handle ? ` (${a.handle})` : ''), run: () => auth.switchAccount(a) }));
      },
    });
    actions.push({ label: '', divider: true });
  }
  actions.push({ label: 'Settings', icon: 'settings', run: () => go('/settings') });
  actions.push({ label: 'Listening history', icon: 'history', run: () => go('/history') });
  actions.push({ label: '', divider: true });
  if (auth.loggedIn) actions.push({ label: 'Log out', icon: 'logout', run: () => auth.logout() });
  else actions.push({ label: 'Sign in with Google', icon: 'user', run: () => auth.login() });
  ui.openMenu(e, actions);
}
