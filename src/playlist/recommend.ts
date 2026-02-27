import { apiUserGet } from "../client";
import { CliError } from "../errors";

export function trackIdFromUri(uri: string): string {
  if (!uri.startsWith("spotify:track:")) {
    throw new CliError("INVALID_USAGE", `Invalid track URI: ${uri}`);
  }
  return uri.slice("spotify:track:".length);
}

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

function average(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isUnavailableEndpointError(err: unknown): boolean {
  if (!(err instanceof CliError) || err.code !== "SPOTIFY_API") return false;
  const status = Number((err.details as { status?: number } | undefined)?.status);
  return status === 403 || status === 404;
}

function isValidFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

type AudioFeature = {
  id?: string;
  acousticness?: number;
  danceability?: number;
  energy?: number;
  instrumentalness?: number;
  liveness?: number;
  speechiness?: number;
  valence?: number;
  tempo?: number;
  loudness?: number;
  key?: number;
};

type RecommendationTrackRaw = {
  uri?: string;
  id?: string;
  name?: string;
  popularity?: number;
  duration_ms?: number;
  is_playable?: boolean;
  available_markets?: unknown;
};

export type RecommendationTrack = {
  uri: string;
  id: string;
  name?: string;
  popularity?: number;
  duration_ms?: number;
  is_playable?: boolean;
  available_markets?: string[];
  key?: number;
};

export type SeedProfileResult = {
  query: Record<string, number>;
  used: boolean;
  warnings: string[];
};

export type RecommendationResult = {
  tracks: RecommendationTrack[];
  warnings: string[];
};

export type RecommendationTrackFetcherOptions = {
  seedTrackUris: string[];
  limit: number;
  market?: string;
  timeoutMs: number;
  account?: string;
  minPopularity: number;
  maxDurationMs: number;
  seedProfileQuery?: Record<string, number>;
};

export type AudioFeatureByUri = {
  uri: string;
  key?: number;
};

export async function fetchTrackAudioFeatures(opts: {
  trackUris: string[];
  timeoutMs: number;
  account?: string;
}): Promise<Map<string, AudioFeatureByUri>> {
  const uniqueIds = uniqueOrdered(opts.trackUris.map((uri) => trackIdFromUri(uri)));
  const out = new Map<string, AudioFeatureByUri>();
  for (let i = 0; i < uniqueIds.length; i += 100) {
    const chunk = uniqueIds.slice(i, i + 100);
    const rec = await apiUserGet<{ audio_features?: Array<AudioFeature | null> }>("/audio-features", {
      query: {
        ids: chunk.join(",")
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

    for (const feature of rec.audio_features ?? []) {
      if (!feature || !feature.id) continue;
      const key = typeof feature.key === "number" ? feature.key : undefined;
      out.set(`spotify:track:${feature.id}`, {
        uri: `spotify:track:${feature.id}`,
        key
      });
    }
  }

  return out;
}

export async function resolveSeedProfile(opts: {
  seedTrackUris: string[];
  minPopularity: number;
  timeoutMs: number;
  account?: string;
}): Promise<SeedProfileResult> {
  const query: Record<string, number> = {};
  const warnings: string[] = [];
  const seedIds = uniqueOrdered(opts.seedTrackUris.map(trackIdFromUri)).slice(0, 5);
  if (seedIds.length === 0) {
    warnings.push("Seed profile disabled: no valid seed tracks.");
    return { query: {}, used: false, warnings };
  }

  const queryArgs = { ids: seedIds.join(",") };

  const tracksPromise = apiUserGet<{ tracks?: Array<{ id?: string; popularity?: number; name?: string }> }>("/tracks", {
    query: queryArgs,
    request: {
      timeoutMs: opts.timeoutMs,
      account: opts.account
    },
    auth: {
      mode: "user",
      account: opts.account
    }
  });

  const featuresPromise = apiUserGet<{ audio_features?: Array<AudioFeature | null> }>("/audio-features", {
    query: queryArgs,
    request: {
      timeoutMs: opts.timeoutMs,
      account: opts.account
    },
    auth: {
      mode: "user",
      account: opts.account
    }
  });

  let tracksPayload: { tracks?: Array<{ id?: string; popularity?: number; name?: string }> };
  let featuresPayload: { audio_features?: Array<AudioFeature | null> };

  try {
    [tracksPayload, featuresPayload] = await Promise.all([tracksPromise, featuresPromise]);
  } catch (err) {
    if (isUnavailableEndpointError(err)) {
      warnings.push("Seed profile is unavailable from Spotify profile endpoints.");
      return { query: {}, used: false, warnings };
    }
    throw err;
  }

  const avgPopularityValues: number[] = [];
  for (const track of tracksPayload?.tracks ?? []) {
    if (isValidFiniteNumber(track?.popularity)) {
      avgPopularityValues.push(track.popularity);
    }
  }

  const byFeature = new Map<string, number[]>();
  for (const feature of featuresPayload?.audio_features ?? []) {
    if (!feature || !feature.id) continue;

    const push = (key: string, value: unknown) => {
      if (!isValidFiniteNumber(value)) return;
      const arr = byFeature.get(key) ?? [];
      arr.push(Number(value));
      byFeature.set(key, arr);
    };

    push("acousticness", feature.acousticness);
    push("danceability", feature.danceability);
    push("energy", feature.energy);
    push("instrumentalness", feature.instrumentalness);
    push("liveness", feature.liveness);
    push("speechiness", feature.speechiness);
    push("valence", feature.valence);
    push("tempo", feature.tempo);
    push("loudness", feature.loudness);
  }

  const avgPopularity = average(avgPopularityValues);
  if (isValidFiniteNumber(avgPopularity)) {
    query.target_popularity = Math.round(Math.max(0, Math.min(100, avgPopularity)));
  } else {
    query.target_popularity = opts.minPopularity;
  }

  const featureKeys = [
    "acousticness",
    "danceability",
    "energy",
    "instrumentalness",
    "liveness",
    "speechiness",
    "valence",
    "tempo",
    "loudness"
  ] as const;

  for (const key of featureKeys) {
    const values = byFeature.get(key);
    if (!values || values.length === 0) continue;
    const avg = average(values);
    if (isValidFiniteNumber(avg)) {
      query[`target_${key}`] = Number(avg.toFixed(6));
    }
  }

  if (Object.keys(query).length === 0) {
    warnings.push("Seed profile computed no usable feature signals; using only quality filters.");
    return { query: {}, used: false, warnings };
  }

  return { query, used: true, warnings };
}

export async function fetchRecommendationsBySeedTracks(opts: RecommendationTrackFetcherOptions): Promise<RecommendationResult> {
  const seedIds = uniqueOrdered(opts.seedTrackUris.map(trackIdFromUri)).slice(0, 5);
  if (seedIds.length === 0) {
    return { tracks: [], warnings: ["No valid seed tracks provided for recommendation request."] };
  }

  const query: Record<string, string | number> = {
    seed_tracks: seedIds.join(","),
    limit: Math.max(1, Math.min(100, opts.limit)),
    max_duration_ms: Math.max(1, Math.floor(opts.maxDurationMs))
  };

  if (opts.market) {
    query.market = opts.market;
  }

  const useSeedProfile = opts.seedProfileQuery && Object.keys(opts.seedProfileQuery).length > 0;
  if (useSeedProfile) {
    Object.assign(query, opts.seedProfileQuery);
  } else {
    query.min_popularity = Math.max(0, Math.min(100, Math.floor(opts.minPopularity)));
  }

  try {
    const rec = await apiUserGet<{ tracks?: RecommendationTrackRaw[] }>("/recommendations", {
      query,
      request: {
        timeoutMs: opts.timeoutMs,
        account: opts.account
      },
      auth: {
        mode: "user",
        account: opts.account
      }
    });

    const warnings: string[] = [];
    let dropped = 0;
    const seen = new Set<string>();
    const tracks: RecommendationTrack[] = [];

    for (const track of rec.tracks ?? []) {
      const uri = typeof track?.uri === "string" && track.uri.trim().length > 0 ? track.uri : undefined;
      if (!uri) {
        dropped += 1;
        continue;
      }

      const canonicalUri = uri;
      if (seen.has(canonicalUri)) continue;
      seen.add(canonicalUri);

      const rawMarkets = Array.isArray(track.available_markets)
        ? track.available_markets.filter((x: unknown): x is string => typeof x === "string")
        : [];

      tracks.push({
        uri: canonicalUri,
        id: trackIdFromUri(canonicalUri),
        name: typeof track.name === "string" ? track.name : undefined,
        popularity: isValidFiniteNumber(track.popularity) ? track.popularity : undefined,
        duration_ms: isValidFiniteNumber(track.duration_ms) ? track.duration_ms : undefined,
        is_playable: typeof track.is_playable === "boolean" ? track.is_playable : undefined,
        available_markets: rawMarkets
      });
    }

    if (dropped > 0) {
      warnings.push(`dropped_invalid_recommendations: ${dropped}`);
    }

    return { tracks, warnings };
  } catch (err) {
    if (err instanceof CliError && err.code === "SPOTIFY_API") {
      const status = Number((err.details as { status?: number } | undefined)?.status);
      if (status === 403 || status === 404) {
        throw new CliError("EXPERIMENTAL_UNAVAILABLE", "Spotify recommendations endpoint is unavailable.", {
          hint: "Use an app in Extended quota mode to access /recommendations."
        });
      }
    }
    throw err;
  }
}
