import { apiUserGet, apiUserRequest } from "../client";
import { CliError } from "../errors";
import { PlaylistApplyResult } from "../types";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function assertPlaylistSnapshotUnchanged(opts: {
  playlistId: string;
  expectedSnapshot?: string;
  timeoutMs: number;
  account?: string;
}): Promise<void> {
  if (!opts.expectedSnapshot) return;

  const current = await apiUserGet<{ snapshot_id?: string }>(`/playlists/${opts.playlistId}`, {
    query: {
      fields: "snapshot_id"
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

  if (current.snapshot_id && current.snapshot_id !== opts.expectedSnapshot) {
    throw new CliError("INVALID_USAGE", "Playlist was modified since preview was generated.", {
      hint: "Re-run preview or pass --force to bypass snapshot guard."
    });
  }
}

export async function replacePlaylistTracks(opts: {
  playlistId: string;
  uris: string[];
  timeoutMs: number;
  account?: string;
}): Promise<string | undefined> {
  const parts = chunk(opts.uris, 100);

  const requestCtx = {
    request: {
      timeoutMs: opts.timeoutMs,
      account: opts.account
    },
    auth: {
      mode: "user" as const,
      account: opts.account
    }
  };

  if (parts.length === 0) {
    const replaced = await apiUserRequest<{ snapshot_id?: string }>(`/playlists/${opts.playlistId}/items`, {
      method: "PUT",
      body: { uris: [] },
      ...requestCtx
    });
    return replaced.snapshot_id;
  }

  let snapshot = (
    await apiUserRequest<{ snapshot_id?: string }>(`/playlists/${opts.playlistId}/items`, {
      method: "PUT",
      body: { uris: parts[0] },
      ...requestCtx
    })
  ).snapshot_id;

  for (let i = 1; i < parts.length; i += 1) {
    const added = await apiUserRequest<{ snapshot_id?: string }>(`/playlists/${opts.playlistId}/items`, {
      method: "POST",
      body: { uris: parts[i] },
      ...requestCtx
    });
    snapshot = added.snapshot_id ?? snapshot;
  }

  return snapshot;
}

export async function appendPlaylistTracks(opts: {
  playlistId: string;
  uris: string[];
  timeoutMs: number;
  account?: string;
  position?: number;
}): Promise<string | undefined> {
  const parts = chunk(opts.uris, 100);
  let snapshot: string | undefined;
  let position = opts.position;

  for (const part of parts) {
    const added = await apiUserRequest<{ snapshot_id?: string }>(`/playlists/${opts.playlistId}/items`, {
      method: "POST",
      body: {
        uris: part,
        position
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

    snapshot = added.snapshot_id ?? snapshot;
    if (position !== undefined) {
      position += part.length;
    }
  }

  return snapshot;
}

export async function applyPlaylistPlan(opts: {
  action: string;
  playlistId: string;
  beforeUris: string[];
  desiredUris: string[];
  droppedEpisodes: number;
  apply: boolean;
  force?: boolean;
  timeoutMs: number;
  account?: string;
  snapshotId?: string;
}): Promise<PlaylistApplyResult> {
  const changed =
    opts.beforeUris.length !== opts.desiredUris.length ||
    opts.beforeUris.some((uri, idx) => uri !== opts.desiredUris[idx]);

  const preview: PlaylistApplyResult = {
    action: opts.action,
    playlist_id: opts.playlistId,
    before_count: opts.beforeUris.length,
    after_count: opts.desiredUris.length,
    removed: Math.max(0, opts.beforeUris.length - opts.desiredUris.length),
    dropped_episodes: opts.droppedEpisodes,
    changed,
    applied: false
  };

  if (!opts.apply || !changed) {
    return preview;
  }

  if (!opts.force) {
    await assertPlaylistSnapshotUnchanged({
      playlistId: opts.playlistId,
      expectedSnapshot: opts.snapshotId,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });
  }

  const snapshot = await replacePlaylistTracks({
    playlistId: opts.playlistId,
    uris: opts.desiredUris,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });

  return {
    ...preview,
    applied: true,
    snapshot_id: snapshot
  };
}
