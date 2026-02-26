export function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtBool(b: boolean): string {
  return b ? "Yes" : "No";
}

export function pickImageUrl(
  images: Array<{ url: string; width?: number | null; height?: number | null }>
): { url640?: string; url300?: string; url64?: string; all: string[] } {
  const sorted = [...(images || [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const all = sorted.map((i) => i.url);
  const url640 = sorted.find((i) => (i.width ?? 0) >= 640)?.url ?? sorted[0]?.url;
  const url300 = sorted.find((i) => (i.width ?? 0) >= 300)?.url ?? sorted[0]?.url;
  const url64 = sorted.find((i) => (i.width ?? 0) >= 64)?.url ?? sorted[sorted.length - 1]?.url;
  return { url640, url300, url64, all };
}

export function kvLine(key: string, val: string | number | boolean | null | undefined): string | null {
  if (val === undefined || val === null || val === "") return null;
  return `${key}: ${val}`;
}

export function pushKv(
  lines: string[],
  key: string,
  val: string | number | boolean | null | undefined
): void {
  const line = kvLine(key, val);
  if (line) lines.push(line);
}

export function printKv(key: string, val: string | number | boolean | null | undefined): void {
  const line = kvLine(key, val);
  if (line) process.stdout.write(`${line}\n`);
}
