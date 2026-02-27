import { apiUserRequest } from "../../client";
import { CliError } from "../../errors";
import { CommandResult, Market } from "../../types";
import { appendPlaylistTracks, applyPlaylistPlan } from "../../playlist/apply";
import { generateTrackPool } from "../../playlist/generate";
import { fetchPlaylistMetaUser, loadPlaylistItemsUser } from "../../playlist/load-items";
import { parsePlaylistId, parseTrackUrisInput } from "../../playlist/refs";
import { trackUrisFromItems } from "../../playlist/transform";

async function createPlaylist(opts: {
  name: string;
  description?: string | null;
  isPublic?: boolean;
  timeoutMs: number;
  account?: string;
}): Promise<{ id: string; name: string; spotify_url?: string }> {
  const created = await apiUserRequest<any>("/me/playlists", {
    method: "POST",
    body: {
      name: opts.name,
      description: opts.description ?? undefined,
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

export async function runPlaylistGenerateManaged(
  seedInput: string,
  opts: {
    targetSize: number;
    to?: string;
    toNew?: boolean;
    name?: string;
    description?: string | null;
    mode?: "append" | "replace";
    isPublic?: boolean;
    minPopularity: number;
    maxDurationMs: number;
    excludeTrackUris?: string[];
    seedProfile: boolean;
    diversifyKeys: boolean;
    maxKeySharePercent: number;
    apply?: boolean;
    force?: boolean;
    noInput: boolean;
    market?: Market;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  const hasTo = Boolean(opts.to);
  const hasToNew = Boolean(opts.toNew);
  if (hasTo === hasToNew) {
    throw new CliError("INVALID_USAGE", "Use exactly one target: --to <playlist> or --to-new.");
  }

  if (opts.mode && !hasTo) {
    throw new CliError("INVALID_USAGE", "--mode is valid only with --to.");
  }

  if (opts.force && !(hasTo && opts.mode === "replace")) {
    throw new CliError("INVALID_USAGE", "--force is valid only with --to ... --mode replace.");
  }

  if (hasToNew && !opts.name?.trim()) {
    throw new CliError("INVALID_USAGE", "--to-new requires --name.");
  }

  const seedTrackUris = await parseTrackUrisInput(seedInput, {
    noInput: opts.noInput
  });

  const excludeTrackUris = opts.excludeTrackUris ? [...opts.excludeTrackUris] : [];
  const minPopularity = opts.minPopularity ?? 30;
  const maxDurationMs = opts.maxDurationMs ?? 240000;
  const seedProfile = opts.seedProfile ?? true;
  const diversifyKeys = opts.diversifyKeys ?? true;
  const maxKeySharePercent = opts.maxKeySharePercent ?? 25;

  if (!diversifyKeys && maxKeySharePercent !== 25) {
    throw new CliError("INVALID_USAGE", "--max-key-share is only applicable with --diversify-keys.");
  }

  if (!Number.isInteger(minPopularity) || minPopularity < 0 || minPopularity > 100) {
    throw new CliError("INVALID_USAGE", "min-popularity must be an integer between 0 and 100.");
  }

  if (!Number.isInteger(maxDurationMs) || maxDurationMs <= 0) {
    throw new CliError("INVALID_USAGE", "max-duration-ms must be a positive integer.");
  }

  if (!Number.isInteger(maxKeySharePercent) || maxKeySharePercent < 1 || maxKeySharePercent > 100) {
    throw new CliError("INVALID_USAGE", "max-key-share must be an integer between 1 and 100.");
  }

  const generated = await generateTrackPool({
    seedTrackUris,
    targetSize: opts.targetSize,
    market: opts.market,
    minPopularity,
    maxDurationMs,
    excludeTrackUris,
    seedProfileEnabled: seedProfile,
    diversifyKeys,
    maxKeySharePercent,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });

  const baseData = {
    seed_count: generated.seedCount,
    target_size: opts.targetSize,
    generated_count: generated.generatedCount,
    shortfall: generated.shortfall,
    filtered_count: generated.filteredCount,
    track_uris: generated.trackUris,
    apply: Boolean(opts.apply),
    filter_config: {
      min_popularity: minPopularity,
      max_duration_ms: maxDurationMs,
      seed_profile: seedProfile,
      diversify_keys: diversifyKeys,
      max_key_share: maxKeySharePercent,
      excluded: excludeTrackUris.length
    },
    filter_stats: generated.filterStats
  };

  if (hasToNew) {
    if (!opts.apply) {
      return {
        data: {
          ...baseData,
          target: "new"
        },
        human: [
          `Preview: create playlist '${opts.name}' with ${generated.generatedCount} generated track(s).`,
          "Re-run with --apply to create and fill playlist."
        ],
        source: "api",
        warnings: generated.warnings
      };
    }

    const created = await createPlaylist({
      name: opts.name!,
      description: opts.description,
      isPublic: opts.isPublic,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    const snapshotId = await appendPlaylistTracks({
      playlistId: created.id,
      uris: generated.trackUris,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    return {
      data: {
        ...baseData,
        target: "new",
        playlist_id: created.id,
        snapshot_id: snapshotId
      },
      human: [
        `Created playlist '${created.name}' (${created.id}) with ${generated.generatedCount} track(s).`,
        `Spotify URL: ${created.spotify_url ?? "n/a"}`
      ],
      source: "api",
      warnings: generated.warnings
    };
  }

  const playlistId = parsePlaylistId(opts.to!);
  const mode = opts.mode ?? "append";

  if (mode === "append") {
    if (!opts.apply) {
      return {
        data: {
          ...baseData,
          target: "existing",
          playlist_id: playlistId
        },
        human: [
          `Preview: append ${generated.generatedCount} generated track(s) to ${playlistId}.`,
          "Re-run with --apply to append."
        ],
        source: "api",
        warnings: generated.warnings
      };
    }

    const snapshotId = await appendPlaylistTracks({
      playlistId,
      uris: generated.trackUris,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    return {
      data: {
        ...baseData,
        target: "existing",
        playlist_id: playlistId,
        snapshot_id: snapshotId
      },
      human: [`Appended ${generated.generatedCount} generated track(s) to ${playlistId}.`],
      source: "api",
      warnings: generated.warnings
    };
  }

  const meta = await fetchPlaylistMetaUser({
    playlistId,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });
  const loaded = await loadPlaylistItemsUser({
    playlistId,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });
  const before = trackUrisFromItems(loaded.items);

  const replaceResult = await applyPlaylistPlan({
    action: "generate:replace",
    playlistId,
    beforeUris: before.uris,
    desiredUris: generated.trackUris,
    droppedEpisodes: before.droppedEpisodes,
    apply: Boolean(opts.apply),
    force: Boolean(opts.force),
    timeoutMs: opts.timeoutMs,
    account: opts.account,
    snapshotId: meta.snapshot_id
  });

  return {
    data: {
      ...baseData,
      target: "existing",
      playlist_id: playlistId,
      snapshot_id: replaceResult.snapshot_id,
      result: replaceResult
    },
    human: [
      `Generate replace: ${meta.name ?? playlistId}`,
      `Before: ${replaceResult.before_count}`,
      `After: ${replaceResult.after_count}`,
      `Changed: ${replaceResult.changed ? "Yes" : "No"}`,
      `Applied: ${replaceResult.applied ? "Yes" : "No"}`
    ],
    source: "api",
    warnings: generated.warnings
  };
}
