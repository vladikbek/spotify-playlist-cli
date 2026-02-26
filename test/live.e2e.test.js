const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const LIVE_ENABLED = process.env.SPM_LIVE_TEST === "1";
const HAS_CREDS = Boolean(process.env.SPM_CLIENT_ID) && Boolean(process.env.SPM_CLIENT_SECRET);
const HAS_ACCOUNT = Boolean(process.env.SPM_ACCOUNT);

function runCli(args) {
  return spawnSync("node", ["dist/index.js", ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8"
  });
}

test(
  "live smoke (opt-in)",
  { skip: !LIVE_ENABLED || !HAS_CREDS || !HAS_ACCOUNT },
  () => {
    const commands = [
      ["playlist", "list", "--limit", "1", "--json"],
      ["account", "show", "--json"]
    ];

    for (const args of commands) {
      const res = runCli(args);
      assert.equal(res.status, 0, `Expected success for: spm ${args.join(" ")}\n${res.stderr}`);
      const payload = JSON.parse(res.stdout);
      assert.equal(payload.ok, true);
    }
  }
);
