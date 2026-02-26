/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const distIndex = path.resolve(__dirname, "..", "dist", "index.js");
if (!fs.existsSync(distIndex)) {
  console.error(`postbuild: missing ${distIndex}`);
  process.exit(1);
}

let content = fs.readFileSync(distIndex, "utf8");
if (!content.startsWith("#!/usr/bin/env node\n")) {
  // TS should preserve shebang, but enforce it in case config changes.
  content = `#!/usr/bin/env node\n${content.replace(/^#!.*\n/, "")}`;
  fs.writeFileSync(distIndex, content, "utf8");
}

try {
  fs.chmodSync(distIndex, 0o755);
} catch (e) {
  console.error(`postbuild: chmod failed: ${String(e)}`);
  process.exit(1);
}

