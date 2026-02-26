const test = require("node:test");
const assert = require("node:assert/strict");

const { parseSpotifyRef, parseIdForType } = require("../dist/parser.js");

test("parseSpotifyRef handles URL/URI/raw ID", () => {
  assert.deepEqual(parseSpotifyRef("https://open.spotify.com/track/abc123?si=x"), {
    type: "track",
    id: "abc123"
  });
  assert.deepEqual(parseSpotifyRef("spotify:album:alb1"), {
    type: "album",
    id: "alb1"
  });
  assert.deepEqual(parseSpotifyRef("raw-id"), {
    id: "raw-id"
  });
});

test("parseSpotifyRef handles legacy user playlist URI", () => {
  assert.deepEqual(parseSpotifyRef("spotify:user:alice:playlist:pl1"), {
    type: "playlist",
    id: "pl1"
  });
});

test("parseIdForType throws INVALID_USAGE on mismatched typed refs", () => {
  assert.throws(
    () => parseIdForType("https://open.spotify.com/album/alb1", "track"),
    (err) => err && err.code === "INVALID_USAGE"
  );
});
