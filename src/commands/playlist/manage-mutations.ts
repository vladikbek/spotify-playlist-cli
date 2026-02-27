import { CommandResult } from "../../types";
import { applyPlaylistPlan } from "../../playlist/apply";
import { fetchPlaylistMetaUser, loadPlaylistItemsUser } from "../../playlist/load-items";
import { parsePlaylistId } from "../../playlist/refs";
import {
  planCleanup,
  planDedup,
  planReverse,
  planShuffle,
  planSort,
  planTrim,
  trackUrisFromItems
} from "../../playlist/transform";
import { CliError } from "../../errors";

export function actionSummaryHuman(params: {
  action: string;
  name?: string;
  result: {
    changed: boolean;
    before_count: number;
    after_count: number;
    removed: number;
    dropped_episodes: number;
    applied: boolean;
  };
}): string[] {
  const lines: string[] = [];
  lines.push(`${params.action}: ${params.name ?? "playlist"}`);
  lines.push(`Before: ${params.result.before_count}`);
  lines.push(`After: ${params.result.after_count}`);
  lines.push(`Removed: ${params.result.removed}`);
  lines.push(`Dropped Episodes: ${params.result.dropped_episodes}`);
  lines.push(`Changed: ${params.result.changed ? "Yes" : "No"}`);
  lines.push(`Applied: ${params.result.applied ? "Yes" : "No"}`);
  if (!params.result.applied && params.result.changed) {
    lines.push("Preview only. Re-run with --apply to persist changes.");
  }
  return lines;
}

async function runTransformAction(
  input: string,
  opts: {
    timeoutMs: number;
    account?: string;
    apply?: boolean;
    force?: boolean;
    market?: string;
  },
  action: string,
  planner: (items: Awaited<ReturnType<typeof loadPlaylistItemsUser>>["items"]) => {
    uris: string[];
    droppedEpisodes: number;
  }
): Promise<CommandResult> {
  const id = parsePlaylistId(input);
  const meta = await fetchPlaylistMetaUser({
    playlistId: id,
    timeoutMs: opts.timeoutMs,
    account: opts.account
  });
  const loaded = await loadPlaylistItemsUser({
    playlistId: id,
    timeoutMs: opts.timeoutMs,
    account: opts.account,
    market: opts.market
  });

  const before = trackUrisFromItems(loaded.items);
  const planned = planner(loaded.items);

  const result = await applyPlaylistPlan({
    action,
    playlistId: id,
    beforeUris: before.uris,
    desiredUris: planned.uris,
    droppedEpisodes: planned.droppedEpisodes,
    apply: Boolean(opts.apply),
    force: Boolean(opts.force),
    timeoutMs: opts.timeoutMs,
    account: opts.account,
    snapshotId: meta.snapshot_id
  });

  return {
    data: {
      playlist: {
        id,
        name: meta.name,
        snapshot_id: meta.snapshot_id
      },
      result
    },
    human: actionSummaryHuman({
      action,
      name: meta.name,
      result
    }),
    source: "api"
  };
}

export async function runPlaylistShuffleManaged(
  input: string,
  opts: {
    groupSize?: number;
    groups?: number;
    seed?: number;
    apply?: boolean;
    force?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  if (opts.groupSize && opts.groups) {
    throw new CliError("INVALID_USAGE", "Use either --group-size or --groups, not both.");
  }

  return runTransformAction(
    input,
    {
      timeoutMs: opts.timeoutMs,
      account: opts.account,
      apply: opts.apply,
      force: opts.force
    },
    "shuffle",
    (items) => planShuffle(items, { groupSize: opts.groupSize, groups: opts.groups, seed: opts.seed })
  );
}

export async function runPlaylistDedupManaged(
  input: string,
  opts: {
    keep: "first" | "last";
    apply?: boolean;
    force?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  return runTransformAction(
    input,
    {
      timeoutMs: opts.timeoutMs,
      account: opts.account,
      apply: opts.apply,
      force: opts.force
    },
    "dedup",
    (items) => planDedup(items, opts.keep)
  );
}

export async function runPlaylistCleanupManaged(
  input: string,
  opts: {
    market?: string;
    apply?: boolean;
    force?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  return runTransformAction(
    input,
    {
      timeoutMs: opts.timeoutMs,
      account: opts.account,
      apply: opts.apply,
      force: opts.force,
      market: opts.market
    },
    "cleanup",
    (items) => planCleanup(items, opts.market)
  );
}

export async function runPlaylistSortManaged(
  input: string,
  opts: {
    by: "added_at" | "popularity";
    order: "asc" | "desc";
    apply?: boolean;
    force?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  return runTransformAction(
    input,
    {
      timeoutMs: opts.timeoutMs,
      account: opts.account,
      apply: opts.apply,
      force: opts.force
    },
    `sort:${opts.by}:${opts.order}`,
    (items) => planSort(items, opts.by, opts.order)
  );
}

export async function runPlaylistReverseManaged(
  input: string,
  opts: {
    apply?: boolean;
    force?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  return runTransformAction(
    input,
    {
      timeoutMs: opts.timeoutMs,
      account: opts.account,
      apply: opts.apply,
      force: opts.force
    },
    "reverse",
    (items) => planReverse(items)
  );
}

export async function runPlaylistTrimManaged(
  input: string,
  opts: {
    keep: number;
    from: "start" | "end";
    apply?: boolean;
    force?: boolean;
    timeoutMs: number;
    account?: string;
  }
): Promise<CommandResult> {
  if (!Number.isInteger(opts.keep) || opts.keep < 0) {
    throw new CliError("INVALID_USAGE", "--keep must be a non-negative integer.");
  }

  return runTransformAction(
    input,
    {
      timeoutMs: opts.timeoutMs,
      account: opts.account,
      apply: opts.apply,
      force: opts.force
    },
    `trim:${opts.from}`,
    (items) => planTrim(items, opts.keep, opts.from)
  );
}
