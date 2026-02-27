import { CliError } from "../errors";
import {
  fetchRecommendationsBySeedTracks,
  RecommendationTrack,
  RecommendationTrackFetcherOptions,
  fetchTrackAudioFeatures,
  resolveSeedProfile
} from "./recommend";

function uniqueOrdered(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export type RecommendationFetcher = (opts: RecommendationTrackFetcherOptions) => Promise<{
  tracks?: RecommendationTrack[];
  uris?: string[];
  warnings?: string[];
}>;

function parseFilterKey(input?: string): string {
  return input === undefined ? "" : input.trim().toLowerCase();
}

function toNumberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export type GenerateResult = {
  seedCount: number;
  generatedCount: number;
  shortfall: number;
  trackUris: string[];
  warnings: string[];
  filteredCount: number;
  filterStats: {
    source_filter: {
      dropped_noname: number;
      dropped_excluded: number;
      dropped_unplayable: number;
      dropped_market: number;
      dropped_popularity: number;
      dropped_duration: number;
    };
    key_diversity: {
      enabled: boolean;
      dropped_by_key: number;
      key_cap: number;
      disabled_by_api: boolean;
    };
    seed_profile: {
      enabled: boolean;
      used: boolean;
    };
    stagnation_by_filters: number;
  };
};

function isUnavailableEndpointError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if ((err as Error & { code?: string }).name !== "CliError") return false;
  const e = err as unknown as { code?: string; details?: unknown };
  if (e.code !== "SPOTIFY_API") return false;
  const status = Number((e.details as { status?: number } | undefined)?.status);
  return status === 403 || status === 404;
}

export async function generateTrackPool(opts: {
  seedTrackUris: string[];
  targetSize: number;
  market?: string;
  minPopularity: number;
  maxDurationMs: number;
  excludeTrackUris?: string[];
  seedProfileEnabled?: boolean;
  diversifyKeys?: boolean;
  maxKeySharePercent?: number;
  timeoutMs: number;
  account?: string;
  maxRounds?: number;
  stagnationLimit?: number;
  fetcher?: RecommendationFetcher;
}): Promise<GenerateResult> {
  if (!Number.isInteger(opts.targetSize) || opts.targetSize < 1 || opts.targetSize > 100) {
    throw new CliError("INVALID_USAGE", "--target-size must be an integer between 1 and 100.");
  }

  if (!Number.isInteger(opts.minPopularity) || opts.minPopularity < 0 || opts.minPopularity > 100) {
    throw new CliError("INVALID_USAGE", "--min-popularity must be an integer between 0 and 100.");
  }

  if (!Number.isInteger(opts.maxDurationMs) || opts.maxDurationMs <= 0) {
    throw new CliError("INVALID_USAGE", "--max-duration-ms must be a positive integer.");
  }

  const maxKeySharePercent = opts.maxKeySharePercent ?? 25;
  if (!Number.isInteger(maxKeySharePercent) || maxKeySharePercent < 1 || maxKeySharePercent > 100) {
    throw new CliError("INVALID_USAGE", "--max-key-share must be an integer between 1 and 100.");
  }

  if (opts.seedTrackUris.length < 3 || opts.seedTrackUris.length > 5) {
    throw new CliError("INVALID_USAGE", "Provide 3 to 5 seed tracks.");
  }

  const uniqueSeeds = uniqueOrdered(opts.seedTrackUris);
  if (uniqueSeeds.length < 3) {
    throw new CliError("INVALID_USAGE", "Provide at least 3 unique seed tracks.");
  }

  const warnings: string[] = [];
  const droppedSeedDuplicates = opts.seedTrackUris.length - uniqueSeeds.length;
  if (droppedSeedDuplicates > 0) {
    warnings.push(`Dropped ${droppedSeedDuplicates} duplicate seed track(s).`);
  }

  const exclude = new Set(opts.excludeTrackUris ?? []);
  const excludeCount = exclude.size;
  if (excludeCount > 0) {
    warnings.push(`Exclude list size: ${excludeCount}`);
  }

  const maxRounds = opts.maxRounds ?? 8;
  const stagnationLimit = opts.stagnationLimit ?? 2;

  const keyCap = Math.max(1, Math.ceil((opts.targetSize * maxKeySharePercent) / 100));

  const seedProfileEnabled = opts.seedProfileEnabled ?? true;
  const diversifyKeys = opts.diversifyKeys ?? true;
  const filterStats: GenerateResult["filterStats"] = {
    source_filter: {
      dropped_noname: 0,
      dropped_excluded: 0,
      dropped_unplayable: 0,
      dropped_market: 0,
      dropped_popularity: 0,
      dropped_duration: 0
    },
    key_diversity: {
      enabled: diversifyKeys,
      dropped_by_key: 0,
      key_cap: keyCap,
      disabled_by_api: false
    },
    seed_profile: {
      enabled: seedProfileEnabled,
      used: false
    },
    stagnation_by_filters: 0
  };

  const result = uniqueSeeds.slice(0, opts.targetSize);
  const seen = new Set<string>(result);

  const fetcher: RecommendationFetcher = opts.fetcher ?? ((options) => {
    return fetchRecommendationsBySeedTracks(options);
  });

  let seedProfileQuery: Record<string, number> = {};
  if (seedProfileEnabled) {
    const profile = await resolveSeedProfile({
      seedTrackUris: uniqueSeeds,
      minPopularity: opts.minPopularity,
      timeoutMs: opts.timeoutMs,
      account: opts.account
    });

    filterStats.seed_profile.used = profile.used;
    if (!profile.used) {
      warnings.push("seed_profile: disabled fallback; using quality filters only.");
    }
    seedProfileQuery = profile.query;
    warnings.push(...profile.warnings);
  }

  const keyCounts = new Map<string, number>();
  const keyByUri = new Map<string, number>();
  let disableKeyDiversity = !diversifyKeys;

  if (diversifyKeys) {
    try {
      const seedKeys = await fetchTrackAudioFeatures({
        trackUris: uniqueSeeds,
        timeoutMs: opts.timeoutMs,
        account: opts.account
      });
      for (const uri of uniqueSeeds) {
        const key = seedKeys.get(uri)?.key;
        if (typeof key === "number") {
          const keyId = String(key);
          keyByUri.set(uri, key);
          keyCounts.set(keyId, (keyCounts.get(keyId) ?? 0) + 1);
        }
      }
      if (keyCounts.size > 0) {
        warnings.push("key_diversity: initialized from seed key profile.");
      }
    } catch (err) {
      if (isUnavailableEndpointError(err)) {
        disableKeyDiversity = true;
        filterStats.key_diversity.disabled_by_api = true;
        filterStats.key_diversity.enabled = false;
        warnings.push("key_diversity: disabled because audio-features is unavailable.");
      } else {
        throw err;
      }
    }
  } else {
    filterStats.key_diversity.enabled = false;
  }

  let roundSeeds = uniqueSeeds.slice(0, 5);
  let staleRounds = 0;

  for (let round = 0; round < maxRounds && result.length < opts.targetSize; round += 1) {
    const rec = await fetcher({
      seedTrackUris: roundSeeds,
      limit: 100,
      market: opts.market,
      timeoutMs: opts.timeoutMs,
      account: opts.account,
      minPopularity: opts.minPopularity,
      maxDurationMs: opts.maxDurationMs,
      seedProfileQuery: seedProfileEnabled ? seedProfileQuery : undefined
    });

    if (rec.warnings && rec.warnings.length > 0) {
      warnings.push(...rec.warnings.map((line) => `recommendation: ${line}`));
    }

    const candidates: RecommendationTrack[] = rec.tracks
      ? rec.tracks
      : (rec.uris ?? [])
          .map((uri) => ({
            uri,
            id: uri
          }))
          .filter((item): item is RecommendationTrack => Boolean(item.uri));

    const filteredCandidates: RecommendationTrack[] = [];
    const filterMarket = opts.market ? parseFilterKey(opts.market) : undefined;

    for (const candidate of candidates) {
      const uri = candidate.uri;
      if (seen.has(uri)) {
        continue;
      }
      if (!candidate.name || candidate.name.trim().length === 0) {
        filterStats.source_filter.dropped_noname += 1;
        continue;
      }
      if (exclude.has(uri)) {
        filterStats.source_filter.dropped_excluded += 1;
        continue;
      }
      if (candidate.is_playable === false) {
        filterStats.source_filter.dropped_unplayable += 1;
        continue;
      }

      const pop = toNumberOrUndefined(candidate.popularity);
      if (typeof pop === "number" && pop < opts.minPopularity) {
        filterStats.source_filter.dropped_popularity += 1;
        continue;
      }

      const duration = toNumberOrUndefined(candidate.duration_ms);
      if (typeof duration === "number" && duration > opts.maxDurationMs) {
        filterStats.source_filter.dropped_duration += 1;
        continue;
      }

      if (
        filterMarket &&
        Array.isArray(candidate.available_markets) &&
        candidate.available_markets.length > 0 &&
        !candidate.available_markets.includes(filterMarket.toUpperCase())
      ) {
        filterStats.source_filter.dropped_market += 1;
        continue;
      }

      filteredCandidates.push({ ...candidate, uri });
    }

    if (filteredCandidates.length === 0) {
      staleRounds += 1;
      if (staleRounds >= stagnationLimit) {
        break;
      }
      continue;
    }

    const acceptedCandidates: RecommendationTrack[] = [];

    if (!disableKeyDiversity && filterStats.key_diversity.enabled) {
      const missingKeys = filteredCandidates
        .map((item) => item.uri)
        .filter((uri) => !keyByUri.has(uri));

      if (missingKeys.length > 0) {
        try {
          const features = await fetchTrackAudioFeatures({
            trackUris: uniqueOrdered(missingKeys),
            timeoutMs: opts.timeoutMs,
            account: opts.account
          });

          for (const uri of missingKeys) {
            const key = features.get(uri)?.key;
            if (typeof key === "number") {
              keyByUri.set(uri, key);
            }
          }
        } catch (err) {
          if (isUnavailableEndpointError(err)) {
            disableKeyDiversity = true;
            filterStats.key_diversity.disabled_by_api = true;
            filterStats.key_diversity.enabled = false;
            warnings.push("key_diversity: disabled because audio-features is unavailable.");
          } else {
            throw err;
          }
        }
      }

      for (const candidate of filteredCandidates) {
        const key = keyByUri.get(candidate.uri);
        if (typeof key === "number") {
          const keyId = String(key);
          const current = keyCounts.get(keyId) ?? 0;
          if (current >= keyCap) {
            filterStats.key_diversity.dropped_by_key += 1;
            continue;
          }
          keyCounts.set(keyId, current + 1);
        }
        acceptedCandidates.push(candidate);
        if (acceptedCandidates.length + result.length >= opts.targetSize) {
          break;
        }
      }
    } else {
      acceptedCandidates.push(...filteredCandidates);
    }

    const newTracks: string[] = [];
    for (const item of acceptedCandidates) {
      if (result.length >= opts.targetSize) break;
      if (seen.has(item.uri)) {
        continue;
      }
      seen.add(item.uri);
      result.push(item.uri);
      newTracks.push(item.uri);
    }

    if (newTracks.length === 0) {
      staleRounds += 1;
      if (staleRounds >= stagnationLimit) {
        break;
      }
      continue;
    }

    staleRounds = 0;
    roundSeeds = newTracks.slice(0, 5);
  }

  filterStats.stagnation_by_filters = Math.min(stagnationLimit, staleRounds);

  let shortfall = Math.max(0, opts.targetSize - result.length);
  const filteredCount =
    filterStats.source_filter.dropped_noname +
    filterStats.source_filter.dropped_excluded +
    filterStats.source_filter.dropped_unplayable +
    filterStats.source_filter.dropped_market +
    filterStats.source_filter.dropped_popularity +
    filterStats.source_filter.dropped_duration +
    filterStats.key_diversity.dropped_by_key;

  if (shortfall > 0) {
    warnings.push(`Generated ${result.length}/${opts.targetSize} tracks; Spotify recommendations exhausted.`);
  }

  if (staleRounds >= stagnationLimit) {
    filterStats.stagnation_by_filters = staleRounds;
    warnings.push(`stagnation_by_filters: no growth in ${staleRounds} consecutive rounds.`);
  }

  if (filterStats.source_filter.dropped_noname > 0) {
    warnings.push(`source_filter: dropped_noname=${filterStats.source_filter.dropped_noname}`);
  }
  if (filterStats.source_filter.dropped_excluded > 0) {
    warnings.push(`source_filter: dropped_excluded=${filterStats.source_filter.dropped_excluded}`);
  }
  if (filterStats.source_filter.dropped_unplayable > 0) {
    warnings.push(`source_filter: dropped_unplayable=${filterStats.source_filter.dropped_unplayable}`);
  }
  if (filterStats.source_filter.dropped_market > 0) {
    warnings.push(`source_filter: dropped_market=${filterStats.source_filter.dropped_market}`);
  }
  if (filterStats.source_filter.dropped_popularity > 0) {
    warnings.push(`source_filter: dropped_popularity=${filterStats.source_filter.dropped_popularity}`);
  }
  if (filterStats.source_filter.dropped_duration > 0) {
    warnings.push(`source_filter: dropped_duration=${filterStats.source_filter.dropped_duration}`);
  }
  if (filterStats.key_diversity.dropped_by_key > 0) {
    warnings.push(`key_diversity: dropped_by_key=${filterStats.key_diversity.dropped_by_key}`);
  }

  return {
    seedCount: uniqueSeeds.length,
    generatedCount: result.length,
    shortfall,
    trackUris: result,
    warnings,
    filteredCount,
    filterStats
  };
}
