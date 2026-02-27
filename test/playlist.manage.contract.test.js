const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runPlaylistAddManaged, runPlaylistCoverSetManaged } = require("../dist/commands/playlist/manage-core.js");
const { runPlaylistGenerateManaged } = require("../dist/commands/playlist/manage-generate.js");
const {
  runPlaylistDedupManaged,
  runPlaylistReverseManaged
} = require("../dist/commands/playlist/manage-mutations.js");

const ACCOUNTS_PATH = path.join(os.tmpdir(), `spm-accounts-${process.pid}.json`);

function jsonResponse(body, status = 200, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function writeAccountStore() {
  const now = Date.now();
  fs.writeFileSync(
    ACCOUNTS_PATH,
    JSON.stringify(
      {
        version: 2,
        active_account_id: "u1",
        accounts: [
          {
            version: 2,
            id: "u1",
            name: "main",
            display_name: "Main",
            scopes: ["playlist-modify-private", "playlist-read-private"],
            token: {
              access_token: "user-token",
              refresh_token: "refresh-token",
              token_type: "Bearer",
              expires_at: now + 3600_000
            },
            source: "import",
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

function installFetch(routes) {
  const queue = new Map();
  for (const [key, handler] of Object.entries(routes)) {
    queue.set(key, Array.isArray(handler) ? [...handler] : [handler]);
  }

  global.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url);
    const key = `${method} ${u.pathname}`;
    const handlers = queue.get(key);
    if (!handlers || handlers.length === 0) {
      throw new Error(`Missing mock route: ${key}`);
    }
    const handler = handlers.shift();
    return handler(u, init);
  };
}

test.beforeEach(() => {
  process.env.SPM_ACCOUNTS_PATH = ACCOUNTS_PATH;
  process.env.SPM_ACCOUNT = "u1";
  writeAccountStore();
});

test.afterEach(() => {
  try {
    fs.unlinkSync(ACCOUNTS_PATH);
  } catch {
    // ignore
  }
});

test("runPlaylistAddManaged posts 0-based position", async () => {
  let capturedBody = null;
  installFetch({
    "POST /v1/playlists/pl1/items": (_u, init) => {
      capturedBody = JSON.parse(String(init.body || "{}"));
      return jsonResponse({ snapshot_id: "snap-add" }, 201);
    }
  });

  const out = await runPlaylistAddManaged("pl1", "t1,t2", {
    pos: 3,
    noInput: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.position, 3);
  assert.equal(out.data.inserted_count, 2);
  assert.equal(capturedBody.position, 2);
  assert.deepEqual(capturedBody.uris, ["spotify:track:t1", "spotify:track:t2"]);
});

test("runPlaylistDedupManaged apply path validates snapshot and replaces items", async () => {
  let putBody = null;
  installFetch({
    "GET /v1/playlists/pl1": [
      () =>
        jsonResponse({
          id: "pl1",
          name: "Playlist One",
          snapshot_id: "snap-1",
          tracks: { total: 3 },
          owner: { id: "u1", display_name: "Main" }
        }),
      () => jsonResponse({ snapshot_id: "snap-1" })
    ],
    "GET /v1/playlists/pl1/items": () =>
      jsonResponse({
        items: [
          { track: { type: "track", uri: "spotify:track:a", id: "a", name: "A", is_playable: true } },
          { track: { type: "track", uri: "spotify:track:b", id: "b", name: "B", is_playable: true } },
          { track: { type: "track", uri: "spotify:track:a", id: "a", name: "A", is_playable: true } }
        ],
        total: 3,
        next: null
      }),
    "PUT /v1/playlists/pl1/items": (_u, init) => {
      putBody = JSON.parse(String(init.body || "{}"));
      return jsonResponse({ snapshot_id: "snap-2" });
    }
  });

  const out = await runPlaylistDedupManaged("pl1", {
    keep: "first",
    apply: true,
    force: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.result.applied, true);
  assert.equal(out.data.result.after_count, 2);
  assert.deepEqual(putBody.uris, ["spotify:track:a", "spotify:track:b"]);
});

test("runPlaylistReverseManaged preview does not apply changes", async () => {
  let putCalled = false;
  installFetch({
    "GET /v1/playlists/pl1": () =>
      jsonResponse({
        id: "pl1",
        name: "Playlist One",
        snapshot_id: "snap-1",
        tracks: { total: 2 },
        owner: { id: "u1", display_name: "Main" }
      }),
    "GET /v1/playlists/pl1/items": () =>
      jsonResponse({
        items: [
          { track: { type: "track", uri: "spotify:track:a", id: "a", name: "A", is_playable: true } },
          { track: { type: "track", uri: "spotify:track:b", id: "b", name: "B", is_playable: true } }
        ],
        total: 2,
        next: null
      }),
    "PUT /v1/playlists/pl1/items": () => {
      putCalled = true;
      return jsonResponse({ snapshot_id: "snap-2" });
    }
  });

  const out = await runPlaylistReverseManaged("pl1", {
    apply: false,
    force: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.result.applied, false);
  assert.equal(out.data.result.changed, true);
  assert.equal(out.data.result.after_count, 2);
  assert.equal(putCalled, false);
});

test("runPlaylistReverseManaged apply path validates snapshot and reverses order", async () => {
  let putBody = null;
  installFetch({
    "GET /v1/playlists/pl1": [
      () =>
        jsonResponse({
          id: "pl1",
          name: "Playlist One",
          snapshot_id: "snap-1",
          tracks: { total: 2 },
          owner: { id: "u1", display_name: "Main" }
        }),
      () => jsonResponse({ snapshot_id: "snap-1" })
    ],
    "GET /v1/playlists/pl1/items": () =>
      jsonResponse({
        items: [
          { track: { type: "track", uri: "spotify:track:a", id: "a", name: "A", is_playable: true } },
          { track: { type: "track", uri: "spotify:track:b", id: "b", name: "B", is_playable: true } }
        ],
        total: 2,
        next: null
      }),
    "PUT /v1/playlists/pl1/items": (_u, init) => {
      putBody = JSON.parse(String(init.body || "{}"));
      return jsonResponse({ snapshot_id: "snap-2" });
    }
  });

  const out = await runPlaylistReverseManaged("pl1", {
    apply: true,
    force: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.result.applied, true);
  assert.equal(out.data.result.after_count, 2);
  assert.deepEqual(putBody.uris, ["spotify:track:b", "spotify:track:a"]);
});

test("runPlaylistReverseManaged rejects non-playlist references", async () => {
  await assert.rejects(
    () =>
      runPlaylistReverseManaged("spotify:album:abc123", {
        apply: false,
        force: false,
        timeoutMs: 1000,
        account: "u1"
      }),
    (err) => err && err.code === "INVALID_USAGE"
  );
});

test("runPlaylistCoverSetManaged preview does not call API", async () => {
  let called = false;
  global.fetch = async () => {
    called = true;
    return jsonResponse({});
  };

  const out = await runPlaylistCoverSetManaged("pl1", {
    base64: Buffer.from("jpg", "utf8").toString("base64"),
    apply: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.apply, false);
  assert.equal(called, false);
});

test("runPlaylistGenerateManaged preview does not mutate target playlist", async () => {
  let mutateCalled = false;
  installFetch({
    "GET /v1/recommendations": () =>
      jsonResponse({
        tracks: [
          { uri: "spotify:track:d", name: "D" },
          { uri: "spotify:track:e", name: "E" }
        ]
      }),
    "POST /v1/playlists/pl1/items": () => {
      mutateCalled = true;
      return jsonResponse({ snapshot_id: "snap-preview" }, 201);
    }
  });

  const out = await runPlaylistGenerateManaged("a,b,c", {
    targetSize: 5,
    to: "pl1",
    mode: "append",
    seedProfile: false,
    diversifyKeys: false,
    apply: false,
    noInput: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.generated_count, 5);
  assert.equal(out.data.apply, false);
  assert.equal(out.data.target, "existing");
  assert.equal(mutateCalled, false);
});

test("runPlaylistGenerateManaged to-new apply creates playlist and adds generated tracks", async () => {
  let addedBody = null;
  installFetch({
    "GET /v1/recommendations": () =>
      jsonResponse({
        tracks: [
          { uri: "spotify:track:d", name: "D" },
          { uri: "spotify:track:e", name: "E" },
          { uri: "spotify:track:f", name: "F" }
        ]
      }),
    "POST /v1/me/playlists": () =>
      jsonResponse({
        id: "new1",
        name: "Generated 100",
        external_urls: { spotify: "https://open.spotify.com/playlist/new1" }
      }),
    "POST /v1/playlists/new1/items": (_u, init) => {
      addedBody = JSON.parse(String(init.body || "{}"));
      return jsonResponse({ snapshot_id: "snap-new1" }, 201);
    }
  });

  const out = await runPlaylistGenerateManaged("a,b,c", {
    targetSize: 6,
    toNew: true,
    name: "Generated 100",
    seedProfile: false,
    diversifyKeys: false,
    apply: true,
    noInput: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.playlist_id, "new1");
  assert.equal(out.data.snapshot_id, "snap-new1");
  assert.equal(out.data.generated_count, 6);
  assert.equal(addedBody.uris.length, 6);
});

test("runPlaylistGenerateManaged replace apply uses snapshot guard and replace call", async () => {
  let replaceBody = null;
  installFetch({
    "GET /v1/recommendations": () =>
      jsonResponse({
        tracks: [
          { uri: "spotify:track:d", name: "D" },
          { uri: "spotify:track:e", name: "E" }
        ]
      }),
    "GET /v1/playlists/pl1": [
      () =>
        jsonResponse({
          id: "pl1",
          name: "Playlist One",
          snapshot_id: "snap-1",
          tracks: { total: 2 },
          owner: { id: "u1", display_name: "Main" }
        }),
      () => jsonResponse({ snapshot_id: "snap-1" })
    ],
    "GET /v1/playlists/pl1/items": () =>
      jsonResponse({
        items: [
          { track: { type: "track", uri: "spotify:track:x", id: "x", name: "X", is_playable: true } },
          { track: { type: "track", uri: "spotify:track:y", id: "y", name: "Y", is_playable: true } }
        ],
        total: 2,
        next: null
      }),
    "PUT /v1/playlists/pl1/items": (_u, init) => {
      replaceBody = JSON.parse(String(init.body || "{}"));
      return jsonResponse({ snapshot_id: "snap-2" });
    }
  });

  const out = await runPlaylistGenerateManaged("a,b,c", {
    targetSize: 5,
    to: "pl1",
    mode: "replace",
    seedProfile: false,
    diversifyKeys: false,
    apply: true,
    force: false,
    noInput: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.result.applied, true);
  assert.equal(replaceBody.uris.length, 5);
});

test("runPlaylistGenerateManaged preview applies quality filters and excludes tracks", async () => {
  installFetch({
    "GET /v1/recommendations": () =>
      jsonResponse({
        tracks: [
          { uri: "spotify:track:d", name: "D", popularity: 10 },
          { uri: "spotify:track:e", name: "E", popularity: 50 },
          { uri: "spotify:track:f", name: "", popularity: 90 },
          { uri: "spotify:track:g", name: "G", popularity: 90 }
        ]
      })
  });

  const out = await runPlaylistGenerateManaged("a,b,c", {
    targetSize: 4,
    to: "pl1",
    mode: "append",
    seedProfile: false,
    diversifyKeys: false,
    minPopularity: 40,
    maxDurationMs: 200000,
    excludeTrackUris: ["spotify:track:e"],
    apply: false,
    noInput: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.generated_count, 4);
  assert.deepEqual(out.data.filter_config, {
    min_popularity: 40,
    max_duration_ms: 200000,
    seed_profile: false,
    diversify_keys: false,
    max_key_share: 25,
    excluded: 1
  });
  assert.equal(out.data.filter_stats.source_filter.dropped_popularity, 1);
  assert.equal(out.data.filter_stats.source_filter.dropped_noname, 1);
  assert.equal(out.data.filter_stats.source_filter.dropped_excluded, 1);
  assert.equal(out.data.track_uris.includes("spotify:track:e"), false);
});

test("runPlaylistGenerateManaged --no-seed-profile does not send seed target_* query", async () => {
  let capturedQuery;
  installFetch({
    "GET /v1/audio-features": () => jsonResponse({ audio_features: [] }),
    "GET /v1/tracks": () =>
      jsonResponse({
        tracks: [{ id: "a", popularity: 30 }, { id: "b", popularity: 30 }, { id: "c", popularity: 30 }]
      }),
    "GET /v1/recommendations": (u) => {
      capturedQuery = Object.fromEntries(u.searchParams);
      return jsonResponse({
        tracks: [
          { uri: "spotify:track:d", name: "D", popularity: 50 },
          { uri: "spotify:track:e", name: "E", popularity: 50 }
        ]
      });
    }
  });

  const out = await runPlaylistGenerateManaged("a,b,c", {
    targetSize: 4,
    to: "pl1",
    mode: "append",
    seedProfile: false,
    diversifyKeys: false,
    minPopularity: 50,
    maxDurationMs: 240000,
    apply: false,
    noInput: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.generated_count, 4);
  assert.equal(out.data.filter_stats.seed_profile.used, false);
  assert.ok(capturedQuery);
  assert.equal(capturedQuery.min_popularity, "50");
  assert.equal(capturedQuery.target_acousticness, undefined);
});

test("runPlaylistGenerateManaged continues when /audio-features is unavailable for seed profile", async () => {
  installFetch({
    "GET /v1/audio-features": () =>
      jsonResponse(
        { error: "forbidden" },
        403,
        { "content-type": "application/json" }
      ),
    "GET /v1/tracks": () =>
      jsonResponse({
        tracks: [{ id: "a", popularity: 30 }, { id: "b", popularity: 30 }, { id: "c", popularity: 30 }]
      }),
    "GET /v1/recommendations": () =>
      jsonResponse({
        tracks: [{ uri: "spotify:track:d", name: "D" }, { uri: "spotify:track:e", name: "E" }]
      })
  });

  const out = await runPlaylistGenerateManaged("a,b,c", {
    targetSize: 5,
    to: "pl1",
    mode: "append",
    seedProfile: true,
    diversifyKeys: false,
    apply: false,
    noInput: false,
    timeoutMs: 1000,
    account: "u1"
  });

  assert.equal(out.data.generated_count, 5);
  assert.equal(out.data.filter_stats.seed_profile.used, false);
  assert.equal(out.data.filter_stats.seed_profile.enabled, true);
  assert.ok(out.warnings.some((line) => line.includes("Seed profile")));
});
