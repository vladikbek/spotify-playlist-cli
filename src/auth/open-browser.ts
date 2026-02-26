import { spawn } from "node:child_process";

function commandForPlatform(url: string): { cmd: string; args: string[] } {
  if (process.platform === "darwin") {
    return { cmd: "open", args: [url] };
  }
  if (process.platform === "win32") {
    return { cmd: "cmd", args: ["/c", "start", "", url] };
  }
  return { cmd: "xdg-open", args: [url] };
}

export function openBrowser(url: string): boolean {
  const { cmd, args } = commandForPlatform(url);
  try {
    const child = spawn(cmd, args, {
      stdio: "ignore",
      detached: true
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
