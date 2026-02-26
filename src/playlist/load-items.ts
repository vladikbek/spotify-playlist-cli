import { apiUserGet } from "../client";
import { PlaylistItemNormalized } from "../types";

export type PlaylistMeta = {
  id: string;
  name?: string;
  description?: string;
  snapshot_id?: string;
  public?: boolean;
  collaborative?: boolean;
  owner?: { id?: string; display_name?: string };
  followers?: { total?: number };
  tracks?: { total?: number };
  images?: Array<{ url: string; width?: number | null; height?: number | null }>;
  external_urls?: { spotify?: string };
};

type LoadPlaylistItemsOptions = {
  playlistId: string;
  timeoutMs: number;
  account?: string;
  market?: string;
  limit?: number;
  offset?: number;
};

function normalizeItem(raw: any, index: number): PlaylistItemNormalized {
  const track = raw?.track;
  const kind =
    !track ? "unknown" : track.type === "track" ? "track" : track.type === "episode" ? "episode" : "unknown";

  const artists = Array.isArray(track?.artists)
    ? track.artists.map((x: any) => x?.name).filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
    : undefined;

  return {
    index,
    uri: typeof track?.uri === "string" ? track.uri : undefined,
    id: typeof track?.id === "string" ? track.id : undefined,
    kind,
    name: typeof track?.name === "string" ? track.name : undefined,
    artists,
    added_at: typeof raw?.added_at === "string" ? raw.added_at : undefined,
    popularity: typeof track?.popularity === "number" ? track.popularity : undefined,
    is_local: Boolean(raw?.is_local || track?.is_local),
    is_playable: typeof track?.is_playable === "boolean" ? track.is_playable : undefined,
    available_markets: Array.isArray(track?.available_markets)
      ? track.available_markets.filter((x: unknown): x is string => typeof x === "string")
      : undefined,
    raw
  };
}

export async function fetchPlaylistMetaUser(opts: {
  playlistId: string;
  timeoutMs: number;
  account?: string;
}): Promise<PlaylistMeta> {
  return apiUserGet<PlaylistMeta>(`/playlists/${opts.playlistId}`, {
    query: {
      fields:
        "id,name,description,snapshot_id,public,collaborative,owner(id,display_name),followers(total),tracks(total),images,external_urls(spotify)"
    },
    request: {
      timeoutMs: opts.timeoutMs,
      account: opts.account
    },
    auth: {
      mode: "user",
      account: opts.account
    }
  });
}

export async function loadPlaylistItemsUser(
  opts: LoadPlaylistItemsOptions
): Promise<{ items: PlaylistItemNormalized[]; total: number; next: string | null }> {
  const hardLimit = opts.limit ?? Infinity;
  const out: PlaylistItemNormalized[] = [];

  let offset = opts.offset ?? 0;
  let total = 0;
  let next: string | null = null;

  while (out.length < hardLimit) {
    const page = await apiUserGet<{ items: any[]; total: number; next: string | null }>(
      `/playlists/${opts.playlistId}/items`,
      {
        query: {
          market: opts.market,
          limit: Math.min(50, hardLimit - out.length),
          offset,
          additional_types: "track,episode",
          fields:
            "items(added_at,is_local,track(type,id,uri,name,popularity,is_playable,available_markets,is_local,artists(name))),total,next"
        },
        request: {
          timeoutMs: opts.timeoutMs,
          account: opts.account
        },
        auth: {
          mode: "user",
          account: opts.account
        }
      }
    );

    total = page.total ?? total;
    next = page.next ?? null;

    const normalized = (page.items || []).map((item, idx) => normalizeItem(item, offset + idx));
    out.push(...normalized);

    if (!next || (page.items || []).length === 0) {
      break;
    }

    offset += (page.items || []).length;
  }

  return {
    items: out,
    total,
    next
  };
}
