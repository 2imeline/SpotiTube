export interface Thumb {
  url: string;
  width?: number;
  height?: number;
}

export interface Ref {
  id?: string | null;
  name: string;
}

export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';

export type ItemType =
  | 'song'
  | 'video'
  | 'album'
  | 'single'
  | 'ep'
  | 'artist'
  | 'playlist'
  | 'podcast'
  | 'episode'
  | 'profile'
  | 'station'
  | 'mood'
  | 'unknown';

export interface Endpoint {
  browseId?: string;
  params?: string;
  playlistId?: string;
  videoId?: string;
}

/** Data extracted from an item's "⋮" context menu. */
export interface MenuInfo {
  likeStatus?: LikeStatus | null;
  inLibrary?: boolean;
  libraryAdd?: string;
  libraryRemove?: string;
  pinned?: boolean;
  pinToken?: string;
  unpinToken?: string;
  setVideoId?: string;
  removedVideoId?: string;
  removeHistoryToken?: string;
  radio?: Endpoint;
  shuffle?: Endpoint;
  artistId?: string;
  albumId?: string;
  creditsId?: string;
  editablePlaylistId?: string;
  uploadEntityId?: string;
  podcastSaveToken?: string;
  episodeSaved?: boolean;
}

export interface Track {
  kind: 'track';
  videoId: string;
  title: string;
  artists: Ref[];
  album?: Ref | null;
  duration?: string;
  durationSec?: number;
  thumbnails: Thumb[];
  explicit?: boolean;
  videoType?: string;
  type: 'song' | 'video' | 'episode';
  likeStatus?: LikeStatus | null;
  views?: string;
  year?: string;
  playlistId?: string;
  isAvailable?: boolean;
  trackNumber?: number;
  /** episode page / non-music browse id */
  browseId?: string;
  rank?: string;
  trend?: 'up' | 'down' | 'neutral';
  menu?: MenuInfo;
  /** song <-> video counterpart from the watch queue */
  counterpart?: Track;
  /** from history: "Today", "Yesterday" ... */
  played?: string;
  description?: string;
  /** unique id inside the play queue */
  qid?: number;
  /** Spotify track id: played through its YouTube Music match */
  spotifyId?: string;
}

export interface Card {
  kind: 'card';
  type: ItemType;
  title: string;
  subtitle: string;
  thumbnails: Thumb[];
  browseId?: string;
  params?: string;
  playlistId?: string;
  videoId?: string;
  artists?: Ref[];
  explicit?: boolean;
  year?: string;
  wide?: boolean;
  color?: string;
  track?: Track;
  menu?: MenuInfo;
  rank?: string;
}

export type Item = Track | Card;

export interface Shelf {
  title: string;
  strapline?: string;
  /** "More"/"See all" target */
  more?: Endpoint;
  items: Item[];
  /** rendering hint */
  layout: 'cards' | 'tracks' | 'grid' | 'text';
  text?: string;
  /** subtitle/source line (eg. lyrics source / "views" for about) */
  subtext?: string;
  thumbnails?: Thumb[];
  continuation?: () => Promise<{ items: Item[]; continuation?: Paged['continuation'] }>;
}

export interface Paged<T = Item> {
  items: T[];
  continuation?: () => Promise<Paged<T>>;
}

export interface Chip {
  title: string;
  params?: string;
  browseId?: string;
  selected?: boolean;
}

export interface PageHeader {
  title: string;
  subtitle?: string;
  secondSubtitle?: string;
  description?: string;
  thumbnails: Thumb[];
  banner?: Thumb[];
  artists?: Ref[];
  author?: Ref | null;
  type?: string;
  year?: string;
  trackCount?: string;
  duration?: string;
  views?: string;
  subscribers?: string;
  monthlyListeners?: string;
  subscribed?: boolean;
  channelId?: string;
  playlistId?: string;
  audioPlaylistId?: string;
  shuffle?: Endpoint;
  radio?: Endpoint;
  saved?: boolean;
  owned?: boolean;
  privacy?: string;
  explicit?: boolean;
  likeStatus?: LikeStatus | null;
  editablePlaylistId?: string;
  collaborators?: string;
}

export interface BrowsePage {
  header?: PageHeader;
  shelves: Shelf[];
  tracks?: Track[];
  tracksMore?: () => Promise<Paged<Track>>;
  chips?: Chip[];
  more?: () => Promise<{ shelves: Shelf[]; more?: BrowsePage['more'] }>;
}

export interface Lyrics {
  text: string;
  source?: string;
  lines?: { start: number; end: number; text: string }[];
}

export interface Account {
  name: string;
  handle?: string;
  photo?: string;
  channelId?: string;
  brandId?: string; // onBehalfOfUser
  selected?: boolean;
  authUser?: number;
}
