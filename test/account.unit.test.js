const test = require("node:test");
const assert = require("node:assert/strict");

const { parseImportedBase64 } = require("../dist/auth/base64-bundle.js");
const {
  upsertAccount,
  setActiveAccount,
  removeAccount
} = require("../dist/auth/account-store.js");

function toB64(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

test("parseImportedBase64 accepts strict v2 bundle", () => {
  const now = Date.now();
  const payload = toB64({
    version: 2,
    kind: "spm-account-bundle",
    exported_at: Math.floor(now / 1000),
    account: {
      version: 2,
      id: "u1",
      name: "main",
      scopes: ["playlist-read-private"],
      token: {
        access_token: "acc",
        refresh_token: "ref",
        token_type: "Bearer",
        expires_at: now + 3600_000
      },
      source: "import",
      created_at: now,
      updated_at: now
    }
  });
  const out = parseImportedBase64(payload);
  assert.equal(out.kind, "spm-account-bundle");
  assert.equal(out.account.id, "u1");
  assert.equal(out.account.token.refresh_token, "ref");
});

test("parseImportedBase64 rejects legacy payloads", () => {
  const legacy = Buffer.from("plain-token", "utf8").toString("base64");
  assert.throws(() => parseImportedBase64(legacy), /must be JSON|Unsupported account import payload/i);
});

test("account store helpers upsert, set active, remove (v2)", () => {
  const now = Date.now();
  const initial = {
    version: 2,
    accounts: []
  };

  const withA = upsertAccount(initial, {
    version: 2,
    id: "a",
    name: "main",
    scopes: [],
    token: {
      access_token: "t",
      refresh_token: "r",
      token_type: "Bearer",
      expires_at: now + 10_000
    },
    source: "import",
    created_at: now,
    updated_at: now
  });

  assert.equal(withA.accounts.length, 1);
  assert.equal(withA.active_account_id, "a");

  const withB = upsertAccount(withA, {
    version: 2,
    id: "b",
    name: "second",
    scopes: [],
    token: {
      access_token: "t2",
      refresh_token: "r2",
      token_type: "Bearer",
      expires_at: now + 20_000
    },
    source: "import",
    created_at: now,
    updated_at: now
  });

  const activeB = setActiveAccount(withB, "b");
  assert.equal(activeB.active_account_id, "b");

  const removedB = removeAccount(activeB, "b");
  assert.equal(removedB.accounts.length, 1);
  assert.equal(removedB.accounts[0].id, "a");
  assert.equal(removedB.active_account_id, "a");
});
