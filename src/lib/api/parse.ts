// Generic parsers for YouTube Music InnerTube renderers.
// Modelled after ytmusicapi's parsers but normalised into a small set of
// shapes (Track / Card / Shelf) the UI can render anywhere.
import type {
  Card,
  Chip,
  Endpoint,
  Item,
  ItemType,
  LikeStatus,
  MenuInfo,
  PageHeader,
  Ref,
  Shelf,
  Thumb,
  Track,
} from './types';

export type Path = (string | number)[];

/** Safe nested access. Negative indexes count from the end. */
export function nav(root: any, ...path: Path): any {
  let cur = root;
  for (const k of path) {
    if (cur == null) return undefined;
    if (typeof k === 'number' && Array.isArray(cur)) cur = cur[k < 0 ? cur.length + k : k];
    else cur = cur[k];
  }
  return cur;
}

export const PAGE_TYPE: Path = ['browseEndpointContextSupportedConfigs', 'browseEndpointContextMusicConfig', 'pageType'];
const VIDEO_TYPE: Path = ['watchEndpointMusicSupportedConfigs', 'watchEndpointMusicConfig', 'musicVideoType'];
const PLAY_BUTTON: Path = ['overlay', 'musicItemThumbnailOverlayRenderer', 'content', 'musicPlayButtonRenderer'];
const TWO_ROW_PLAY: Path = ['thumbnailOverlay', 'musicItemThumbnailOverlayRenderer', 'content', 'musicPlayButtonRenderer'];
const SEP = { text: ' • ' };

export function text(o: any): string {
  if (o == null) return '';
  if (typeof o === 'string') return o;
  if (o.simpleText != null) return o.simpleText;
  if (Array.isArray(o.runs)) return o.runs.map((r: any) => r.text ?? '').join('');
  if (typeof o.content === 'string') return o.content;
  return '';
}

export function thumbs(o: any): Thumb[] {
  const t =
    nav(o, 'thumbnail', 'musicThumbnailRenderer', 'thumbnail', 'thumbnails') ??
    nav(o, 'thumbnailRenderer', 'musicThumbnailRenderer', 'thumbnail', 'thumbnails') ??
    nav(o, 'thumbnail', 'croppedSquareThumbnailRenderer', 'thumbnail', 'thumbnails') ??
    nav(o, 'thumbnailRenderer', 'croppedSquareThumbnailRenderer', 'thumbnail', 'thumbnails') ??
    nav(o, 'thumbnail', 'thumbnails') ??
    nav(o, 'thumbnails') ??
    nav(o, 'foregroundThumbnail', 'musicThumbnailRenderer', 'thumbnail', 'thumbnails');
  return Array.isArray(t) ? t : [];
}

export function pageType(endpoint: any): string | undefined {
  return nav(endpoint, 'browseEndpoint', ...PAGE_TYPE);
}

export function browseOf(endpoint: any): Endpoint | undefined {
  const b = endpoint?.browseEndpoint;
  if (!b?.browseId) return undefined;
  return { browseId: b.browseId, params: b.params };
}

function typeFromPage(pt: string | undefined, browseId?: string): ItemType {
  switch (pt) {
    case 'MUSIC_PAGE_TYPE_ALBUM':
    case 'MUSIC_PAGE_TYPE_AUDIOBOOK':
      return 'album';
    case 'MUSIC_PAGE_TYPE_ARTIST':
    case 'MUSIC_PAGE_TYPE_LIBRARY_ARTIST':
      return 'artist';
    case 'MUSIC_PAGE_TYPE_PLAYLIST':
      return 'playlist';
    case 'MUSIC_PAGE_TYPE_USER_CHANNEL':
      return 'profile';
    case 'MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE':
      return 'podcast';
    case 'MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE':
      return 'episode';
  }
  if (!browseId) return 'unknown';
  if (browseId.startsWith('MPRE') || browseId.includes('release_detail')) return 'album';
  if (browseId.startsWith('VL') || browseId.startsWith('RD')) return 'playlist';
  if (browseId.startsWith('UC') || browseId.startsWith('MPLA') || browseId.includes('_artist_detail')) return 'artist';
  if (browseId.startsWith('MPSP')) return 'podcast';
  if (browseId.startsWith('MPED')) return 'episode';
  return 'unknown';
}

export function videoTypeToType(vt?: string): 'song' | 'video' | 'episode' {
  if (vt === 'MUSIC_VIDEO_TYPE_ATV' || vt === 'MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK') return 'song';
  if (vt === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE') return 'episode';
  return vt ? 'video' : 'song';
}

export function parseDuration(d?: string | null): number | undefined {
  if (!d || !d.trim()) return undefined;
  const parts = d.trim().split(':');
  if (!parts.every((p) => /^\d+$/.test(p))) return undefined;
  return parts.reverse().reduce((acc, p, i) => acc + parseInt(p, 10) * [1, 60, 3600][i], 0);
}

export function fmtTime(sec?: number): string {
  if (sec == null || !isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

const VIEWS_RE = /^[\d.,\s]+[KMBkmb]?\s*(views?|plays?|listeners?|subscribers?|watching)/i;

export interface SongRunInfo {
  artists: Ref[];
  album?: Ref;
  views?: string;
  duration?: string;
  durationSec?: number;
  year?: string;
}

/** Parses "Artist • Album • 1.2M views • 3:21" style runs. */
export function parseSongRuns(runs: any[] = [], skipTypeSpec = false): SongRunInfo {
  const out: SongRunInfo = { artists: [] };
  if (
    skipTypeSpec &&
    runs.length > 2 &&
    !runs[0].navigationEndpoint &&
    runs[1]?.text === SEP.text &&
    !/^\d/.test(runs[0].text)
  ) {
    runs = runs.slice(2);
  }
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const t: string = run.text ?? '';
    if (i % 2 === 1) {
      // separators; but some payloads have odd-indexed artists (", " joins) - skip pure separators only
      if (/^\s*(•|&|,|and|x|·)\s*$/i.test(t) || t.trim() === '') continue;
    }
    if (run.navigationEndpoint) {
      const id: string | undefined = nav(run, 'navigationEndpoint', 'browseEndpoint', 'browseId');
      const pt = pageType(run.navigationEndpoint);
      if (id && (id.startsWith('MPRE') || id.includes('release_detail') || pt === 'MUSIC_PAGE_TYPE_ALBUM')) {
        out.album = { id, name: t };
      } else if (run.navigationEndpoint.watchEndpoint) {
        // title-like run, ignore
      } else {
        out.artists.push({ id: id ?? null, name: t });
      }
      continue;
    }
    if (/^(\d+:)*\d+:\d+$/.test(t)) {
      out.duration = t;
      out.durationSec = parseDuration(t);
    } else if (/^\d{4}$/.test(t)) {
      out.year = t;
    } else if (VIEWS_RE.test(t)) {
      out.views = t;
    } else if (t.trim() && t.trim() !== '•') {
      out.artists.push({ id: null, name: t });
    }
  }
  return out;
}

function likeFromToggleEndpoint(status?: string): LikeStatus | null {
  // the default action of the toggle tells us the *current* state
  if (status === 'LIKE') return 'INDIFFERENT';
  if (status === 'INDIFFERENT') return 'LIKE';
  return null;
}

export function parseMenu(menuRenderer: any): MenuInfo {
  const m: MenuInfo = {};
  if (!menuRenderer) return m;
  for (const btn of menuRenderer.topLevelButtons ?? []) {
    if (btn.likeButtonRenderer?.likeStatus) m.likeStatus = btn.likeButtonRenderer.likeStatus;
  }
  for (const item of menuRenderer.items ?? []) {
    const nv = item.menuNavigationItemRenderer;
    if (nv) {
      const icon = nav(nv, 'icon', 'iconType');
      const ep = nv.navigationEndpoint ?? {};
      const wpe = ep.watchPlaylistEndpoint ?? ep.watchEndpoint;
      if (wpe?.playlistId && (icon === 'MIX' || icon === 'RADIO')) m.radio = { playlistId: wpe.playlistId, params: wpe.params, videoId: wpe.videoId };
      else if (wpe?.playlistId && icon === 'MUSIC_SHUFFLE') m.shuffle = { playlistId: wpe.playlistId, params: wpe.params };
      if (ep.browseEndpoint) {
        const id: string = ep.browseEndpoint.browseId;
        const pt = pageType(ep);
        if (id?.startsWith('MPTC')) m.creditsId = id;
        else if (pt === 'MUSIC_PAGE_TYPE_ARTIST' || pt === 'MUSIC_PAGE_TYPE_USER_CHANNEL') m.artistId ??= id;
        else if (pt === 'MUSIC_PAGE_TYPE_ALBUM') m.albumId ??= id;
      }
      if (ep.playlistEditorEndpoint?.playlistId) m.editablePlaylistId = ep.playlistEditorEndpoint.playlistId;
      const del = nav(ep, 'confirmDialogEndpoint', 'content', 'confirmDialogRenderer', 'confirmButton', 'buttonRenderer', 'command', 'musicDeletePrivatelyOwnedEntityCommand', 'entityId');
      if (del) m.uploadEntityId = del;
      continue;
    }
    const sv = item.menuServiceItemRenderer;
    if (sv) {
      const se = sv.serviceEndpoint ?? {};
      const icon = nav(sv, 'icon', 'iconType');
      if (se.playlistEditEndpoint) {
        const a = nav(se, 'playlistEditEndpoint', 'actions', 0);
        if (a?.setVideoId) m.setVideoId = a.setVideoId;
        if (a?.removedVideoId) m.removedVideoId = a.removedVideoId;
      }
      if (se.feedbackEndpoint && icon === 'REMOVE_FROM_HISTORY') m.removeHistoryToken = se.feedbackEndpoint.feedbackToken;
      if (se.queueAddEndpoint && !m.removedVideoId) {
        // nothing extra
      }
      continue;
    }
    const tg = item.toggleMenuServiceItemRenderer;
    if (tg) {
      const icon = nav(tg, 'defaultIcon', 'iconType');
      const def = nav(tg, 'defaultServiceEndpoint', 'feedbackEndpoint', 'feedbackToken');
      const tog = nav(tg, 'toggledServiceEndpoint', 'feedbackEndpoint', 'feedbackToken');
      const toggled = !!tg.isToggled;
      switch (icon) {
        case 'BOOKMARK_BORDER':
        case 'LIBRARY_ADD':
          m.inLibrary = toggled;
          m.libraryAdd = toggled ? tog : def;
          m.libraryRemove = toggled ? def : tog;
          if (toggled) [m.libraryAdd, m.libraryRemove] = [tog, def];
          else [m.libraryAdd, m.libraryRemove] = [def, tog];
          break;
        case 'BOOKMARK':
        case 'LIBRARY_SAVED':
        case 'LIBRARY_REMOVE':
          m.inLibrary = !toggled;
          [m.libraryAdd, m.libraryRemove] = toggled ? [def, tog] : [tog, def];
          break;
        case 'KEEP':
          m.pinned = toggled;
          [m.pinToken, m.unpinToken] = toggled ? [tog, def] : [def, tog];
          break;
        case 'KEEP_OFF':
          m.pinned = !toggled;
          [m.pinToken, m.unpinToken] = toggled ? [def, tog] : [tog, def];
          break;
        default: {
          const like = nav(tg, 'defaultServiceEndpoint', 'likeEndpoint', 'status');
          if (like && m.likeStatus == null) m.likeStatus = likeFromToggleEndpoint(like);
        }
      }
    }
  }
  return m;
}

function isExplicit(o: any): boolean {
  const badges = [...(o?.badges ?? []), ...(o?.subtitleBadges ?? [])];
  return badges.some((b: any) => nav(b, 'musicInlineBadgeRenderer', 'icon', 'iconType') === 'MUSIC_EXPLICIT_BADGE');
}

function flexCols(d: any): any[] {
  return (d.flexColumns ?? []).map((c: any) => c.musicResponsiveListItemFlexColumnRenderer?.text);
}

function fixedDuration(d: any): string | undefined {
  const fc = nav(d, 'fixedColumns', 0, 'musicResponsiveListItemFixedColumnRenderer', 'text');
  const t = text(fc);
  return t && /\d+:\d+/.test(t) ? t : undefined;
}

function chartInfo(d: any): { rank?: string; trend?: Track['trend'] } {
  const c = d.customIndexColumn?.musicCustomIndexColumnRenderer;
  if (!c) return {};
  const icon = nav(c, 'icon', 'iconType');
  return {
    rank: text(c.text) || undefined,
    trend: icon === 'ARROW_DROP_UP' ? 'up' : icon === 'ARROW_DROP_DOWN' ? 'down' : icon ? 'neutral' : undefined,
  };
}

/** musicResponsiveListItemRenderer → Track (playable row) or Card (entity row). */
export function parseResponsive(d: any): Item | null {
  const cols = flexCols(d);
  const titleRun = nav(cols[0], 'runs', 0);
  const title = text(cols[0]);
  const rowEp = d.navigationEndpoint;
  const rowBrowse = browseOf(rowEp);
  const pt = pageType(rowEp);
  const play = nav(d, ...PLAY_BUTTON, 'playNavigationEndpoint');
  const menu = parseMenu(d.menu?.menuRenderer);
  const th = thumbs(d);

  const titleWatch = nav(titleRun, 'navigationEndpoint', 'watchEndpoint');
  const videoId: string | undefined =
    titleWatch?.videoId ?? play?.watchEndpoint?.videoId ?? d.playlistItemData?.videoId ?? menu.removedVideoId;

  if (rowBrowse && pt !== 'MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE') {
    const type = typeFromPage(pt, rowBrowse.browseId);
    const subRuns: any[] = [];
    for (let i = 1; i < cols.length; i++) {
      if (cols[i]?.runs?.length) {
        if (subRuns.length) subRuns.push(SEP);
        subRuns.push(...cols[i].runs);
      }
    }
    const info = parseSongRuns(subRuns, true);
    let ctype = type;
    const first = (subRuns[0]?.text ?? '').toLowerCase();
    if (type === 'album' && (first === 'single' || first === 'ep')) ctype = first as ItemType;
    const card: Card = {
      kind: 'card',
      type: ctype,
      title,
      subtitle: subRuns.map((r) => r.text).join(''),
      thumbnails: th,
      browseId: rowBrowse.browseId,
      params: rowBrowse.params,
      playlistId: play?.watchPlaylistEndpoint?.playlistId ?? play?.watchEndpoint?.playlistId,
      artists: info.artists.filter((a) => a.id),
      explicit: isExplicit(d),
      year: info.year,
      menu,
      rank: chartInfo(d).rank,
    };
    return card;
  }

  // watch-playlist rows (stations) without videoId
  if (!videoId) {
    const wpl = play?.watchPlaylistEndpoint ?? nav(titleRun, 'navigationEndpoint', 'watchPlaylistEndpoint');
    if (wpl?.playlistId) {
      return {
        kind: 'card',
        type: 'station',
        title,
        subtitle: cols.slice(1).map(text).join(' • '),
        thumbnails: th,
        playlistId: wpl.playlistId,
        params: wpl.params,
        menu,
      };
    }
    // unavailable / deleted rows with no id are dropped
    if (!title) return null;
  }

  const vt: string | undefined = play ? nav(play, 'watchEndpoint', ...VIDEO_TYPE) : nav(titleWatch, ...VIDEO_TYPE);
  const isEpisode = vt === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE' || nav(titleRun, 'navigationEndpoint', 'browseEndpoint') != null;

  const runs: any[] = [];
  for (let i = 1; i < cols.length; i++) {
    const r = cols[i]?.runs;
    if (r?.length) {
      if (runs.length) runs.push(SEP);
      runs.push(...r);
    }
  }
  let info: SongRunInfo;
  if (isEpisode) {
    // "date • podcast" or "podcast"
    const named = runs.filter((r) => r.navigationEndpoint);
    info = { artists: named.map((r) => ({ id: nav(r, 'navigationEndpoint', 'browseEndpoint', 'browseId'), name: r.text })) };
  } else {
    info = parseSongRuns(runs, true);
  }
  if (!info.album && menu.albumId) {
    // album present in menu but not in columns
  }
  if (info.artists.length && menu.artistId && !info.artists[0].id) info.artists[0].id = menu.artistId;

  const duration = fixedDuration(d) ?? info.duration;
  const greyed = d.musicItemRendererDisplayPolicy === 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT';
  const idx = text(d.index);
  const track: Track = {
    kind: 'track',
    videoId: videoId ?? '',
    title,
    artists: info.artists,
    album: info.album ?? null,
    duration,
    durationSec: parseDuration(duration),
    thumbnails: th,
    explicit: isExplicit(d),
    videoType: vt,
    type: isEpisode ? 'episode' : videoTypeToType(vt),
    likeStatus: menu.likeStatus ?? null,
    views: info.views,
    year: info.year,
    playlistId: play?.watchEndpoint?.playlistId,
    isAvailable: !greyed && !!videoId,
    trackNumber: /^\d+$/.test(idx) ? parseInt(idx, 10) : undefined,
    browseId: nav(titleRun, 'navigationEndpoint', 'browseEndpoint', 'browseId'),
    menu,
    ...chartInfo(d),
  };
  return track;
}

/** musicTwoRowItemRenderer → Card */
export function parseTwoRow(d: any): Card | null {
  const titleRun = nav(d, 'title', 'runs', 0);
  const ep = d.navigationEndpoint ?? titleRun?.navigationEndpoint;
  const browse = browseOf(ep);
  const pt = pageType(ep);
  const subRuns: any[] = nav(d, 'subtitle', 'runs') ?? [];
  const play = nav(d, ...TWO_ROW_PLAY, 'playNavigationEndpoint');
  const menu = parseMenu(d.menu?.menuRenderer);
  const th = thumbs(d);
  const title = text(d.title);
  const artists = subRuns
    .filter((r) => r.navigationEndpoint?.browseEndpoint)
    .map((r) => ({ id: r.navigationEndpoint.browseEndpoint.browseId, name: r.text }));
  const year = subRuns.map((r) => r.text).find((t: string) => /^\d{4}$/.test(t));
  const wide = String(d.aspectRatio ?? '').includes('16_9');

  if (browse) {
    let type = typeFromPage(pt, browse.browseId);
    const first = (subRuns[0]?.text ?? '').toLowerCase();
    if (type === 'album' && (first === 'single' || first === 'ep')) type = first as ItemType;
    return {
      kind: 'card',
      type,
      title,
      subtitle: text(d.subtitle),
      thumbnails: th,
      browseId: browse.browseId,
      params: browse.params,
      playlistId: play?.watchPlaylistEndpoint?.playlistId ?? play?.watchEndpoint?.playlistId,
      artists,
      explicit: isExplicit(d),
      year,
      wide,
      menu,
    };
  }
  const watch = ep?.watchEndpoint;
  if (watch?.videoId) {
    const vt = nav(watch, ...VIDEO_TYPE);
    const info = parseSongRuns(subRuns, true);
    const track: Track = {
      kind: 'track',
      videoId: watch.videoId,
      title,
      artists: info.artists,
      album: info.album ?? null,
      thumbnails: th,
      explicit: isExplicit(d),
      videoType: vt,
      type: videoTypeToType(vt),
      views: info.views,
      playlistId: watch.playlistId,
      isAvailable: true,
      likeStatus: menu.likeStatus ?? null,
      menu,
    };
    return {
      kind: 'card',
      type: track.type === 'episode' ? 'episode' : track.type,
      title,
      subtitle: text(d.subtitle),
      thumbnails: th,
      videoId: watch.videoId,
      playlistId: watch.playlistId,
      artists,
      wide: wide || track.type === 'video',
      track,
      menu,
    };
  }
  const wpl = ep?.watchPlaylistEndpoint;
  if (wpl?.playlistId) {
    return {
      kind: 'card',
      type: 'station',
      title,
      subtitle: text(d.subtitle),
      thumbnails: th,
      playlistId: wpl.playlistId,
      params: wpl.params,
      menu,
    };
  }
  return null;
}

/** musicMultiRowListItemRenderer (podcast episode) → Track */
export function parseMultiRow(d: any): Track | null {
  const videoId = nav(d, 'onTap', 'watchEndpoint', 'videoId') ?? nav(d, 'playbackProgress', 'videoId');
  if (!videoId) return null;
  const titleRun = nav(d, 'title', 'runs', 0);
  const dur = text(nav(d, 'playbackProgress', 'musicPlaybackProgressRenderer', 'durationText'));
  const durClean = dur.replace(/^.*?(\d[\d:]*)\s*(min|sec|hr)?.*$/i, '$1');
  const podcastRun = nav(d, 'secondTitle', 'runs', 0);
  return {
    kind: 'track',
    videoId,
    title: text(d.title),
    artists: podcastRun ? [{ id: nav(podcastRun, 'navigationEndpoint', 'browseEndpoint', 'browseId'), name: podcastRun.text }] : [],
    thumbnails: thumbs(d),
    type: 'episode',
    videoType: nav(d, 'onTap', 'watchEndpoint', ...VIDEO_TYPE),
    browseId: nav(titleRun, 'navigationEndpoint', 'browseEndpoint', 'browseId'),
    year: text(d.subtitle) || undefined,
    duration: dur || undefined,
    durationSec: parseDuration(durClean),
    description: text(d.description),
    isAvailable: true,
    menu: parseMenu(d.menu?.menuRenderer),
  };
}

function argbToCss(n?: number): string | undefined {
  if (n == null) return undefined;
  const v = n >>> 0;
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return `rgb(${r},${g},${b})`;
}

export function parseNavButton(d: any): Card | null {
  const b = nav(d, 'clickCommand', 'browseEndpoint');
  if (!b) return null;
  return {
    kind: 'card',
    type: 'mood',
    title: text(d.buttonText),
    subtitle: '',
    thumbnails: [],
    browseId: b.browseId,
    params: b.params,
    color: argbToCss(nav(d, 'solid', 'leftStripeColor')),
  };
}

/** playlistPanelVideoRenderer (watch queue) → Track */
export function parsePanelVideo(d: any): Track | null {
  if (!d?.videoId) return null;
  const menu = parseMenu(d.menu?.menuRenderer);
  const by = parseSongRuns(nav(d, 'longBylineText', 'runs') ?? []);
  const vt = nav(d, 'navigationEndpoint', 'watchEndpoint', ...VIDEO_TYPE);
  const dur = text(d.lengthText);
  return {
    kind: 'track',
    videoId: d.videoId,
    title: text(d.title),
    artists: by.artists,
    album: by.album ?? null,
    year: by.year,
    views: by.views,
    duration: dur || undefined,
    durationSec: parseDuration(dur),
    thumbnails: nav(d, 'thumbnail', 'thumbnails') ?? [],
    explicit: isExplicit(d),
    videoType: vt,
    type: videoTypeToType(vt),
    likeStatus: menu.likeStatus ?? null,
    playlistId: nav(d, 'navigationEndpoint', 'watchEndpoint', 'playlistId'),
    isAvailable: !d.unplayableText,
    menu,
  };
}

export function parseQueueItem(o: any): Track | null {
  const w = o.playlistPanelVideoWrapperRenderer;
  if (w) {
    const t = parsePanelVideo(nav(w, 'primaryRenderer', 'playlistPanelVideoRenderer'));
    const c = parsePanelVideo(nav(w, 'counterpart', 0, 'counterpartRenderer', 'playlistPanelVideoRenderer'));
    if (t && c) t.counterpart = c;
    return t;
  }
  return parsePanelVideo(o.playlistPanelVideoRenderer);
}

/** Dispatch on renderer key. */
export function parseItem(o: any): Item | null {
  if (!o) return null;
  if (o.musicResponsiveListItemRenderer) return parseResponsive(o.musicResponsiveListItemRenderer);
  if (o.musicTwoRowItemRenderer) return parseTwoRow(o.musicTwoRowItemRenderer);
  if (o.musicMultiRowListItemRenderer) return parseMultiRow(o.musicMultiRowListItemRenderer);
  if (o.musicNavigationButtonRenderer) return parseNavButton(o.musicNavigationButtonRenderer);
  if (o.playlistPanelVideoRenderer || o.playlistPanelVideoWrapperRenderer) return parseQueueItem(o);
  return null;
}

export function parseItems(list: any[] = []): Item[] {
  const out: Item[] = [];
  for (const o of list) {
    const it = parseItem(o);
    if (it) out.push(it);
  }
  return out;
}

export function tracksOnly(items: Item[]): Track[] {
  return items.filter((i): i is Track => i.kind === 'track');
}

function layoutFor(items: Item[], fallback: Shelf['layout']): Shelf['layout'] {
  if (items.length && items.every((i) => i.kind === 'track' && !(i as any).fromCard)) return 'tracks';
  return fallback;
}

/** "More" endpoint of carousel headers. */
function carouselMore(h: any): Endpoint | undefined {
  return (
    browseOf(nav(h, 'moreContentButton', 'buttonRenderer', 'navigationEndpoint')) ??
    browseOf(nav(h, 'title', 'runs', 0, 'navigationEndpoint'))
  );
}

export function parseShelf(section: any): Shelf | null {
  if (!section) return null;
  let r: any;
  if ((r = section.musicCarouselShelfRenderer)) {
    const h = nav(r, 'header', 'musicCarouselShelfBasicHeaderRenderer');
    const items = parseItems(r.contents);
    return {
      title: text(h?.title) || text(h?.strapline),
      strapline: h?.title ? text(h?.strapline) || undefined : undefined,
      more: carouselMore(h),
      items,
      thumbnails: thumbs(h),
      layout: layoutFor(items, 'cards'),
    };
  }
  if ((r = section.musicImmersiveCarouselShelfRenderer)) {
    const h = nav(r, 'header', 'musicCarouselShelfBasicHeaderRenderer');
    const items = parseItems(r.contents);
    return { title: text(h?.title), more: carouselMore(h), items, layout: layoutFor(items, 'cards') };
  }
  if ((r = section.musicShelfRenderer)) {
    const items = parseItems(r.contents);
    const more = browseOf(nav(r, 'bottomEndpoint')) ?? browseOf(nav(r, 'title', 'runs', 0, 'navigationEndpoint'));
    return { title: text(r.title), more, items, layout: layoutFor(items, 'tracks') };
  }
  if ((r = section.musicPlaylistShelfRenderer)) {
    const items = parseItems(r.contents);
    return { title: '', items, layout: 'tracks' };
  }
  if ((r = section.gridRenderer)) {
    const items = parseItems(r.items);
    return { title: text(nav(r, 'header', 'gridHeaderRenderer', 'title')), items, layout: 'grid' };
  }
  if ((r = section.musicDescriptionShelfRenderer)) {
    return { title: text(r.header), items: [], layout: 'text', text: text(r.description), subtext: text(r.subheader) || text(r.footer) || undefined };
  }
  if ((r = section.itemSectionRenderer)) {
    for (const c of r.contents ?? []) {
      const s = parseShelf(c);
      if (s) return s;
    }
    return null;
  }
  if ((r = section.musicCardShelfRenderer)) {
    // search "top result" card
    const titleRun = nav(r, 'title', 'runs', 0);
    const ep = titleRun?.navigationEndpoint;
    const browse = browseOf(ep);
    const watch = ep?.watchEndpoint ?? nav(r, 'onTap', 'watchEndpoint');
    const subRuns: any[] = nav(r, 'subtitle', 'runs') ?? [];
    const kindText = (subRuns[0]?.text ?? '').toLowerCase();
    const items: Item[] = [];
    let top: Item | null = null;
    if (browse) {
      let type = typeFromPage(pageType(ep), browse.browseId);
      if (type === 'album' && (kindText === 'single' || kindText === 'ep')) type = kindText as ItemType;
      top = {
        kind: 'card',
        type,
        title: text(r.title),
        subtitle: text(r.subtitle),
        thumbnails: thumbs(r),
        browseId: browse.browseId,
        artists: subRuns.filter((x) => x.navigationEndpoint?.browseEndpoint).map((x) => ({ id: x.navigationEndpoint.browseEndpoint.browseId, name: x.text })),
        menu: parseMenu(r.menu?.menuRenderer),
      };
    } else if (watch?.videoId) {
      const vt = nav(watch, ...VIDEO_TYPE);
      const info = parseSongRuns(subRuns, true);
      top = {
        kind: 'track',
        videoId: watch.videoId,
        title: text(r.title),
        artists: info.artists,
        album: info.album ?? null,
        duration: info.duration,
        durationSec: info.durationSec,
        views: info.views,
        thumbnails: thumbs(r),
        videoType: vt,
        type: videoTypeToType(vt),
        isAvailable: true,
        menu: parseMenu(r.menu?.menuRenderer),
      };
      (top as any).topResult = true;
    }
    if (top) (top as any).isTop = true;
    for (const c of r.contents ?? []) {
      const it = parseItem(c);
      if (it) items.push(it);
    }
    return {
      title: text(nav(r, 'header', 'musicCardShelfHeaderBasicRenderer', 'title')) || 'Top result',
      items: top ? [top, ...items] : items,
      layout: 'cards',
      text: 'top',
    };
  }
  return null;
}

export function parseShelves(contents: any[] = []): Shelf[] {
  const out: Shelf[] = [];
  for (const c of contents) {
    const s = parseShelf(c);
    if (s && (s.items.length || s.text)) out.push(s);
  }
  return out;
}

export function parseChips(sectionList: any): Chip[] {
  const chips = nav(sectionList, 'header', 'chipCloudRenderer', 'chips') ?? [];
  return chips
    .map((c: any) => {
      const r = c.chipCloudChipRenderer;
      if (!r) return null;
      const b = nav(r, 'navigationEndpoint', 'browseEndpoint');
      return { title: text(r.text), params: b?.params, browseId: b?.browseId, selected: !!r.isSelected } as Chip;
    })
    .filter(Boolean);
}

// ---------------- headers ----------------

function runsRefs(runs: any[] = []): Ref[] {
  return runs
    .filter((r) => r.navigationEndpoint?.browseEndpoint)
    .map((r) => ({ id: r.navigationEndpoint.browseEndpoint.browseId, name: r.text }));
}

/** musicResponsiveHeaderRenderer (album / playlist / podcast / episode) */
export function parseResponsiveHeader(h: any): PageHeader {
  const subRuns: any[] = nav(h, 'subtitle', 'runs') ?? [];
  const second: any[] = nav(h, 'secondSubtitle', 'runs') ?? [];
  const strap = nav(h, 'straplineTextOne', 'runs') ?? [];
  const desc =
    text(nav(h, 'description', 'musicDescriptionShelfRenderer', 'description')) ||
    text(nav(h, 'description', 'description'));
  let playlistId: string | undefined;
  let saved: boolean | undefined;
  let likeStatus: LikeStatus | null = null;
  let menu: MenuInfo = {};
  for (const b of h.buttons ?? []) {
    if (b.musicPlayButtonRenderer) {
      const ep = b.musicPlayButtonRenderer.playNavigationEndpoint;
      playlistId = ep?.watchPlaylistEndpoint?.playlistId ?? ep?.watchEndpoint?.playlistId ?? playlistId;
    } else if (b.toggleButtonRenderer) {
      saved = !!b.toggleButtonRenderer.isToggled;
      const st = nav(b.toggleButtonRenderer, 'defaultServiceEndpoint', 'likeEndpoint', 'status');
      if (st) likeStatus = st === 'LIKE' ? (saved ? 'LIKE' : 'INDIFFERENT') : 'INDIFFERENT';
    } else if (b.menuRenderer) {
      menu = parseMenu(b.menuRenderer);
    } else if (b.buttonRenderer && nav(b, 'buttonRenderer', 'icon', 'iconType') === 'EDIT') {
      // edit button on owned playlists
    }
  }
  const author = strap.length ? { id: nav(strap[0], 'navigationEndpoint', 'browseEndpoint', 'browseId') ?? null, name: text({ runs: strap }) } : null;
  const facepileText = nav(h, 'facepile', 'avatarStackViewModel', 'text', 'content');
  const facepileCmd = nav(h, 'facepile', 'avatarStackViewModel', 'rendererContext', 'commandContext', 'onTap', 'innertubeCommand');
  const collab = nav(facepileCmd, 'showEngagementPanelEndpoint', 'identifier', 'tag') === 'PAplaylist_collaborate';
  const secondTexts = second.map((r) => r.text).filter((t) => t.trim() && t.trim() !== '•');
  const year = subRuns.map((r) => r.text).find((t: string) => /^\d{4}$/.test(t));
  return {
    title: text(h.title),
    subtitle: text(h.subtitle),
    secondSubtitle: text(h.secondSubtitle),
    description: desc || undefined,
    thumbnails: thumbs(h),
    type: subRuns[0]?.text,
    year,
    artists: runsRefs(strap),
    author: collab ? null : author ?? (facepileText ? { id: nav(facepileCmd, 'browseEndpoint', 'browseId') ?? null, name: facepileText } : null),
    collaborators: collab ? nav(h, 'facepile', 'avatarStackViewModel', 'rendererContext', 'accessibilityContext', 'label') : undefined,
    trackCount: secondTexts.find((t) => /song|track|episode|video/i.test(t)),
    duration: secondTexts.find((t) => /(hour|minute|second|hr|min|sec)/i.test(t)),
    views: secondTexts.find((t) => /view/i.test(t)),
    audioPlaylistId: playlistId,
    playlistId,
    saved,
    likeStatus,
    explicit: isExplicit(h),
    shuffle: menu.shuffle,
    radio: menu.radio,
    editablePlaylistId: menu.editablePlaylistId,
  };
}

/** artist / channel header */
export function parseArtistHeader(resp: any): PageHeader | undefined {
  const im = nav(resp, 'header', 'musicImmersiveHeaderRenderer');
  const vis = nav(resp, 'header', 'musicVisualHeaderRenderer');
  const h = im ?? vis;
  if (!h) return undefined;
  const sub = nav(h, 'subscriptionButton', 'subscribeButtonRenderer');
  const th = thumbs(h);
  return {
    title: text(h.title),
    description: text(h.description) || undefined,
    thumbnails: vis ? thumbs({ thumbnail: h.foregroundThumbnail }) .length ? thumbs({ thumbnail: h.foregroundThumbnail }) : th : th,
    banner: th,
    subscribers: text(sub?.subscriberCountText) || text(nav(sub, 'longSubscriberCountText')) || undefined,
    subscribed: sub?.subscribed,
    channelId: sub?.channelId,
    monthlyListeners: text(h.monthlyListenerCount) || undefined,
    shuffle: (() => {
      const e = nav(h, 'playButton', 'buttonRenderer', 'navigationEndpoint');
      const w = e?.watchPlaylistEndpoint ?? e?.watchEndpoint;
      return w?.playlistId ? { playlistId: w.playlistId, params: w.params } : undefined;
    })(),
    radio: (() => {
      const e = nav(h, 'startRadioButton', 'buttonRenderer', 'navigationEndpoint');
      const w = e?.watchPlaylistEndpoint ?? e?.watchEndpoint;
      return w?.playlistId ? { playlistId: w.playlistId, params: w.params } : undefined;
    })(),
  };
}

/** Legacy musicDetailHeaderRenderer (uploads album etc.) */
export function parseDetailHeader(h: any): PageHeader {
  const subRuns: any[] = nav(h, 'subtitle', 'runs') ?? [];
  const menu = h.menu?.menuRenderer;
  let playlistId: string | undefined;
  for (const b of menu?.topLevelButtons ?? []) {
    const ep = nav(b, 'buttonRenderer', 'navigationEndpoint');
    playlistId ??= ep?.watchPlaylistEndpoint?.playlistId ?? ep?.watchEndpoint?.playlistId;
  }
  const info = parseSongRuns(subRuns.slice(2));
  return {
    title: text(h.title),
    subtitle: text(h.subtitle),
    secondSubtitle: text(h.secondSubtitle),
    description: text(h.description) || undefined,
    thumbnails: thumbs(h),
    type: subRuns[0]?.text,
    artists: info.artists,
    year: info.year,
    playlistId,
    audioPlaylistId: playlistId,
  };
}

// ---------------- continuations ----------------

export interface ContToken {
  token: string;
  style: 'legacy' | 'next' | 'radio' | 'reload';
}

/** Find the continuation of a shelf/list container. */
export function findContinuation(container: any, list?: any[]): ContToken | undefined {
  const c = nav(container, 'continuations', 0);
  if (c?.nextContinuationData?.continuation) return { token: c.nextContinuationData.continuation, style: 'legacy' };
  if (c?.nextRadioContinuationData?.continuation) return { token: c.nextRadioContinuationData.continuation, style: 'radio' };
  const items = list ?? container?.contents ?? container?.items ?? [];
  const last = items[items.length - 1];
  const tok =
    nav(last, 'continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token') ??
    (nav(last, 'continuationItemRenderer', 'continuationEndpoint', 'commandExecutorCommand', 'commands') ?? [])
      .map((x: any) => x.continuationCommand?.token)
      .find(Boolean);
  if (tok) return { token: tok, style: 'next' };
  return undefined;
}

/** Extract the continuation payload from a continuation response. */
export function continuationContents(resp: any): { container: any; list: any[] } | undefined {
  const cc = resp.continuationContents;
  if (cc) {
    const container = Object.values(cc)[0] as any;
    return { container, list: container?.contents ?? container?.items ?? [] };
  }
  const items =
    nav(resp, 'onResponseReceivedActions', 0, 'appendContinuationItemsAction', 'continuationItems') ??
    nav(resp, 'onResponseReceivedActions', 0, 'reloadContinuationItemsCommand', 'continuationItems');
  if (items) return { container: { contents: items }, list: items };
  return undefined;
}
