const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planShuffle,
  planDedup,
  planCleanup,
  planSort,
  planTrim,
  planReverse
} = require("../dist/playlist/transform.js");

function track(uri, extra = {}) {
  return {
    kind: "track",
    uri,
    is_local: false,
    ...extra
  };
}

function episode(uri) {
  return {
    kind: "episode",
    uri,
    is_local: false
  };
}

test("planShuffle is deterministic with seed", () => {
  const items = [track("spotify:track:1"), track("spotify:track:2"), track("spotify:track:3")];
  const a = planShuffle(items, { seed: 7 }).uris;
  const b = planShuffle(items, { seed: 7 }).uris;
  assert.deepEqual(a, b);
});

test("planDedup keeps last when requested", () => {
  const items = [
    track("spotify:track:1"),
    track("spotify:track:2"),
    track("spotify:track:1"),
    track("spotify:track:3")
  ];
  const out = planDedup(items, "last").uris;
  assert.deepEqual(out, ["spotify:track:2", "spotify:track:1", "spotify:track:3"]);
});

test("planCleanup removes unplayable and market-unavailable tracks", () => {
  const items = [
    track("spotify:track:1", { is_playable: true, available_markets: ["US"] }),
    track("spotify:track:2", { is_playable: false, available_markets: ["US"] }),
    track("spotify:track:3", { is_playable: true, available_markets: ["DE"] }),
    episode("spotify:episode:4")
  ];
  const out = planCleanup(items, "US");
  assert.deepEqual(out.uris, ["spotify:track:1"]);
  assert.equal(out.droppedEpisodes, 1);
});

test("planSort sorts by popularity desc", () => {
  const items = [
    track("spotify:track:1", { popularity: 10 }),
    track("spotify:track:2", { popularity: 99 }),
    track("spotify:track:3", { popularity: 50 })
  ];
  const out = planSort(items, "popularity", "desc").uris;
  assert.deepEqual(out, ["spotify:track:2", "spotify:track:3", "spotify:track:1"]);
});

test("planReverse returns reversed track order", () => {
  const items = [
    track("spotify:track:1", { name: "One", popularity: 90 }),
    track("spotify:track:2", { name: "Two", popularity: 20 }),
    track("spotify:track:3", { name: "Three", popularity: 50 }),
    track("spotify:track:4", { name: "Four", popularity: 70 })
  ];
  const out = planReverse(items).uris;
  assert.deepEqual(out, ["spotify:track:4", "spotify:track:3", "spotify:track:2", "spotify:track:1"]);
});

test("planReverse leaves empty and single-element playlists unchanged", () => {
  assert.deepEqual(planReverse([]).uris, []);
  assert.deepEqual(planReverse([track("spotify:track:1")]).uris, ["spotify:track:1"]);
});

test("planReverse is idempotent when applied twice", () => {
  const items = [track("spotify:track:1"), track("spotify:track:2"), track("spotify:track:3"), track("spotify:track:4")];
  const first = planReverse(items).uris;
  const twice = planReverse(first.map((uri) => track(uri))).uris;
  assert.deepEqual(twice, ["spotify:track:1", "spotify:track:2", "spotify:track:3", "spotify:track:4"]);
});

test("planTrim keeps tail from end", () => {
  const items = [track("spotify:track:1"), track("spotify:track:2"), track("spotify:track:3")];
  const out = planTrim(items, 2, "end").uris;
  assert.deepEqual(out, ["spotify:track:2", "spotify:track:3"]);
});
