// High level YouTube Music API (endpoints). Port of ytmusicapi's mixins.
import { ApiError, YTM, innertube, ytm, ytmWrite, webRemixVersion } from './innertube';
import { http } from './transport';
import {
  continuationContents,
  findContinuation,
  nav,
  parseArtistHeader,
  parseChips,
  parseDetailHeader,
  parseItem,
  parseItems,
  parseQueueItem,
  parseResponsiveHeader,
  parseShelf,
  pageType,
  text,
  thumbs,
  tracksOnly,
  type ContToken,
} from './parse';
import type { Account, BrowsePage, Card, Chip, Item, LikeStatus, Lyrics, Paged, PageHeader, Shelf, Track } from './types';

const SINGLE_TAB = ['contents', 'singleColumnBrowseResultsRenderer', 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer'];
const TWO_COL = ['contents', 'twoColumnBrowseResultsRenderer'];

// ---------------------------------------------------------------- paging

function pager<T>(
  cont: ContToken | undefined,
  body: Record<string, any>,
  parse: (list: any[], container: any) => T[],
  endpoint = 'browse',
): (() => Promise<Paged<T>>) | undefined {
  if (!cont) return undefined;
  return async () => {
    const enc = encodeURIComponent(cont.token);
    const resp =
      cont.style === 'next'
        ? await ytm(endpoint, { continuation: cont.token })
        : await ytm(endpoint, body, `&ctoken=${enc}&continuation=${enc}&type=next`);
    const cc = continuationContents(resp);
    if (!cc) return { items: [] };
    const items = parse(cc.list, cc.container);
    return { items, continuation: items.length ? pager(findContinuation(cc.container, cc.list), body, parse, endpoint) : undefined };
  };
}

/** Load every page of a paged list (bounded). */
export async function loadAll<T>(first: Paged<T>, max = 5000): Promise<T[]> {
  const out = [...first.items];
  let next = first.continuation;
  while (next && out.length < max) {
    const p = await next();
    out.push(...p.items);
    next = p.continuation;
  }
  return out;
}

function shelfContainer(section: any): any {
  return (
    section.musicShelfRenderer ??
    section.gridRenderer ??
    section.musicPlaylistShelfRenderer ??
    nav(section, 'itemSectionRenderer', 'contents', 0, 'musicShelfRenderer') ??
    nav(section, 'itemSectionRenderer', 'contents', 0, 'gridRenderer')
  );
}

function shelvesFrom(sections: any[] = [], body: Record<string, any>): Shelf[] {
  const out: Shelf[] = [];
  for (const sec of sections) {
    const s = parseShelf(sec);
    if (!s || (!s.items.length && !s.text)) continue;
    const container = shelfContainer(sec);
    if (container) {
      const list = container.contents ?? container.items;
      const p = pager(findContinuation(container, list), body, (l) => parseItems(l));
      if (p) s.continuation = p as any;
    }
    out.push(s);
  }
  return out;
}

function sectionMore(sl: any, body: Record<string, any>): BrowsePage['more'] {
  const cont = findContinuation(sl);
  if (!cont) return undefined;
  return async () => {
    const enc = encodeURIComponent(cont.token);
    const resp =
      cont.style === 'next'
        ? await ytm('browse', { continuation: cont.token })
        : await ytm('browse', body, `&ctoken=${enc}&continuation=${enc}&type=next`);
    const cc = continuationContents(resp);
    if (!cc) return { shelves: [] };
    return { shelves: shelvesFrom(cc.list, body), more: sectionMore(cc.container, body) };
  };
}

// ---------------------------------------------------------------- browse

export async function getHome(params?: string): Promise<BrowsePage> {
  const body: Record<string, any> = { browseId: 'FEmusic_home' };
  if (params) body.params = params;
  const resp = await ytm('browse', body, '', true);
  const sl = nav(resp, ...SINGLE_TAB);
  return { shelves: shelvesFrom(sl?.contents, body), chips: parseChips(sl), more: sectionMore(sl, body) };
}

/** Generic browse page (explore, charts, moods, new releases, "see all", channels...). */
export async function browse(browseId: string, params?: string, formData?: any): Promise<BrowsePage> {
  const body: Record<string, any> = { browseId };
  if (params) body.params = params;
  if (formData) body.formData = formData;
  const resp = await ytm('browse', body, '', true);
  const page: BrowsePage = { shelves: [] };
  page.header = parseArtistHeader(resp);
  if (!page.header && resp.header?.musicDetailHeaderRenderer) page.header = parseDetailHeader(resp.header.musicDetailHeaderRenderer);
  if (!page.header && resp.header?.musicHeaderRenderer) page.header = { title: text(resp.header.musicHeaderRenderer.title), thumbnails: [] };
  const single = nav(resp, ...SINGLE_TAB);
  const two = nav(resp, ...TWO_COL);
  if (single) {
    page.shelves = shelvesFrom(single.contents, body);
    page.chips = parseChips(single);
    page.more = sectionMore(single, body);
  } else if (two) {
    const primary: any[] = nav(two, 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents') ?? [];
    const rh = nav(primary, 0, 'musicResponsiveHeaderRenderer') ?? nav(primary, 0, 'musicEditablePlaylistDetailHeaderRenderer', 'header', 'musicResponsiveHeaderRenderer');
    if (rh && !page.header) page.header = parseResponsiveHeader(rh);
    const secondary = nav(two, 'secondaryContents', 'sectionListRenderer');
    page.shelves = [...shelvesFrom(primary.slice(rh ? 1 : 0), body), ...shelvesFrom(secondary?.contents, body)];
    page.more = sectionMore(secondary, body);
  }
  return page;
}

export function getExplore() {
  return browse('FEmusic_explore');
}
export function getNewReleases() {
  return browse('FEmusic_new_releases');
}
export function getMoodsAndGenres() {
  return browse('FEmusic_moods_and_genres');
}
export function getMoodCategory(params: string) {
  return browse('FEmusic_moods_and_genres_category', params);
}
export function getCharts(country = 'ZZ') {
  return browse('FEmusic_charts', undefined, { selectedValues: [country] });
}

export const CHART_COUNTRIES = [
  'ZZ', 'AR', 'AU', 'AT', 'BE', 'BO', 'BR', 'CA', 'CL', 'CO', 'CR', 'CZ', 'DK', 'DO', 'EC', 'EG', 'SV', 'EE', 'FI', 'FR', 'DE',
  'GT', 'HN', 'HU', 'IS', 'IN', 'ID', 'IE', 'IL', 'IT', 'JP', 'KE', 'LU', 'MX', 'NL', 'NZ', 'NI', 'NG', 'NO', 'PA', 'PY', 'PE',
  'PL', 'PT', 'RO', 'RU', 'SA', 'RS', 'ZA', 'KR', 'ES', 'SE', 'CH', 'TZ', 'TR', 'UG', 'UA', 'AE', 'GB', 'US', 'UY', 'ZW',
];

// ---------------------------------------------------------------- artist

export interface ArtistPage extends BrowsePage {
  header: PageHeader;
  topSongs: Track[];
  topSongsMore?: string; // playlist browse id
  about?: { text: string; views?: string };
}

export async function getArtist(channelId: string): Promise<ArtistPage> {
  channelId = channelId.replace(/^MPLA/, '');
  const body = { browseId: channelId };
  const resp = await ytm('browse', body, '', true);
  const header = parseArtistHeader(resp) ?? { title: '', thumbnails: [] };
  const sections: any[] = nav(resp, ...SINGLE_TAB, 'contents') ?? nav(resp, ...TWO_COL, 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents') ?? [];
  const shelves = shelvesFrom(sections, body);
  let topSongs: Track[] = [];
  let topSongsMore: string | undefined;
  let about: ArtistPage['about'];
  const rest: Shelf[] = [];
  for (const s of shelves) {
    if (s.layout === 'text') {
      about = { text: s.text ?? '', views: s.subtext };
      continue;
    }
    if (!topSongs.length && s.layout === 'tracks') {
      topSongs = tracksOnly(s.items);
      topSongsMore = s.more?.browseId;
      continue;
    }
    rest.push(s);
  }
  if (about?.text && !header.description) header.description = about.text;
  if (about?.views && !header.views) header.views = about.views;
  return { header, topSongs, topSongsMore, about, shelves: rest };
}

// ---------------------------------------------------------------- album

export interface AlbumPage {
  header: PageHeader;
  browseId: string;
  tracks: Track[];
  shelves: Shelf[];
}

export async function getAlbum(browseId: string): Promise<AlbumPage> {
  const body = { browseId };
  const resp = await ytm('browse', body, '', true);
  const two = nav(resp, ...TWO_COL);
  let header: PageHeader;
  let tracks: Track[] = [];
  let shelves: Shelf[] = [];
  if (two) {
    const rh = nav(two, 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents', 0, 'musicResponsiveHeaderRenderer');
    header = rh ? parseResponsiveHeader(rh) : { title: '', thumbnails: [] };
    const sec: any[] = nav(two, 'secondaryContents', 'sectionListRenderer', 'contents') ?? [];
    const shelf = nav(sec, 0, 'musicShelfRenderer') ?? nav(sec, 0, 'musicPlaylistShelfRenderer');
    tracks = tracksOnly(parseItems(shelf?.contents));
    shelves = shelvesFrom(sec.slice(1), body);
  } else {
    // legacy layout (uploaded albums)
    header = resp.header?.musicDetailHeaderRenderer ? parseDetailHeader(resp.header.musicDetailHeaderRenderer) : { title: '', thumbnails: [] };
    const sec: any[] = nav(resp, ...SINGLE_TAB, 'contents') ?? [];
    tracks = tracksOnly(parseItems(nav(sec, 0, 'musicShelfRenderer', 'contents')));
  }
  const albumRef = { id: browseId, name: header.title };
  tracks.forEach((t, i) => {
    t.album = albumRef;
    if (!t.artists.length && header.artists) t.artists = header.artists;
    if (!t.thumbnails.length) t.thumbnails = header.thumbnails;
    t.trackNumber ??= i + 1;
  });
  return { header, browseId, tracks, shelves };
}

/** Resolve an album's MPRE browse id from its OLAK audio playlist id. */
export async function getAlbumBrowseId(audioPlaylistId: string): Promise<string | null> {
  const r = await http({ url: `${YTM}/playlist?list=${encodeURIComponent(audioPlaylistId)}` });
  const decoded = r.body.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const m = decoded.match(/"(MPRE[A-Za-z0-9_-]+)"/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- playlist

export interface PlaylistPage {
  id: string;
  header: PageHeader;
  tracks: Track[];
  more?: () => Promise<Paged<Track>>;
  related?: () => Promise<Shelf[]>;
}

export async function getPlaylist(playlistId: string): Promise<PlaylistPage> {
  const browseId = playlistId.startsWith('VL') ? playlistId : 'VL' + playlistId;
  const id = browseId.slice(2);
  const body = { browseId };
  const resp = await ytm('browse', body, '', true);
  const two = nav(resp, ...TWO_COL);
  const parseTracks = (l: any[]) => tracksOnly(parseItems(l));
  if (!two) {
    // legacy single-column (e.g. some auto playlists)
    const sl = nav(resp, ...SINGLE_TAB);
    const shelf = nav(sl, 'contents', 0, 'musicPlaylistShelfRenderer') ?? nav(sl, 'contents', 0, 'musicShelfRenderer');
    const hdr = resp.header?.musicDetailHeaderRenderer ? parseDetailHeader(resp.header.musicDetailHeaderRenderer) : { title: text(nav(resp, 'header', 'musicHeaderRenderer', 'title')), thumbnails: [] };
    return { id, header: hdr, tracks: parseTracks(shelf?.contents), more: pager(findContinuation(shelf), body, parseTracks) };
  }
  const first = nav(two, 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents', 0);
  let header: PageHeader;
  const editable = first?.musicEditablePlaylistDetailHeaderRenderer;
  if (editable) {
    header = parseResponsiveHeader(nav(editable, 'header', 'musicResponsiveHeaderRenderer') ?? {});
    header.owned = true;
    header.privacy = nav(editable, 'editHeader', 'musicPlaylistEditHeaderRenderer', 'privacy');
    header.editablePlaylistId = editable.playlistId ?? id;
    const ed = nav(editable, 'editHeader', 'musicPlaylistEditHeaderRenderer');
    if (!header.description && ed?.description) header.description = text(ed.description);
  } else if (first?.musicResponsiveHeaderRenderer) {
    header = parseResponsiveHeader(first.musicResponsiveHeaderRenderer);
  } else {
    header = { title: '', thumbnails: [] };
  }
  const secondary = nav(two, 'secondaryContents', 'sectionListRenderer');
  const shelf = nav(secondary, 'contents', 0, 'musicPlaylistShelfRenderer') ?? nav(secondary, 'contents', 0, 'musicShelfRenderer');
  const tracks = parseTracks(shelf?.contents);
  if (!header.title && tracks[0]?.album) {
    header.title = tracks[0].album.name;
  }
  if (!header.thumbnails.length && tracks[0]) header.thumbnails = tracks[0].thumbnails;
  const secCont = findContinuation(secondary);
  const related = secCont
    ? async () => {
        const p = pager(secCont, body, (l) => l)!;
        const res = await p();
        return shelvesFrom(res.items as any[], body);
      }
    : undefined;
  return { id, header, tracks, more: pager(findContinuation(shelf), body, parseTracks), related };
}

// ---------------------------------------------------------------- podcasts

export async function getPodcast(id: string): Promise<PlaylistPage & { browseId: string }> {
  const browseId = id.startsWith('MPSP') ? id : 'MPSP' + id;
  const body = { browseId };
  const resp = await ytm('browse', body, '', true);
  const two = nav(resp, ...TWO_COL);
  const rh = nav(two, 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents', 0, 'musicResponsiveHeaderRenderer');
  const header = rh ? parseResponsiveHeader(rh) : { title: '', thumbnails: [] };
  const shelf = nav(two, 'secondaryContents', 'sectionListRenderer', 'contents', 0, 'musicShelfRenderer');
  const parseEp = (l: any[]) => tracksOnly(parseItems(l));
  const tracks = parseEp(shelf?.contents);
  tracks.forEach((t) => {
    if (!t.artists.length && header.author) t.artists = [header.author];
  });
  return { id: browseId.slice(4), browseId, header, tracks, more: pager(findContinuation(shelf), body, parseEp) };
}

export async function getEpisode(videoId: string): Promise<{ header: PageHeader; description: string; videoId: string }> {
  const browseId = videoId.startsWith('MPED') ? videoId : 'MPED' + videoId;
  const resp = await ytm('browse', { browseId }, '', true);
  const two = nav(resp, ...TWO_COL);
  const rh = nav(two, 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents', 0, 'musicResponsiveHeaderRenderer');
  const header = rh ? parseResponsiveHeader(rh) : { title: '', thumbnails: [] };
  const desc = text(nav(two, 'secondaryContents', 'sectionListRenderer', 'contents', 0, 'musicDescriptionShelfRenderer', 'description'));
  return { header, description: desc, videoId: browseId.slice(4) };
}

// ---------------------------------------------------------------- search

export const SEARCH_FILTERS = ['songs', 'videos', 'albums', 'artists', 'community_playlists', 'featured_playlists', 'profiles', 'podcasts', 'episodes'] as const;
export type SearchFilter = (typeof SEARCH_FILTERS)[number] | 'uploads' | 'library';

function searchParams(filter?: SearchFilter): string | undefined {
  if (!filter) return undefined;
  if (filter === 'uploads') return 'agIYAw%3D%3D';
  if (filter === 'library') return 'agIYBA%3D%3D';
  if (filter === 'community_playlists') return 'EgeKAQQoAEABagwQDhAKEAMQBBAJEAU%3D';
  if (filter === 'featured_playlists') return 'EgeKAQQoADgBagwQDhAKEAMQBBAJEAU%3D';
  const p2: Record<string, string> = { songs: 'II', videos: 'IQ', albums: 'IY', artists: 'Ig', profiles: 'JY', podcasts: 'JQ', episodes: 'JI' };
  return 'EgWKAQ' + p2[filter] + 'AWoMEA4QChADEAQQCRAF';
}

export interface SearchResult {
  shelves: Shelf[];
  /** filtered search results (when a filter is set) */
  list?: Paged<Item>;
  correction?: { text: string; query: string };
}

export async function search(query: string, filter?: SearchFilter): Promise<SearchResult> {
  const body: Record<string, any> = { query };
  const p = searchParams(filter);
  if (p) body.params = p;
  const resp = await ytm('search', body, '', true);
  const tabs = nav(resp, 'contents', 'tabbedSearchResultsRenderer', 'tabs');
  const content = tabs ? nav(tabs, 0, 'tabRenderer', 'content') : resp.contents;
  const sections: any[] = nav(content, 'sectionListRenderer', 'contents') ?? [];
  const out: SearchResult = { shelves: [] };
  for (const sec of sections) {
    const dym = nav(sec, 'itemSectionRenderer', 'contents', 0, 'didYouMeanRenderer') ?? nav(sec, 'itemSectionRenderer', 'contents', 0, 'showingResultsForRenderer');
    if (dym) {
      const ep = dym.correctedQueryEndpoint ?? nav(dym, 'originalQueryEndpoint');
      out.correction = { text: text(dym.correctedQuery ?? dym.correctedQuery), query: nav(ep, 'searchEndpoint', 'query') ?? text(dym.correctedQuery) };
    }
  }
  const shelves = shelvesFrom(sections, body);
  if (filter) {
    const sec = sections.find((s) => s.musicShelfRenderer || nav(s, 'itemSectionRenderer', 'contents', 0, 'musicShelfRenderer'));
    const container = sec ? shelfContainer(sec) : null;
    const items = parseItems(container?.contents);
    out.list = { items, continuation: pager(findContinuation(container), body, (l) => parseItems(l), 'search') };
  } else {
    out.shelves = shelves;
  }
  return out;
}

export interface Suggestions {
  queries: { text: string; fromHistory: boolean; token?: string }[];
  items: Item[];
}

export async function searchSuggestions(input: string): Promise<Suggestions> {
  const resp = await ytm('music/get_search_suggestions', { input });
  const out: Suggestions = { queries: [], items: [] };
  for (const section of resp.contents ?? []) {
    for (const c of nav(section, 'searchSuggestionsSectionRenderer', 'contents') ?? []) {
      const s = c.searchSuggestionRenderer ?? c.historySuggestionRenderer;
      if (s) {
        out.queries.push({
          text: nav(s, 'navigationEndpoint', 'searchEndpoint', 'query') ?? text(s.suggestion),
          fromHistory: !!c.historySuggestionRenderer,
          token: nav(s, 'serviceEndpoint', 'feedbackEndpoint', 'feedbackToken'),
        });
      } else {
        const it = parseItem(c);
        if (it) out.items.push(it);
      }
    }
  }
  return out;
}

export async function removeSearchSuggestion(token: string) {
  return ytmWrite('feedback', { feedbackTokens: [token] });
}

// ---------------------------------------------------------------- library

export type LibraryOrder = 'a_to_z' | 'z_to_a' | 'recently_added' | undefined;
const ORDER_PARAMS: Record<string, string> = { a_to_z: 'ggMGKgQIARAA', z_to_a: 'ggMGKgQIARAB', recently_added: 'ggMGKgQIABAB' };

export const LIBRARY = {
  playlists: 'FEmusic_liked_playlists',
  songs: 'FEmusic_liked_videos',
  albums: 'FEmusic_liked_albums',
  artists: 'FEmusic_library_corpus_track_artists',
  subscriptions: 'FEmusic_library_corpus_artists',
  podcasts: 'FEmusic_library_non_music_audio_list',
  channels: 'FEmusic_library_non_music_audio_channels_list',
  uploadSongs: 'FEmusic_library_privately_owned_tracks',
  uploadAlbums: 'FEmusic_library_privately_owned_releases',
  uploadArtists: 'FEmusic_library_privately_owned_artists',
} as const;

/** Library list (grid or shelf) with continuation. */
export async function getLibrary(browseId: string, order?: LibraryOrder): Promise<Paged<Item>> {
  const body: Record<string, any> = { browseId };
  if (order) body.params = ORDER_PARAMS[order];
  const resp = await ytm('browse', body);
  let sections: any[] | undefined = nav(resp, ...SINGLE_TAB, 'contents');
  if (!sections) {
    const tabs: any[] = nav(resp, 'contents', 'singleColumnBrowseResultsRenderer', 'tabs') ?? [];
    for (const t of tabs) {
      const c = nav(t, 'tabRenderer', 'content', 'sectionListRenderer', 'contents');
      if (c) {
        sections = c;
        if (nav(t, 'tabRenderer', 'selected')) break;
      }
    }
  }
  for (const sec of sections ?? []) {
    const container = shelfContainer(sec);
    if (!container) continue;
    const list = container.contents ?? container.items ?? [];
    const items = parseItems(list);
    return { items, continuation: pager(findContinuation(container, list), body, (l) => parseItems(l)) };
  }
  return { items: [] };
}

export async function getLibrarySongs(order?: LibraryOrder) {
  const p = await getLibrary(LIBRARY.songs, order);
  return { ...p, items: p.items.filter((i) => i.kind === 'track') };
}

export async function getHistory(): Promise<Track[]> {
  const resp = await ytm('browse', { browseId: 'FEmusic_history' });
  const out: Track[] = [];
  for (const sec of nav(resp, ...SINGLE_TAB, 'contents') ?? []) {
    const shelf = sec.musicShelfRenderer;
    if (!shelf) continue;
    const played = text(shelf.title);
    for (const t of tracksOnly(parseItems(shelf.contents))) {
      t.played = played;
      out.push(t);
    }
  }
  return out;
}

// ---------------------------------------------------------------- watch / queue

export interface WatchOptions {
  videoId?: string;
  playlistId?: string;
  params?: string;
  radio?: boolean;
  shuffle?: boolean;
  index?: number;
}

export interface WatchResult {
  tracks: Track[];
  playlistId?: string;
  lyricsId?: string;
  relatedId?: string;
  continuation?: () => Promise<Paged<Track>>;
}

export async function getWatchQueue(o: WatchOptions): Promise<WatchResult> {
  const body: Record<string, any> = {
    enablePersistentPlaylistPanel: true,
    isAudioOnly: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
  };
  let playlistId = o.playlistId?.replace(/^VL/, '');
  if (o.videoId) {
    body.videoId = o.videoId;
    if (!playlistId) playlistId = 'RDAMVM' + o.videoId;
    if (!(o.radio || o.shuffle)) {
      body.watchEndpointMusicSupportedConfigs = { watchEndpointMusicConfig: { hasPersistentPlaylistPanel: true, musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' } };
    }
  }
  if (playlistId) body.playlistId = playlistId;
  if (o.index != null) body.index = o.index;
  if (o.params) body.params = o.params;
  else if (o.shuffle && playlistId) body.params = 'wAEB8gECKAE%3D';
  else if (o.radio) body.params = 'wAEB';
  const resp = await ytm('next', body);
  const wn = nav(resp, 'contents', 'singleColumnMusicWatchNextResultsRenderer', 'tabbedRenderer', 'watchNextTabbedResultsRenderer');
  const out: WatchResult = { tracks: [] };
  for (const tab of wn?.tabs ?? []) {
    const tr = tab.tabRenderer;
    if (!tr || tr.unselectable) continue;
    const b = nav(tr, 'endpoint', 'browseEndpoint');
    const pt = pageType(nav(tr, 'endpoint'));
    if (pt === 'MUSIC_PAGE_TYPE_TRACK_LYRICS') out.lyricsId = b.browseId;
    if (pt === 'MUSIC_PAGE_TYPE_TRACK_RELATED') out.relatedId = b.browseId;
  }
  const panel = nav(wn, 'tabs', 0, 'tabRenderer', 'content', 'musicQueueRenderer', 'content', 'playlistPanelRenderer');
  if (!panel) throw new ApiError('No queue returned (the playlist may be private or unavailable).');
  const parse = (l: any[]) => l.map(parseQueueItem).filter((t): t is Track => !!t && t.isAvailable !== false);
  out.tracks = parse(panel.contents);
  out.playlistId = panel.playlistId ?? playlistId;
  out.continuation = pager(findContinuation(panel), body, parse, 'next');
  return out;
}

export async function getRelated(browseId: string): Promise<Shelf[]> {
  const resp = await ytm('browse', { browseId }, '', true);
  return shelvesFrom(nav(resp, 'contents', 'sectionListRenderer', 'contents'), { browseId });
}

// ---------------------------------------------------------------- lyrics

const ANDROID_MUSIC = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50', clientNameId: 21, userAgent: 'com.google.android.apps.youtube.music/7.21.50 (Linux; U; Android 13) gzip', extra: { androidSdkVersion: 33, osName: 'Android', osVersion: '13' } };

export async function getLyrics(browseId: string): Promise<Lyrics | null> {
  // timed lyrics via the mobile client
  try {
    const r = await innertube('browse', { browseId }, { client: ANDROID_MUSIC, auth: false });
    const data = nav(r, 'contents', 'elementRenderer', 'newElement', 'type', 'componentType', 'model', 'timedLyricsModel', 'lyricsData');
    const lines: any[] = data?.timedLyricsData ?? [];
    if (lines.length && lines.every((l) => l.cueRange)) {
      return {
        text: lines.map((l) => l.lyricLine).join('\n'),
        source: data.sourceMessage,
        lines: lines.map((l) => ({
          start: +l.cueRange.startTimeMilliseconds / 1000,
          end: +l.cueRange.endTimeMilliseconds / 1000,
          text: l.lyricLine,
        })),
      };
    }
  } catch {
    /* fall through */
  }
  const r = await ytm('browse', { browseId }, '', true);
  const shelf = nav(r, 'contents', 'sectionListRenderer', 'contents', 0, 'musicDescriptionShelfRenderer');
  if (!shelf) return null;
  return { text: text(shelf.description), source: text(shelf.footer) || undefined };
}

/** Synced lyrics fallback from LRCLIB (open lyrics database). */
export async function getLrclib(track: { title: string; artist: string; album?: string; duration?: number }): Promise<Lyrics | null> {
  const q = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  if (track.album) q.set('album_name', track.album);
  if (track.duration) q.set('duration', String(Math.round(track.duration)));
  const parseLrc = (lrc: string) => {
    const lines: { start: number; end: number; text: string }[] = [];
    for (const row of lrc.split('\n')) {
      const m = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (m) lines.push({ start: +m[1] * 60 + +m[2], end: 0, text: m[3].trim() });
    }
    lines.forEach((l, i) => (l.end = lines[i + 1]?.start ?? l.start + 5));
    return lines;
  };
  const tryUrl = async (url: string) => {
    const r = await http({ url, headers: { 'User-Agent': 'SpotiTube (https://github.com/2imeline/SpotiTube)' }, auth: false });
    if (r.status !== 200) return null;
    let j = JSON.parse(r.body);
    if (Array.isArray(j)) j = j.find((x) => x.syncedLyrics) ?? j[0];
    if (!j) return null;
    if (j.syncedLyrics) return { text: j.plainLyrics ?? '', source: 'Source: LRCLIB', lines: parseLrc(j.syncedLyrics) } as Lyrics;
    if (j.plainLyrics) return { text: j.plainLyrics, source: 'Source: LRCLIB' } as Lyrics;
    return null;
  };
  try {
    return (await tryUrl('https://lrclib.net/api/get?' + q)) ?? (await tryUrl('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: track.title, artist_name: track.artist })));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- song info / credits

export async function getPlayerInfo(videoId: string): Promise<any> {
  const days = Math.floor(Date.now() / 86400000) - 1;
  return ytm('player', {
    videoId,
    playbackContext: { contentPlaybackContext: { signatureTimestamp: days, html5Preference: 'HTML5_PREF_WANTS' } },
    racyCheckOk: true,
    contentCheckOk: true,
  });
}

/** Register a play in the user's YouTube Music history. */
export async function addHistoryItem(playerResponse: any) {
  const url: string | undefined = nav(playerResponse, 'playbackTracking', 'videostatsPlaybackUrl', 'baseUrl');
  if (!url) return;
  const CPNA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  let cpn = '';
  for (let i = 0; i < 16; i++) cpn += CPNA[Math.floor(Math.random() * 256) & 63];
  const sep = url.includes('?') ? '&' : '?';
  await http({ url: `${url}${sep}ver=2&c=WEB_REMIX&cver=${webRemixVersion()}&cpn=${cpn}`, headers: { Origin: YTM, Referer: YTM + '/' } });
}

export async function getCredits(browseId: string): Promise<{ title: string; names: string[] }[]> {
  const r = await ytm('browse', { browseId });
  const sections: any[] = nav(r, 'onResponseReceivedActions', 0, 'openPopupAction', 'popup', 'dismissableDialogRenderer', 'sections') ?? [];
  return sections
    .map((s) => s.dismissableDialogContentSectionRenderer)
    .filter(Boolean)
    .map((s) => ({ title: text(s.title), names: (nav(s, 'subtitle', 'runs') ?? []).filter((_: any, i: number) => i % 2 === 0).map((x: any) => x.text) }));
}

// ---------------------------------------------------------------- mutations

export function rateSong(videoId: string, status: LikeStatus) {
  const ep = status === 'LIKE' ? 'like/like' : status === 'DISLIKE' ? 'like/dislike' : 'like/removelike';
  return ytmWrite(ep, { target: { videoId } });
}

export function ratePlaylist(playlistId: string, status: LikeStatus) {
  const ep = status === 'LIKE' ? 'like/like' : status === 'DISLIKE' ? 'like/dislike' : 'like/removelike';
  return ytmWrite(ep, { target: { playlistId: playlistId.replace(/^VL/, '') } });
}

export function subscribe(channelId: string) {
  return ytmWrite('subscription/subscribe', { channelIds: [channelId] });
}
export function unsubscribe(channelId: string) {
  return ytmWrite('subscription/unsubscribe', { channelIds: [channelId] });
}

export function sendFeedback(tokens: string[]) {
  return ytmWrite('feedback', { feedbackTokens: tokens });
}

export async function createPlaylist(title: string, description = '', privacyStatus = 'PRIVATE', videoIds?: string[], sourcePlaylist?: string): Promise<string> {
  const body: Record<string, any> = { title, description, privacyStatus };
  if (videoIds?.length) body.videoIds = videoIds;
  if (sourcePlaylist) body.sourcePlaylistId = sourcePlaylist;
  const r = await ytmWrite('playlist/create', body);
  if (!r.playlistId) throw new ApiError('YouTube Music did not create the playlist.');
  return r.playlistId;
}

export function deletePlaylist(playlistId: string) {
  return ytmWrite('playlist/delete', { playlistId: playlistId.replace(/^VL/, '') });
}

export interface PlaylistEdit {
  title?: string;
  description?: string;
  privacy?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
  moveItem?: [string, string | undefined];
  addPlaylistId?: string;
  addToTop?: boolean;
}

export async function editPlaylist(playlistId: string, e: PlaylistEdit) {
  const actions: any[] = [];
  if (e.title) actions.push({ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: e.title });
  if (e.description != null) actions.push({ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: e.description });
  if (e.privacy) actions.push({ action: 'ACTION_SET_PLAYLIST_PRIVACY', playlistPrivacy: e.privacy });
  if (e.moveItem) {
    const a: any = { action: 'ACTION_MOVE_VIDEO_BEFORE', setVideoId: e.moveItem[0] };
    if (e.moveItem[1]) a.movedSetVideoIdSuccessor = e.moveItem[1];
    actions.push(a);
  }
  if (e.addPlaylistId) actions.push({ action: 'ACTION_ADD_PLAYLIST', addedFullListId: e.addPlaylistId });
  if (e.addToTop != null) actions.push({ action: 'ACTION_SET_ADD_TO_TOP', addToTop: String(e.addToTop) });
  return ytmWrite('browse/edit_playlist', { playlistId: playlistId.replace(/^VL/, ''), actions });
}

/** Returns 'ok' or 'duplicate' when YTM asks to confirm adding duplicates. */
export async function addToPlaylist(playlistId: string, videoIds: string[], allowDuplicates = false, sourcePlaylist?: string): Promise<'ok' | 'duplicate'> {
  const actions: any[] = videoIds.map((v) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: v, ...(allowDuplicates ? { dedupeOption: 'DEDUPE_OPTION_SKIP' } : {}) }));
  if (sourcePlaylist) {
    actions.push({ action: 'ACTION_ADD_PLAYLIST', addedFullListId: sourcePlaylist.replace(/^VL/, '') });
    if (!videoIds.length) actions.push({ action: 'ACTION_ADD_VIDEO', addedVideoId: null });
  }
  const r = await ytmWrite('browse/edit_playlist', { playlistId: playlistId.replace(/^VL/, ''), actions });
  if (String(r.status ?? '').includes('SUCCEEDED')) return 'ok';
  if (JSON.stringify(r.actions ?? '').includes('confirmDialogRenderer')) return 'duplicate';
  return 'ok';
}

export function removeFromPlaylist(playlistId: string, items: { videoId: string; setVideoId: string }[]) {
  return ytmWrite('browse/edit_playlist', {
    playlistId: playlistId.replace(/^VL/, ''),
    actions: items.map((i) => ({ action: 'ACTION_REMOVE_VIDEO', setVideoId: i.setVideoId, removedVideoId: i.videoId })),
  });
}

export function deleteUpload(entityId: string) {
  return ytmWrite('music/delete_privately_owned_entity', { entityId: entityId.replace('FEmusic_library_privately_owned_release_detail', '') });
}

// ---------------------------------------------------------------- account

export async function getAccountInfo(): Promise<Account | null> {
  try {
    const r = await ytm('account/account_menu', {});
    const h = nav(r, 'actions', 0, 'openPopupAction', 'popup', 'multiPageMenuRenderer', 'header', 'activeAccountHeaderRenderer');
    if (!h) return null;
    return { name: text(h.accountName), handle: text(h.channelHandle) || undefined, photo: nav(h, 'accountPhoto', 'thumbnails', 0, 'url') };
  } catch {
    return null;
  }
}

function findAll(o: any, key: string, out: any[] = []): any[] {
  if (!o || typeof o !== 'object') return out;
  if (Array.isArray(o)) {
    for (const x of o) findAll(x, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === key) out.push(v);
    else findAll(v, key, out);
  }
  return out;
}

/** Google accounts + brand channels available for switching. */
export async function getAccounts(): Promise<Account[]> {
  try {
    const r = await ytm('account/accounts_list', {});
    return findAll(r, 'accountItem').map((a: any) => {
      const tokens: any[] = nav(a, 'serviceEndpoint', 'selectActiveIdentityEndpoint', 'supportedTokens') ?? [];
      const pageId = tokens.map((t) => t.pageIdToken?.pageId).find(Boolean);
      const signin: string | undefined = tokens.map((t) => t.accountSigninToken?.signinUrl).find(Boolean);
      const au = signin?.match(/authuser=(\d+)/)?.[1];
      return {
        name: text(a.accountName),
        handle: text(a.channelHandle) || text(a.accountByline) || undefined,
        photo: nav(a, 'accountPhoto', 'thumbnails', 0, 'url'),
        brandId: pageId,
        selected: !!a.isSelected,
        authUser: au != null ? +au : undefined,
      } as Account;
    });
  } catch {
    return [];
  }
}

// helper used by UI for "Go to album" from an OLAK playlist card etc.
export function cardRoute(c: Card): string | null {
  const id = c.browseId;
  switch (c.type) {
    case 'album':
    case 'single':
    case 'ep':
      return id ? `/album/${id}` : c.playlistId ? `/playlist/${c.playlistId}` : null;
    case 'artist':
    case 'profile':
      return id ? `/artist/${id}` : null;
    case 'playlist':
      return id ? `/playlist/${id.replace(/^VL/, '')}` : c.playlistId ? `/playlist/${c.playlistId}` : null;
    case 'podcast':
      return id ? `/podcast/${id}` : null;
    case 'episode':
      return id ? `/episode/${id}` : null;
    case 'mood':
      if (id === 'FEmusic_moods_and_genres_category') return `/mood/${encodeURIComponent(c.params ?? '')}?t=${encodeURIComponent(c.title)}`;
      if (id === 'FEmusic_charts') return '/charts';
      if (id === 'FEmusic_moods_and_genres') return '/moods';
      if (id === 'FEmusic_new_releases') return '/browse/FEmusic_new_releases';
      return id ? `/browse/${id}${c.params ? '?p=' + encodeURIComponent(c.params) : ''}` : null;
    default:
      if (id?.startsWith('MPRE')) return `/album/${id}`;
      if (id?.startsWith('UC')) return `/artist/${id}`;
      if (id?.startsWith('VL')) return `/playlist/${id.slice(2)}`;
      return id ? `/browse/${id}${c.params ? '?p=' + encodeURIComponent(c.params) : ''}` : null;
  }
}

export type { Chip };
export { thumbs };
