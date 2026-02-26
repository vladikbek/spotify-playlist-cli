import { apiUserRequest } from "../../client";
import { CommandResult } from "../../types";
import { appendPlaylistTracks, applyPlaylistPlan } from "../../playlist/apply";
import { decodePlaylistImport, encodePlaylistExport, writeMaybeFile } from "../../playlist/io";
import { fetchPlaylistMetaUser, loadPlaylistItemsUser } from "../../playlist/load-items";
import { parsePlaylistId } from "../../playlist/refs";
import { trackUrisFromItems } from "../../playlist/transform";
import { CliError } from "../../errors";
import { runPlaylistImportBase64Input } from "./manage-core";
import { actionSummaryHuman } from "./manage-mutations";

async function createPlaylistForCopy(opts: {
  name: string;
  description?: string;
  isPublic?: boolean;
  timeoutMs: number;
  account?: string;
}): Promise<{ id: string; name: string; spotify_url?: string }> {
  const created = await apiUserRequest<any>("/me/playlists", {
    method: "POST",
    body: {
      name: opts.name,
      description: opts.description,
      public: opts.isPublic,
      collaborative: false
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
    id: created.id,
    name: created.name,
    spotify_url: created.external_urls?.spotify
  };
}

export async function runPlaylistCopyManaged(
  sourceInput: string,
  opts: {
    to?: string;
    toNew?: boolean;
    name?: string;
    description?: string;
    mode?: "append" | "replace";
    isPublic?: boolean;
    apply?: boolean;
    force?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  const sourceId = parsePlaylistId(sourceInput);
  const sourceMeta = await fetchPlaylistMetaUser({
    playlistId: sourceId,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });
  const sourceItems = await loadPlaylistItemsUser({
    playlistId: sourceId,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });

  const sourceTrackSet = trackUrisFromItems(sourceItems.items);
  const warnings: string[] = [];
  if (sourceTrackSet.droppedEpisodes > 0) {
    warnings.push(`Dropped ${sourceTrackSet.droppedEpisodes} episode item(s) from source playlist.`);
  }

  if (opts.toNew) {
    if (!opts.name?.trim()) {
      throw new CliError("INVALID_USAGE", "--to-new requires --name.");
    }

    if (!opts.apply) {
      return {
        data: {
          source_playlist_id: sourceId,
          create_new: true,
          track_count: sourceTrackSet.uris.length,
          apply: false
        },
        human: [
          `Preview: create playlist '${opts.name}' with ${sourceTrackSet.uris.length} track(s) from '${sourceMeta.name ?? sourceId}'.`,
          "Re-run with --apply to create and copy."
        ],
        source: "api",
        warnings
      };
    }

    const created = await createPlaylistForCopy({
      name: opts.name,
      description: opts.description,
      isPublic: opts.isPublic,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    const snapshot = await appendPlaylistTracks({
      playlistId: created.id,
      uris: sourceTrackSet.uris,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    return {
      data: {
        source_playlist_id: sourceId,
        target_playlist_id: created.id,
        mode: "new",
        copied_tracks: sourceTrackSet.uris.length,
        snapshot_id: snapshot,
        spotify_url: created.spotify_url
      },
      human: [
        `Created playlist '${created.name}' (${created.id}) and copied ${sourceTrackSet.uris.length} track(s).`
      ],
      source: "api",
      warnings
    };
  }

  if (!opts.to) {
    throw new CliError("INVALID_USAGE", "Use --to <playlist> or --to-new.");
  }

  const targetId = parsePlaylistId(opts.to);
  const mode = opts.mode ?? "append";

  if (mode === "append") {
    if (!opts.apply) {
      return {
        data: {
          source_playlist_id: sourceId,
          target_playlist_id: targetId,
          mode,
          append_count: sourceTrackSet.uris.length,
          apply: false
        },
        human: [
          `Preview: append ${sourceTrackSet.uris.length} track(s) from '${sourceMeta.name ?? sourceId}' to ${targetId}.`,
          "Re-run with --apply to persist."
        ],
        source: "api",
        warnings
      };
    }

    const snapshot = await appendPlaylistTracks({
      playlistId: targetId,
      uris: sourceTrackSet.uris,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    return {
      data: {
        source_playlist_id: sourceId,
        target_playlist_id: targetId,
        mode,
        copied_tracks: sourceTrackSet.uris.length,
        snapshot_id: snapshot
      },
      human: [`Appended ${sourceTrackSet.uris.length} track(s) to ${targetId}.`],
      source: "api",
      warnings
    };
  }

  const targetMeta = await fetchPlaylistMetaUser({
    playlistId: targetId,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });
  const targetItems = await loadPlaylistItemsUser({
    playlistId: targetId,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });
  const before = trackUrisFromItems(targetItems.items);

  const result = await applyPlaylistPlan({
    action: "copy:replace",
    playlistId: targetId,
    beforeUris: before.uris,
    desiredUris: sourceTrackSet.uris,
    droppedEpisodes: before.droppedEpisodes + sourceTrackSet.droppedEpisodes,
    apply: Boolean(opts.apply),
    force: Boolean(opts.force),
    timeoutMs: opts.timeoutMs,
    account: opts.account,
    snapshotId: targetMeta.snapshot_id
  });

  return {
    data: {
      source_playlist_id: sourceId,
      target_playlist_id: targetId,
      mode,
      result
    },
    human: actionSummaryHuman({
      action: "copy:replace",
      name: targetMeta.name,
      result
    }),
    source: "api",
    warnings
  };
}

export async function runPlaylistExportManaged(
  input: string,
  opts: {
    out?: string;
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
  const loaded = await loadPlaylistItemsUser({
    playlistId: id,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });

  const tracks = trackUrisFromItems(loaded.items);
  const payload = {
    version: 2 as const,
    kind: "spm-playlist-tracks" as const,
    source: {
      id,
      name: meta.name,
      exported_at: Math.floor(Date.now() / 1000)
    },
    tracks: tracks.uris
  };

  const base64 = encodePlaylistExport(payload);
  const outPath = writeMaybeFile(opts.out, base64);

  return {
    data: {
      playlist_id: id,
      playlist_name: meta.name,
      tracks: tracks.uris.length,
      dropped_episodes: tracks.droppedEpisodes,
      out: outPath,
      base64
    },
    human: outPath ? [`Exported ${tracks.uris.length} track(s) to ${outPath}.`] : [base64],
    source: "api",
    warnings: tracks.droppedEpisodes > 0 ? [`Dropped ${tracks.droppedEpisodes} episode item(s).`] : undefined
  };
}

export async function runPlaylistImportManaged(
  rawInput: string,
  opts: {
    to?: string;
    toNew?: boolean;
    name?: string;
    description?: string;
    mode?: "append" | "replace";
    isPublic?: boolean;
    noInput: boolean;
    apply?: boolean;
    force?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  const encoded = await runPlaylistImportBase64Input(rawInput, opts.noInput);
  const payload = decodePlaylistImport(encoded);

  if (opts.toNew) {
    if (!opts.name?.trim()) {
      throw new CliError("INVALID_USAGE", "--to-new requires --name.");
    }

    if (!opts.apply) {
      return {
        data: {
          create_new: true,
          track_count: payload.tracks.length,
          apply: false
        },
        human: [
          `Preview: create playlist '${opts.name}' and import ${payload.tracks.length} track(s).`,
          "Re-run with --apply to persist."
        ],
        source: "api"
      };
    }

    const created = await createPlaylistForCopy({
      name: opts.name,
      description: opts.description,
      isPublic: opts.isPublic,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    const snapshot = await appendPlaylistTracks({
      playlistId: created.id,
      uris: payload.tracks,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    return {
      data: {
        target_playlist_id: created.id,
        mode: "new",
        imported_tracks: payload.tracks.length,
        snapshot_id: snapshot,
        spotify_url: created.spotify_url
      },
      human: [`Created playlist '${created.name}' and imported ${payload.tracks.length} track(s).`],
      source: "api"
    };
  }

  if (!opts.to) {
    throw new CliError("INVALID_USAGE", "Use --to <playlist> or --to-new.");
  }

  const targetId = parsePlaylistId(opts.to);
  const mode = opts.mode ?? "append";

  if (mode === "append") {
    if (!opts.apply) {
      return {
        data: {
          target_playlist_id: targetId,
          mode,
          append_count: payload.tracks.length,
          apply: false
        },
        human: [
          `Preview: append ${payload.tracks.length} track(s) to ${targetId}.`,
          "Re-run with --apply to persist."
        ],
        source: "api"
      };
    }

    const snapshot = await appendPlaylistTracks({
      playlistId: targetId,
      uris: payload.tracks,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    return {
      data: {
        target_playlist_id: targetId,
        mode,
        imported_tracks: payload.tracks.length,
        snapshot_id: snapshot
      },
      human: [`Imported ${payload.tracks.length} track(s) into ${targetId}.`],
      source: "api"
    };
  }

  const targetMeta = await fetchPlaylistMetaUser({
    playlistId: targetId,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });
  const targetItems = await loadPlaylistItemsUser({
    playlistId: targetId,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });
  const before = trackUrisFromItems(targetItems.items);

  const result = await applyPlaylistPlan({
    action: "import:replace",
    playlistId: targetId,
    beforeUris: before.uris,
    desiredUris: payload.tracks,
    droppedEpisodes: before.droppedEpisodes,
    apply: Boolean(opts.apply),
    force: Boolean(opts.force),
    timeoutMs: opts.timeoutMs,
    account: opts.account,
    snapshotId: targetMeta.snapshot_id
  });

  return {
    data: {
      target_playlist_id: targetId,
      mode,
      result
    },
    human: actionSummaryHuman({
      action: "import:replace",
      name: targetMeta.name,
      result
    }),
    source: "api"
  };
}
