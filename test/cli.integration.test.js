const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

function runCli(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  for (const key of opts.unset || []) {
    if (key === "SPM_CLIENT_ID" || key === "SPM_CLIENT_SECRET") {
      env[key] = "";
      continue;
    }
    delete env[key];
  }

  return spawnSync("node", ["dist/index.js", ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8"
  });
}

test("version prints to stdout and exits 0", () => {
  const res = runCli(["--version"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+/);
  assert.equal(res.stderr, "");
});

test("unknown command with --json returns JSON error payload", () => {
  const res = runCli(["unknown", "--json"]);
  assert.equal(res.status, 2);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "INVALID_USAGE");
  assert.equal(res.stderr, "");
});

test("completion command prints shell script in human mode", () => {
  const res = runCli(["completion", "bash"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /bash completion for spm/i);
});

test("playlist get without ref exits with INVALID_USAGE", () => {
  const res = runCli(["playlist", "get"]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /missing required argument/i);
});

test("legacy playlist alias is not supported", () => {
  const res = runCli(["playlist", "37i9dQZF1DXcBWIGoYBM5M"]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /unknown command/i);
});

test("human-mode auth error uses stderr only", () => {
  const res = runCli(["account", "login", "--no-open"], {
    unset: ["SPM_CLIENT_ID", "SPM_CLIENT_SECRET"]
  });
  assert.equal(res.status, 3);
  assert.equal(res.stdout, "");
  assert.match(res.stderr, /Missing SPM_CLIENT_ID/i);
});

test("account list works without API credentials", () => {
  const accountsPath = path.join(os.tmpdir(), `spm-accounts-int-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(
    accountsPath,
    JSON.stringify({
      version: 2,
      active_account_id: "u1",
      accounts: [
        {
          version: 2,
          id: "u1",
          name: "main",
          scopes: [],
          token: {
            access_token: "token",
            refresh_token: "refresh",
            token_type: "Bearer",
            expires_at: Date.now() + 3600_000
          },
          source: "import",
          created_at: Date.now(),
          updated_at: Date.now()
        }
      ]
    }),
    "utf8"
  );

  const res = runCli(["account", "list", "--json"], {
    env: { SPM_ACCOUNTS_PATH: accountsPath },
    unset: ["SPM_CLIENT_ID", "SPM_CLIENT_SECRET"]
  });

  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, "account.list");
  try {
    fs.unlinkSync(accountsPath);
  } catch {
    // ignore
  }
});
