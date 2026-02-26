const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runPlaylistAddManaged, runPlaylistCoverSetManaged } = require("../dist/commands/playlist/manage-core.js");
const { runPlaylistDedupManaged } = require("../dist/commands/playlist/manage-mutations.js");

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
