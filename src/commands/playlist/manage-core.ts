import fs from "node:fs";
import { apiUserGet, apiUserRequest } from "../../client";
import { CommandResult, Market } from "../../types";
import { parsePlaylistId } from "../../playlist/refs";
import { fetchPlaylistMetaUser, loadPlaylistItemsUser } from "../../playlist/load-items";
import { appendPlaylistTracks } from "../../playlist/apply";
import { parseTrackUrisInput } from "../../playlist/refs";
import { CliError } from "../../errors";
import { fmtNumber, pickImageUrl, pushKv } from "../../format";
import { readStdinTextOrThrow } from "../../stdin";

export async function runPlaylistGetManaged(
  input: string,
  opts: {
    tracks?: boolean;
    limit?: number;
    offset?: number;
    market?: Market;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  const id = parsePlaylistId(input);
  const meta = await fetchPlaylistMetaUser({
    playlistId: id,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });

  const items = opts.tracks
    ? await loadPlaylistItemsUser({
        playlistId: id,
        timeoutMs: opts.timeoutMs,
        account: opts.account,
        market: opts.market,
        limit: opts.limit,
        offset: opts.offset
      })
    : null;

  const img = pickImageUrl(meta.images ?? []);

  const data = {
    id,
    name: meta.name,
    description: meta.description,
    owner: meta.owner,
    followers: meta.followers?.total,
    total_tracks: meta.tracks?.total,
    public: meta.public,
    collaborative: meta.collaborative,
    snapshot_id: meta.snapshot_id,
    cover: img.url640 ?? img.url300 ?? img.url64,
    spotify_url: meta.external_urls?.spotify ?? `https://open.spotify.com/playlist/${id}`,
    tracks: items
      ? items.items.map((item) => ({
          index: item.index,
          kind: item.kind,
          uri: item.uri,
          id: item.id,
          name: item.name,
          artists: item.artists,
          added_at: item.added_at,
          popularity: item.popularity,
          is_playable: item.is_playable,
          is_local: item.is_local
        }))
      : undefined
  };

  const human: string[] = [];
  pushKv(human, "Playlist", meta.name);
  if (meta.owner) {
    pushKv(human, "Owner", `${meta.owner.display_name ?? ""} (${meta.owner.id ?? ""})`.trim());
  }
  pushKv(human, "Followers", meta.followers?.total !== undefined ? fmtNumber(meta.followers.total) : undefined);
  pushKv(human, "Total Tracks", meta.tracks?.total);
  pushKv(human, "Public", meta.public === undefined ? undefined : meta.public ? "Yes" : "No");
  pushKv(human, "Collaborative", meta.collaborative === undefined ? undefined : meta.collaborative ? "Yes" : "No");
  pushKv(human, "Description", meta.description);
  pushKv(human, "Cover", img.url640 ?? img.url300 ?? img.url64);
  pushKv(human, "Spotify URL", data.spotify_url);

  if (items) {
    human.push("");
    human.push(`Items (showing ${items.items.length}):`);
    for (const item of items.items) {
      const idx = item.index + 1;
      if (!item.uri || !item.name) {
        human.push(` ${idx}. [unavailable]`);
        continue;
      }
      const artists = item.artists?.join(", ") || "";
      const added = item.added_at ? ` (added ${item.added_at.slice(0, 10)})` : "";
      human.push(` ${idx}. ${item.name}${artists ? ` - ${artists}` : ""}${added}`);
    }
  }

  return {
    data,
    human,
    source: "api",
    market: opts.market
  };
}

export async function runPlaylistListManaged(opts: {
  all?: boolean;
  limit?: number;
  offset?: number;
  timeoutMs: number;
  account?: string;
}): Promise<CommandResult> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  let offset = Math.max(0, opts.offset ?? 0);

  const allItems: any[] = [];

  while (true) {
    const page = await apiUserGet<{ items: any[]; total: number; next: string | null }>("/me/playlists", {
      query: {
        limit: opts.all ? 50 : limit,
        offset
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

    allItems.push(...(page.items ?? []));
    if (!opts.all || !page.next || (page.items ?? []).length === 0) {
      break;
    }
    offset += (page.items ?? []).length;
  }

  const items = allItems.map((p) => ({
    id: p.id,
    name: p.name,
    owner: p.owner ? { id: p.owner.id, display_name: p.owner.display_name } : undefined,
    total_tracks: p.tracks?.total,
    public: p.public,
    collaborative: p.collaborative,
    snapshot_id: p.snapshot_id,
    spotify_url: p.external_urls?.spotify
  }));

  const human: string[] = [`Playlists: ${items.length}`];
  let i = 0;
  for (const p of items) {
    i += 1;
    const owner = p.owner?.display_name || p.owner?.id || "";
    human.push(` ${i}. ${p.name} | by ${owner} | ${p.total_tracks ?? 0} tracks`);
  }

  return {
    data: {
      count: items.length,
      items
    },
    human,
    source: "api"
  };
}

export async function runPlaylistCreateManaged(opts: {
  name: string;
  description?: string;
  public?: boolean;
  collaborative?: boolean;
  timeoutMs: number;
  account?: string;
}): Promise<CommandResult> {
  const name = opts.name.trim();
  if (!name) {
    throw new CliError("INVALID_USAGE", "Playlist name cannot be empty.");
  }
  if (opts.collaborative && opts.public !== false) {
    throw new CliError("INVALID_USAGE", "Collaborative playlists must be private.", {
      hint: "Use --private together with --collaborative."
    });
  }

  const created = await apiUserRequest<any>("/me/playlists", {
    method: "POST",
    body: {
      name,
      description: opts.description,
      public: opts.public,
      collaborative: opts.collaborative
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

  const data = {
    id: created.id,
    name: created.name,
    description: created.description,
    public: created.public,
    collaborative: created.collaborative,
    spotify_url: created.external_urls?.spotify
  };

  const human: string[] = [];
  pushKv(human, "Created", `${data.name} (${data.id})`);
  pushKv(human, "Public", data.public ? "Yes" : "No");
  pushKv(human, "Collaborative", data.collaborative ? "Yes" : "No");
  pushKv(human, "Spotify URL", data.spotify_url);

  return {
    data,
    human,
    source: "api"
  };
}

export async function runPlaylistUpdateManaged(
  input: string,
  opts: {
    name?: string;
    description?: string;
    public?: boolean;
    collaborative?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  const id = parsePlaylistId(input);
  const body: Record<string, unknown> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.public !== undefined) body.public = opts.public;
  if (opts.collaborative !== undefined) body.collaborative = opts.collaborative;

  if (Object.keys(body).length === 0) {
    throw new CliError("INVALID_USAGE", "Nothing to update.", {
      hint: "Use one or more of --name, --description, --public/--private, --collaborative/--no-collaborative."
    });
  }

  if (opts.collaborative === true && opts.public !== false) {
    throw new CliError("INVALID_USAGE", "Collaborative playlists must be private.", {
      hint: "Set --private when using --collaborative."
    });
  }

  await apiUserRequest(`/playlists/${id}`, {
    method: "PUT",
    body,
    request: {
      timeoutMs: opts.timeoutMs,
      account: opts.account
    },
    auth: {
      mode: "user",
      account: opts.account
    }
  });

  return {
    data: {
      id,
      updated: body
    },
    human: [`Updated playlist: ${id}`],
    source: "api"
  };
}

export async function runPlaylistAddManaged(
  playlistInput: string,
  trackRefsInput: string,
  opts: {
    pos: number;
    noInput: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  const id = parsePlaylistId(playlistInput);
  const trackUris = await parseTrackUrisInput(trackRefsInput, {
    noInput: opts.noInput
  });

  if (!Number.isInteger(opts.pos) || opts.pos < 1) {
    throw new CliError("INVALID_USAGE", "--pos must be a positive 1-based integer.");
  }

  const snapshot = await appendPlaylistTracks({
    playlistId: id,
    uris: trackUris,
    position: opts.pos - 1,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });

  return {
    data: {
      playlist_id: id,
      inserted_count: trackUris.length,
      position: opts.pos,
      snapshot_id: snapshot
    },
    human: [`Inserted ${trackUris.length} track(s) at position ${opts.pos}.`],
    source: "api"
  };
}

export async function runPlaylistCoverGetManaged(
  playlistInput: string,
  opts: { timeoutMs: number; account?: string }
): Promise<CommandResult> {
  const id = parsePlaylistId(playlistInput);
  const images = await apiUserGet<Array<{ url: string; width?: number | null; height?: number | null }>>(
    `/playlists/${id}/images`,
    {
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

  const img = pickImageUrl(images || []);
  const data = {
    playlist_id: id,
    images: images || [],
    best: img.url640 ?? img.url300 ?? img.url64
  };

  const human: string[] = [];
  pushKv(human, "Playlist", id);
  pushKv(human, "Best Cover", data.best);
  for (const url of img.all) {
    human.push(` - ${url}`);
  }

  return {
    data,
    human,
    source: "api"
  };
}

function base64FromCoverInput(opts: { file?: string; base64?: string }): string {
  if (!opts.file && !opts.base64) {
    throw new CliError("INVALID_USAGE", "Use --file <jpg> or --base64 <data>.");
  }
  if (opts.file && opts.base64) {
    throw new CliError("INVALID_USAGE", "Use either --file or --base64, not both.");
  }

  const raw = opts.file
    ? fs.readFileSync(opts.file)
    : Buffer.from(opts.base64!.trim(), "base64");

  const encoded = raw.toString("base64");
  const size = Buffer.byteLength(encoded, "utf8");
  if (size > 256 * 1024) {
    throw new CliError("INVALID_USAGE", "Playlist cover payload exceeds 256KB base64 limit.");
  }
  return encoded;
}

export async function runPlaylistCoverSetManaged(
  playlistInput: string,
  opts: {
    file?: string;
    base64?: string;
    apply?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  const id = parsePlaylistId(playlistInput);
  const encoded = base64FromCoverInput({ file: opts.file, base64: opts.base64 });

  const data = {
    playlist_id: id,
    apply: Boolean(opts.apply),
    payload_bytes: Buffer.byteLength(encoded, "utf8")
  };

  if (!opts.apply) {
    return {
      data,
      human: [
        `Preview only. Cover payload for playlist ${id} is ready (${data.payload_bytes} bytes).`,
        "Re-run with --apply to upload."
      ],
      source: "api"
    };
  }

  await apiUserRequest(`/playlists/${id}/images`, {
    method: "PUT",
    rawBody: encoded,
    headers: {
      "Content-Type": "image/jpeg"
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

  return {
    data: {
      ...data,
      applied: true
    },
    human: [`Uploaded custom cover for playlist ${id}.`],
    source: "api"
  };
}

export async function runPlaylistImportBase64Input(raw: string, noInput: boolean): Promise<string> {
  if (raw !== "-") return raw;
  return readStdinTextOrThrow(noInput, "Pipe base64 payload to stdin or pass it as an argument.");
}
