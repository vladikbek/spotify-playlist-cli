export type Market = string | undefined;

export type CliSource = "api" | "embed" | "experimental";

export type CommandResult<TData = unknown, TRaw = unknown> = {
  data: TData;
  human: string[];
  raw?: TRaw;
  source?: CliSource;
  market?: string;
  warnings?: string[];
};

export type GlobalOptions = {
  json: boolean;
  raw: boolean;
  quiet: boolean;
  verbose: boolean;
  noColor: boolean;
  noInput: boolean;
  timeoutMs: number;
  market?: string;
  account?: string;
};

export type RequestContext = {
  timeoutMs: number;
  account?: string;
};

export type SpotifyRefType = "track" | "album" | "artist" | "playlist" | "user";

export type ParsedSpotifyRef = {
  id: string;
  type?: SpotifyRefType;
};

export type AccountTokenState = {
  access_token: string;
  token_type: "Bearer";
  expires_at: number;
  refresh_token: string;
};

export type AccountBundleV2 = {
  version: 2;
  id: string;
  name: string;
  display_name?: string;
  scopes: string[];
  token: AccountTokenState;
  source: "oauth" | "import";
  created_at: number;
  updated_at: number;
};

export type AccountStoreV2 = {
  version: 2;
  active_account_id?: string;
  accounts: AccountBundleV2[];
};

export type PlaylistItemKind = "track" | "episode" | "unknown";

export type PlaylistItemNormalized = {
  index: number;
  uri?: string;
  id?: string;
  kind: PlaylistItemKind;
  name?: string;
  artists?: string[];
  added_at?: string;
  popularity?: number;
  is_local: boolean;
  is_playable?: boolean;
  available_markets?: string[];
  raw: unknown;
};

export type PlaylistMutationPreview = {
  action: string;
  playlist_id: string;
  before_count: number;
  after_count: number;
  changed: boolean;
  removed: number;
  dropped_episodes: number;
};

export type PlaylistApplyResult = PlaylistMutationPreview & {
  applied: boolean;
  snapshot_id?: string;
};
