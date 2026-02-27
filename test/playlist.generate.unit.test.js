const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { generateTrackPool } = require("../dist/playlist/generate.js");

function jsonResponse(body, status = 200) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: { "content-type": "application/json" }
  });
}

function installFetch(routes) {
  const handlers = new Map();
  for (const [key, handler] of Object.entries(routes)) {
    const normalizedKey = key.replace(/\/$/, "");
    handlers.set(normalizedKey, Array.isArray(handler) ? [...handler] : [handler]);
  }

  global.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url);
    const routePath = u.pathname.replace(/\/$/, "");
    const routeKey = `${method} ${routePath}`;
    const list = handlers.get(routeKey);
    if (!list || list.length === 0) {
      throw new Error(`Missing mock route: ${routeKey}`);
    }
    const handler = list.length > 1 ? list.shift() : list[0];
    return handler(u, init);
  };
}

const TEST_ACCOUNT = "u1";
const ACCOUNTS_PATH = path.join(os.tmpdir(), `spm-accounts-${process.pid}-unit.json`);

function writeAccountStore() {
  const now = Date.now();
  fs.writeFileSync(
    ACCOUNTS_PATH,
    JSON.stringify(
      {
        version: 2,
        active_account_id: TEST_ACCOUNT,
        accounts: [
          {
            version: 2,
            id: TEST_ACCOUNT,
            name: "main",
            display_name: "Main",
            source: "import",
            scopes: ["playlist-modify-private", "playlist-read-private"],
            token: {
              access_token: "mock-user-token",
              refresh_token: "mock-refresh-token",
              token_type: "Bearer",
              expires_at: now + 3600_000
            },
            created_at: now,
            updated_at: now
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );
}

test.beforeEach(() => {
  process.env.SPM_ACCOUNTS_PATH = ACCOUNTS_PATH;
  process.env.SPM_ACCOUNT = TEST_ACCOUNT;
  writeAccountStore();
});

test.afterEach(() => {
  try {
    fs.unlinkSync(ACCOUNTS_PATH);
  } catch {
    // ignore
  }
});

function runGenerate(opts) {
  return generateTrackPool({
    ...opts,
    account: TEST_ACCOUNT
  });
}

test("generateTrackPool validates seed count bounds", async () => {
  await assert.rejects(
    () =>
      runGenerate({
        seedTrackUris: ["spotify:track:a", "spotify:track:b"],
        targetSize: 10,
        minPopularity: 30,
        maxDurationMs: 240000,
        seedProfileEnabled: false,
        diversifyKeys: false,
        timeoutMs: 1000,
        fetcher: async () => ({ uris: [] })
      }),
    (err) => err && err.code === "INVALID_USAGE"
  );

  await assert.rejects(
    () =>
      runGenerate({
        seedTrackUris: [
          "spotify:track:a",
          "spotify:track:b",
          "spotify:track:c",
          "spotify:track:d",
          "spotify:track:e",
          "spotify:track:f"
        ],
        targetSize: 10,
        minPopularity: 30,
        maxDurationMs: 240000,
        seedProfileEnabled: false,
        diversifyKeys: false,
        timeoutMs: 1000,
        fetcher: async () => ({ uris: [] })
      }),
    (err) => err && err.code === "INVALID_USAGE"
  );
});

test("generateTrackPool preserves seed-first ordering and reaches target", async () => {
  const out = await runGenerate({
    seedTrackUris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
    targetSize: 6,
    minPopularity: 30,
    maxDurationMs: 240000,
    seedProfileEnabled: false,
    diversifyKeys: false,
    timeoutMs: 1000,
    fetcher: async () => ({
      tracks: [
        { uri: "spotify:track:c", name: "C" },
        { uri: "spotify:track:d", name: "D" },
        { uri: "spotify:track:e", name: "E" },
        { uri: "spotify:track:f", name: "F" }
      ]
    })
  });

  assert.equal(out.generatedCount, 6);
  assert.equal(out.shortfall, 0);
  assert.deepEqual(out.trackUris, [
    "spotify:track:a",
    "spotify:track:b",
    "spotify:track:c",
    "spotify:track:d",
    "spotify:track:e",
    "spotify:track:f"
  ]);
});

test("generateTrackPool stops on repeated no-growth rounds", async () => {
  let calls = 0;
  const out = await runGenerate({
    seedTrackUris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
    targetSize: 8,
    minPopularity: 30,
    maxDurationMs: 240000,
    seedProfileEnabled: false,
    diversifyKeys: false,
    maxRounds: 8,
    stagnationLimit: 2,
    timeoutMs: 1000,
    fetcher: async () => {
      calls += 1;
      return {
        tracks: [
          { uri: "spotify:track:a", name: "A" },
          { uri: "spotify:track:b", name: "B" }
        ]
      };
    }
  });

  assert.equal(calls, 2);
  assert.equal(out.generatedCount, 3);
  assert.equal(out.shortfall, 5);
  assert.ok(out.warnings.some((line) => line.includes("Spotify recommendations exhausted.")));
});

test("generateTrackPool filters tracks by minimum popularity", async () => {
  const out = await runGenerate({
    seedTrackUris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
    targetSize: 4,
    minPopularity: 80,
    maxDurationMs: 240000,
    seedProfileEnabled: false,
    diversifyKeys: false,
    timeoutMs: 1000,
    fetcher: async () => ({
      tracks: [
        { uri: "spotify:track:d", name: "D", popularity: 75 },
        { uri: "spotify:track:e", name: "E", popularity: 90 }
      ]
    })
  });

  assert.equal(out.generatedCount, 4);
  assert.equal(out.filterStats.source_filter.dropped_popularity, 1);
  assert.deepEqual(out.trackUris, ["spotify:track:a", "spotify:track:b", "spotify:track:c", "spotify:track:e"]);
});

test("generateTrackPool filters tracks by duration and noname", async () => {
  const out = await runGenerate({
    seedTrackUris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
    targetSize: 4,
    minPopularity: 0,
    maxDurationMs: 200000,
    seedProfileEnabled: false,
    diversifyKeys: false,
    timeoutMs: 1000,
    fetcher: async () => ({
      tracks: [
        { uri: "spotify:track:d", name: "D", duration_ms: 190000, popularity: 30 },
        { uri: "spotify:track:e", name: "", duration_ms: 180000, popularity: 30 },
        { uri: "spotify:track:f", name: "F", duration_ms: 210000, popularity: 30 }
      ]
    })
  });

  assert.equal(out.generatedCount, 4);
  assert.equal(out.filterStats.source_filter.dropped_noname, 1);
  assert.equal(out.filterStats.source_filter.dropped_duration, 1);
  assert.deepEqual(out.trackUris, ["spotify:track:a", "spotify:track:b", "spotify:track:c", "spotify:track:d"]);
});

test("generateTrackPool filters unplayable tracks and market mismatches", async () => {
  const out = await runGenerate({
    seedTrackUris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
    targetSize: 4,
    minPopularity: 0,
    maxDurationMs: 240000,
    market: "US",
    seedProfileEnabled: false,
    diversifyKeys: false,
    timeoutMs: 1000,
    fetcher: async () => ({
      tracks: [
        {
          uri: "spotify:track:d",
          name: "D",
          is_playable: false,
          available_markets: ["US"]
        },
        {
          uri: "spotify:track:e",
          name: "E",
          is_playable: true,
          available_markets: ["DE"]
        },
        {
          uri: "spotify:track:f",
          name: "F",
          is_playable: true,
          available_markets: ["US", "DE"]
        }
      ]
    })
  });

  assert.equal(out.generatedCount, 4);
  assert.equal(out.filterStats.source_filter.dropped_unplayable, 1);
  assert.equal(out.filterStats.source_filter.dropped_market, 1);
  assert.deepEqual(out.trackUris, ["spotify:track:a", "spotify:track:b", "spotify:track:c", "spotify:track:f"]);
});

test("generateTrackPool applies exclude list", async () => {
  const out = await runGenerate({
    seedTrackUris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
    targetSize: 5,
    minPopularity: 0,
    maxDurationMs: 240000,
    excludeTrackUris: ["spotify:track:e", "spotify:track:g"],
    seedProfileEnabled: false,
    diversifyKeys: false,
    timeoutMs: 1000,
    fetcher: async () => ({
      tracks: [
        { uri: "spotify:track:d", name: "D" },
        { uri: "spotify:track:e", name: "E" },
        { uri: "spotify:track:f", name: "F" }
      ]
    })
  });

  assert.equal(out.generatedCount, 5);
  assert.equal(out.filterStats.source_filter.dropped_excluded, 1);
  assert.deepEqual(out.trackUris, [
    "spotify:track:a",
    "spotify:track:b",
    "spotify:track:c",
    "spotify:track:d",
    "spotify:track:f"
  ]);
});

test("generateTrackPool blocks key-skew with key diversity cap", async () => {
  const audioFeatures = (u) => {
    const ids = String(u.searchParams.get("ids") ?? "");
    if (ids.includes("a") && ids.includes("b") && ids.includes("c")) {
      return jsonResponse({
        audio_features: [
          { id: "a", key: 1 },
          { id: "b", key: 2 },
          { id: "c", key: 3 }
        ]
      });
    }
    if (ids.includes("d") && ids.includes("e") && ids.includes("f") && ids.includes("g")) {
      return jsonResponse({
        audio_features: [
          { id: "d", key: 1 },
          { id: "e", key: 1 },
          { id: "f", key: 1 },
          { id: "g", key: 1 }
        ]
      });
    }
    return jsonResponse({ audio_features: [] });
  };

  installFetch({
    "GET /v1/audio-features": audioFeatures
  });

  const out = await runGenerate({
    seedTrackUris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
    targetSize: 5,
    minPopularity: 0,
    maxDurationMs: 240000,
    seedProfileEnabled: false,
    diversifyKeys: true,
    maxKeySharePercent: 40,
    timeoutMs: 1000,
    fetcher: async () => ({
      tracks: [
        { uri: "spotify:track:d", name: "D", popularity: 40 },
        { uri: "spotify:track:e", name: "E", popularity: 40 },
        { uri: "spotify:track:f", name: "F", popularity: 40 },
        { uri: "spotify:track:g", name: "G", popularity: 40 }
      ]
    })
  });

  assert.equal(out.filterStats.key_diversity.dropped_by_key > 0, true);
  assert.equal(out.generatedCount, 4);
  assert.equal(out.shortfall, 1);
  assert.equal(out.trackUris.length, 4);
});

test("generateTrackPool uses seed-derived target_* query when available", async () => {
  const capturedQueries = [];
  installFetch({
    "GET /v1/tracks": () =>
      jsonResponse({
        tracks: [
          { id: "a", popularity: 20 },
          { id: "b", popularity: 40 },
          { id: "c", popularity: 60 }
        ]
      }),
    "GET /v1/audio-features": () =>
      jsonResponse({
        audio_features: [
          { id: "a", acousticness: 0.1, danceability: 0.2, energy: 0.3, instrumentalness: 0.4, liveness: 0.5, speechiness: 0.6, valence: 0.7, tempo: 120, loudness: -6 },
          { id: "b", acousticness: 0.2, danceability: 0.4, energy: 0.6, instrumentalness: 0.8, liveness: 0.1, speechiness: 0.2, valence: 0.3, tempo: 124, loudness: -5 },
          { id: "c", acousticness: 0.3, danceability: 0.6, energy: 0.9, instrumentalness: 0.2, liveness: 0.2, speechiness: 0.4, valence: 0.5, tempo: 128, loudness: -4 }
        ]
      })
  });

  const out = await runGenerate({
    seedTrackUris: ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
    targetSize: 4,
    minPopularity: 30,
    maxDurationMs: 240000,
    seedProfileEnabled: true,
    diversifyKeys: false,
    timeoutMs: 1000,
    fetcher: async (options) => {
      capturedQueries.push(options.seedProfileQuery ?? {});
      return { tracks: [{ uri: "spotify:track:d", name: "D" }] };
    }
  });

  assert.equal(out.generatedCount, 4);
  assert.equal(capturedQueries.length, 1);
  const q = capturedQueries[0];
  assert.equal(q.target_popularity, 40);
  assert.equal(q.target_acousticness, 0.2);
  assert.equal(q.target_danceability, 0.4);
  assert.equal(out.filterStats.seed_profile.used, true);
  assert.equal(out.filterStats.seed_profile.enabled, true);
});
