const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CliError,
  exitCodeForError,
  toCliError,
  toJsonErrorPayload
} = require("../dist/errors.js");

test("exitCodeForError maps known CLI error codes", () => {
  assert.equal(exitCodeForError(new CliError("INVALID_USAGE", "x")), 2);
  assert.equal(exitCodeForError(new CliError("AUTH_CONFIG", "x")), 3);
  assert.equal(exitCodeForError(new CliError("NETWORK", "x")), 4);
  assert.equal(exitCodeForError(new CliError("SPOTIFY_API", "x")), 5);
  assert.equal(exitCodeForError(new CliError("NOT_FOUND", "x")), 6);
  assert.equal(exitCodeForError(new CliError("EXPERIMENTAL_UNAVAILABLE", "x")), 7);
  assert.equal(exitCodeForError(new CliError("INTERRUPTED", "x")), 130);
});

test("toCliError wraps unknown errors as INTERNAL", () => {
  const err = toCliError(new Error("boom"));
  assert.equal(err.code, "INTERNAL");
  assert.equal(err.message, "boom");
});

test("toJsonErrorPayload serializes public error contract", () => {
  const payload = toJsonErrorPayload(
    new CliError("NOT_FOUND", "No item", { hint: "Check your ID." })
  );
  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No item",
      hint: "Check your ID."
    }
  });
});
