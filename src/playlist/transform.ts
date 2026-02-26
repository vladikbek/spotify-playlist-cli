import { PlaylistItemNormalized } from "../types";

export type TrackFilterResult = {
  uris: string[];
  droppedEpisodes: number;
  droppedUnknown: number;
};

function toTrackOnly(items: PlaylistItemNormalized[]): TrackFilterResult {
  let droppedEpisodes = 0;
  let droppedUnknown = 0;
  const uris: string[] = [];

  for (const item of items) {
    if (item.kind === "episode") {
      droppedEpisodes += 1;
      continue;
    }
    if (item.kind !== "track" || !item.uri) {
      droppedUnknown += 1;
      continue;
    }
    uris.push(item.uri);
  }

  return { uris, droppedEpisodes, droppedUnknown };
}

function makeRandom(seed?: number): () => number {
  if (seed === undefined) return Math.random;

  let x = seed | 0;
  return () => {
    x += 0x6d2b79f5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function chunkBySize<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function chunkByCount<T>(items: T[], count: number): T[][] {
  if (count <= 1) return [items.slice()];
  const out: T[][] = [];
  const base = Math.floor(items.length / count);
  let remainder = items.length % count;
  let cursor = 0;

  for (let i = 0; i < count; i += 1) {
    const size = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    if (size <= 0) continue;
    out.push(items.slice(cursor, cursor + size));
    cursor += size;
  }

  return out.length > 0 ? out : [items.slice()];
}

export function planShuffle(
  items: PlaylistItemNormalized[],
  opts?: { groupSize?: number; groups?: number; seed?: number }
): { uris: string[]; droppedEpisodes: number } {
  const filtered = toTrackOnly(items);
  const random = makeRandom(opts?.seed);

  if (filtered.uris.length <= 1) {
    return {
      uris: filtered.uris,
      droppedEpisodes: filtered.droppedEpisodes
    };
  }

  if (opts?.groupSize && opts.groupSize > 0) {
    const chunks = chunkBySize(filtered.uris, opts.groupSize);
    const shuffled = chunks.flatMap((chunk) => shuffleInPlace([...chunk], random));
    return {
      uris: shuffled,
      droppedEpisodes: filtered.droppedEpisodes
    };
  }

  if (opts?.groups && opts.groups > 0) {
    const chunks = chunkByCount(filtered.uris, opts.groups);
    const shuffled = chunks.flatMap((chunk) => shuffleInPlace([...chunk], random));
    return {
      uris: shuffled,
      droppedEpisodes: filtered.droppedEpisodes
    };
  }

  return {
    uris: shuffleInPlace([...filtered.uris], random),
    droppedEpisodes: filtered.droppedEpisodes
  };
}

export function planDedup(
  items: PlaylistItemNormalized[],
  keep: "first" | "last"
): { uris: string[]; droppedEpisodes: number } {
  const filtered = toTrackOnly(items);

  if (keep === "first") {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const uri of filtered.uris) {
      if (seen.has(uri)) continue;
      seen.add(uri);
      out.push(uri);
    }
    return {
      uris: out,
      droppedEpisodes: filtered.droppedEpisodes
    };
  }

  const seen = new Set<string>();
  const outRev: string[] = [];
  for (let i = filtered.uris.length - 1; i >= 0; i -= 1) {
    const uri = filtered.uris[i]!;
    if (seen.has(uri)) continue;
    seen.add(uri);
    outRev.push(uri);
  }

  return {
    uris: outRev.reverse(),
    droppedEpisodes: filtered.droppedEpisodes
  };
}

export function planCleanup(
  items: PlaylistItemNormalized[],
  market?: string
): { uris: string[]; droppedEpisodes: number } {
  const m = market?.toUpperCase();
  let droppedEpisodes = 0;
  const out: string[] = [];

  for (const item of items) {
    if (item.kind === "episode") {
      droppedEpisodes += 1;
      continue;
    }
    if (item.kind !== "track" || !item.uri) {
      continue;
    }
    if (item.is_playable === false) {
      continue;
    }
    if (m && Array.isArray(item.available_markets) && item.available_markets.length > 0 && !item.available_markets.includes(m)) {
      continue;
    }
    out.push(item.uri);
  }

  return {
    uris: out,
    droppedEpisodes
  };
}

export function planSort(
  items: PlaylistItemNormalized[],
  by: "added_at" | "popularity",
  order: "asc" | "desc"
): { uris: string[]; droppedEpisodes: number } {
  const drop = toTrackOnly(items);
  const trackItems = items.filter((x) => x.kind === "track" && x.uri);

  const sorted = [...trackItems].sort((a, b) => {
    const direction = order === "asc" ? 1 : -1;
    if (by === "added_at") {
      const av = a.added_at ? Date.parse(a.added_at) : 0;
      const bv = b.added_at ? Date.parse(b.added_at) : 0;
      return (av - bv) * direction;
    }
    const ap = a.popularity ?? -1;
    const bp = b.popularity ?? -1;
    return (ap - bp) * direction;
  });

  return {
    uris: sorted.map((x) => x.uri!).filter(Boolean),
    droppedEpisodes: drop.droppedEpisodes
  };
}

export function planTrim(
  items: PlaylistItemNormalized[],
  keep: number,
  from: "start" | "end"
): { uris: string[]; droppedEpisodes: number } {
  const filtered = toTrackOnly(items);
  const n = Math.max(0, Math.floor(keep));

  if (n === 0) {
    return {
      uris: [],
      droppedEpisodes: filtered.droppedEpisodes
    };
  }

  if (from === "end") {
    return {
      uris: filtered.uris.slice(-n),
      droppedEpisodes: filtered.droppedEpisodes
    };
  }

  return {
    uris: filtered.uris.slice(0, n),
    droppedEpisodes: filtered.droppedEpisodes
  };
}

export function trackUrisFromItems(items: PlaylistItemNormalized[]): TrackFilterResult {
  return toTrackOnly(items);
}

export function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
