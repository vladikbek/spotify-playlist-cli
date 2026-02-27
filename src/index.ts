#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import {
  runPlaylistAddManaged,
  runPlaylistCoverGetManaged,
  runPlaylistCoverSetManaged,
  runPlaylistCreateManaged,
  runPlaylistGetManaged,
  runPlaylistListManaged,
  runPlaylistUpdateManaged
} from "./commands/playlist/manage-core";
import { runPlaylistGenerateManaged } from "./commands/playlist/manage-generate";
import {
  runPlaylistCleanupManaged,
  runPlaylistDedupManaged,
  runPlaylistReverseManaged,
  runPlaylistShuffleManaged,
  runPlaylistSortManaged,
  runPlaylistTrimManaged
} from "./commands/playlist/manage-mutations";
import {
  runPlaylistCopyManaged,
  runPlaylistExportManaged,
  runPlaylistImportManaged
} from "./commands/playlist/manage-transfer";
import {
  runAccountExport,
  runAccountImport,
  runAccountList,
  runAccountLogin,
  runAccountRemove,
  runAccountShow,
  runAccountUse
} from "./commands/account";
import { completionScriptFor } from "./completion";
import { CliError, exitCodeForError, toCliError } from "./errors";
import { emitError, emitSuccess } from "./output";
import { CommandResult, GlobalOptions } from "./types";
import { parseTrackUrisInput } from "./playlist/refs";

const DEFAULT_TIMEOUT_MS = 15_000;

function parsePositiveIntOption(name: string) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new InvalidArgumentError(`${name} must be a positive integer.`);
    }
    return n;
  };
}

function parseNonNegativeIntOption(name: string) {
  return (value: string): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new InvalidArgumentError(`${name} must be a non-negative integer.`);
    }
    return n;
  };
}

function readVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function normalizeMarket(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const v = String(value).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(v)) {
    throw new CliError("INVALID_USAGE", `Invalid market code: ${value}`, {
      hint: "Use a 2-letter ISO country code, for example US."
    });
  }
  return v;
}

function timeoutFromEnv(): number | undefined {
  const raw = process.env.SPM_TIMEOUT_MS;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new CliError("INVALID_USAGE", `Invalid SPM_TIMEOUT_MS value: ${raw}`);
  }
  return n;
}

function sharedFlags(command: Command): Command {
  command
    .option("--json", "Machine-readable JSON envelope")
    .option("--raw", "Include raw upstream payload inside JSON meta.raw")
    .option("-q, --quiet", "Suppress non-critical diagnostics")
    .option("-v, --verbose", "Show extra diagnostics on stderr")
    .option("--no-color", "Disable ANSI colors")
    .option("--no-input", "Disable stdin prompts/fallbacks")
    .option("--timeout-ms <N>", "Network timeout in milliseconds", parsePositiveIntOption("timeout-ms"))
    .option("--market <XX>", "Default market (country code)")
    .option("--account <nameOrId>", "Spotify account name or id");
  return command;
}

function fallbackOptionsFromArgv(argv: string[]): GlobalOptions {
  const has = (x: string): boolean => argv.includes(x);
  const raw = has("--raw");
  return {
    json: has("--json") || raw,
    raw,
    quiet: has("--quiet") || has("-q"),
    verbose: has("--verbose") || has("-v"),
    noColor: has("--no-color") || process.env.NO_COLOR !== undefined || process.env.TERM === "dumb",
    noInput: has("--no-input"),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    market: undefined,
    account: undefined
  };
}

function resolveGlobalOptions(command: Command): GlobalOptions {
  const opts = command.optsWithGlobals() as Record<string, unknown>;
  const timeoutMs = (opts.timeoutMs as number | undefined) ?? timeoutFromEnv() ?? DEFAULT_TIMEOUT_MS;
  const market = normalizeMarket(opts.market ?? process.env.SPM_MARKET);
  const account = (opts.account as string | undefined) ?? process.env.SPM_ACCOUNT;

  const quiet = Boolean(opts.quiet);
  const verbose = Boolean(opts.verbose);
  if (quiet && verbose) {
    throw new CliError("INVALID_USAGE", "Use either --quiet or --verbose, not both.");
  }

  const raw = Boolean(opts.raw);
  const json = Boolean(opts.json) || raw;
  const colorEnabled = opts.color !== false;

  return {
    json,
    raw,
    quiet,
    verbose,
    noColor: !colorEnabled || process.env.NO_COLOR !== undefined || process.env.TERM === "dumb",
    noInput: Boolean(opts.noInput),
    timeoutMs,
    market,
    account
  };
}

async function runHandled(
  commandName: string,
  command: Command,
  action: (opts: GlobalOptions) => Promise<CommandResult>
): Promise<void> {
  let global: GlobalOptions;
  try {
    global = resolveGlobalOptions(command);
  } catch (err) {
    const cliErr = toCliError(err);
    emitError(cliErr, fallbackOptionsFromArgv(process.argv));
    process.exitCode = exitCodeForError(cliErr);
    return;
  }

  try {
    const result = await action(global);
    emitSuccess(commandName, result, global);
  } catch (err) {
    const cliErr = toCliError(err);
    emitError(cliErr, global);
    process.exitCode = exitCodeForError(cliErr);
  }
}

function createProgram(): Command {
  const program = sharedFlags(new Command());
  program
    .name("spm")
    .description("Spotify playlist and account manager CLI")
    .version(readVersion(), "--version", "Output version")
    .configureOutput({
      outputError: () => {
        // Errors are formatted through emitError for consistent exit code mapping.
      }
    })
    .exitOverride();

  const playlist = program
    .command("playlist")
    .description("Playlist management commands (no legacy alias support)");
  sharedFlags(playlist);

  playlist
    .command("get")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .option("--tracks", "Include tracks (paginate)")
    .option("--limit <N>", "If --tracks, limit how many tracks to fetch", parsePositiveIntOption("limit"))
    .option("--offset <N>", "If --tracks, start offset (0-based)", parseNonNegativeIntOption("offset"))
    .action(async (input: string, options: { tracks?: boolean; limit?: number; offset?: number }, command: Command) => {
      await runHandled("playlist.get", command, async (global) =>
        runPlaylistGetManaged(input, {
          tracks: Boolean(options.tracks),
          limit: options.limit,
          offset: options.offset,
          market: global.market,
          timeoutMs: global.timeoutMs,
          account: global.account
        })
      );
    });
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("list")
    .option("--all", "Fetch all playlists with pagination")
    .option("--limit <N>", "Limit page size", parsePositiveIntOption("limit"))
    .option("--offset <N>", "Offset", parseNonNegativeIntOption("offset"))
    .action(async (options: { all?: boolean; limit?: number; offset?: number }, command: Command) => {
      await runHandled("playlist.list", command, async (global) =>
        runPlaylistListManaged({
          all: Boolean(options.all),
          limit: options.limit,
          offset: options.offset,
          timeoutMs: global.timeoutMs,
          account: global.account
        })
      );
    });
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("create")
    .requiredOption("--name <name>", "Playlist name")
    .option("--description <text>", "Playlist description")
    .option("--public", "Create as public playlist")
    .option("--private", "Create as private playlist")
    .option("--collaborative", "Create as collaborative playlist (requires private)")
    .action(
      async (
        options: { name: string; description?: string; public?: boolean; private?: boolean; collaborative?: boolean },
        command: Command
      ) => {
        await runHandled("playlist.create", command, async (global) => {
          if (options.public && options.private) {
            throw new CliError("INVALID_USAGE", "Use either --public or --private, not both.");
          }
          const isPublic = options.public ? true : options.private ? false : undefined;
          return runPlaylistCreateManaged({
            name: options.name,
            description: options.description,
            public: isPublic,
            collaborative: options.collaborative ? true : undefined,
            timeoutMs: global.timeoutMs,
            account: global.account
          });
        });
      }
    );
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("update")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .option("--name <name>", "New playlist name")
    .option("--description <text>", "New playlist description")
    .option("--public", "Set playlist public")
    .option("--private", "Set playlist private")
    .option("--collaborative", "Set collaborative=true")
    .option("--no-collaborative", "Set collaborative=false")
    .action(
      async (
        input: string,
        options: {
          name?: string;
          description?: string;
          public?: boolean;
          private?: boolean;
          collaborative?: boolean;
        },
        command: Command
      ) => {
        await runHandled("playlist.update", command, async (global) => {
          if (options.public && options.private) {
            throw new CliError("INVALID_USAGE", "Use either --public or --private, not both.");
          }
          const publicFlag = options.public ? true : options.private ? false : undefined;
          const collabSource = command.getOptionValueSource("collaborative");
          const collaborative = collabSource === "default" ? undefined : Boolean(options.collaborative);
          return runPlaylistUpdateManaged(input, {
            name: options.name,
            description: options.description,
            public: publicFlag,
            collaborative,
            timeoutMs: global.timeoutMs,
            account: global.account
          });
        });
      }
    );
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("add")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .argument("<track_refs>", "Track refs (comma/newline), or '-' for stdin")
    .requiredOption("--pos <N>", "1-based position to insert at", parsePositiveIntOption("pos"))
    .action(async (input: string, trackRefs: string, options: { pos: number }, command: Command) => {
      await runHandled("playlist.add", command, async (global) =>
        runPlaylistAddManaged(input, trackRefs, {
          pos: options.pos,
          noInput: global.noInput,
          timeoutMs: global.timeoutMs,
          account: global.account
        })
      );
    });
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("generate")
    .argument("<seed_track_refs>", "3-5 track refs (comma/newline), or '-' for stdin")
    .option("--target-size <N>", "Target number of tracks (1-100)", parsePositiveIntOption("target-size"))
    .option("--min-popularity <N>", "Minimum track popularity (0-100)", (value: string) => {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 100) {
        throw new CliError("INVALID_USAGE", "min-popularity must be an integer between 0 and 100.");
      }
      return n;
    })
    .option("--max-duration-ms <N>", "Maximum track duration in ms", parsePositiveIntOption("max-duration-ms"))
    .option("--exclude <track_refs>", "Exclude track refs from result")
    .option("--to <target_ref>", "Target existing playlist URL/URI/ID")
    .option("--to-new", "Create a new target playlist")
    .option("--name <name>", "Target playlist name for --to-new")
    .option("--description <text>", "Target playlist description for --to-new")
    .addOption(new Option("--mode <mode>", "append|replace (for --to)").choices(["append", "replace"]))
    .option("--public", "For --to-new, create as public")
    .option("--private", "For --to-new, create as private")
    .option("--no-seed-profile", "Disable seed-derived recommendation profile")
    .option("--no-diversify-keys", "Disable key diversity filter")
    .option("--max-key-share <N>", "Max share per musical key (1-100), percent of target", (value: string) => {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 100) {
        throw new CliError("INVALID_USAGE", "max-key-share must be an integer between 1 and 100.");
      }
      return n;
    })
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard for --mode replace")
    .action(
      async (
        seedInput: string,
        options: {
          targetSize?: number;
          minPopularity?: number;
          maxDurationMs?: number;
          exclude?: string;
          to?: string;
          toNew?: boolean;
          name?: string;
          description?: string;
          mode?: "append" | "replace";
          public?: boolean;
          private?: boolean;
          seedProfile?: boolean;
          diversifyKeys?: boolean;
          maxKeyShare?: number;
          apply?: boolean;
          force?: boolean;
        },
        command: Command
      ) => {
        await runHandled("playlist.generate", command, async (global) => {
          if (options.public && options.private) {
            throw new CliError("INVALID_USAGE", "Use either --public or --private, not both.");
          }
          const excludeTrackUris = options.exclude
            ? await parseTrackUrisInput(options.exclude, {
                noInput: global.noInput
              })
            : [];
          const isPublic = options.public ? true : options.private ? false : undefined;
          return runPlaylistGenerateManaged(seedInput, {
            targetSize: options.targetSize ?? 100,
            minPopularity: options.minPopularity ?? 30,
            maxDurationMs: options.maxDurationMs ?? 240000,
            excludeTrackUris,
            to: options.to,
            toNew: Boolean(options.toNew),
            name: options.name,
            description: options.description,
            mode: options.mode,
            isPublic,
            seedProfile: options.seedProfile ?? true,
            diversifyKeys: options.diversifyKeys ?? true,
            maxKeySharePercent: options.maxKeyShare ?? 25,
            apply: Boolean(options.apply),
            force: Boolean(options.force),
            noInput: global.noInput,
            market: global.market,
            timeoutMs: global.timeoutMs,
            account: global.account
          });
        });
      }
    );
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("shuffle")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .option("--group-size <N>", "Shuffle inside sequential groups of N tracks", parsePositiveIntOption("group-size"))
    .option("--groups <N>", "Split into N groups and shuffle inside each", parsePositiveIntOption("groups"))
    .option("--seed <N>", "Deterministic seed for shuffle", parseNonNegativeIntOption("seed"))
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard")
    .action(
      async (
        input: string,
        options: { groupSize?: number; groups?: number; seed?: number; apply?: boolean; force?: boolean },
        command: Command
      ) => {
        await runHandled("playlist.shuffle", command, async (global) =>
          runPlaylistShuffleManaged(input, {
            groupSize: options.groupSize,
            groups: options.groups,
            seed: options.seed,
            apply: Boolean(options.apply),
            force: Boolean(options.force),
            timeoutMs: global.timeoutMs,
            account: global.account
          })
        );
      }
    );
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("dedup")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .addOption(new Option("--keep <mode>", "Which duplicate to keep").choices(["first", "last"]).default("first"))
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard")
    .action(async (input: string, options: { keep?: "first" | "last"; apply?: boolean; force?: boolean }, command: Command) => {
      await runHandled("playlist.dedup", command, async (global) =>
        runPlaylistDedupManaged(input, {
          keep: options.keep ?? "first",
          apply: Boolean(options.apply),
          force: Boolean(options.force),
          timeoutMs: global.timeoutMs,
          account: global.account
        })
      );
    });
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("cleanup")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard")
    .action(async (input: string, options: { apply?: boolean; force?: boolean }, command: Command) => {
      await runHandled("playlist.cleanup", command, async (global) =>
        runPlaylistCleanupManaged(input, {
          market: global.market,
          apply: Boolean(options.apply),
          force: Boolean(options.force),
          timeoutMs: global.timeoutMs,
          account: global.account
        })
      );
    });
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("sort")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .addOption(new Option("--by <field>", "Sort field").choices(["added_at", "popularity"]).makeOptionMandatory())
    .addOption(new Option("--order <dir>", "Sort direction").choices(["asc", "desc"]).default("asc"))
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard")
    .action(
      async (
        input: string,
        options: { by?: "added_at" | "popularity"; order?: "asc" | "desc"; apply?: boolean; force?: boolean },
        command: Command
      ) => {
        await runHandled("playlist.sort", command, async (global) =>
          runPlaylistSortManaged(input, {
            by: options.by ?? "added_at",
            order: options.order ?? "asc",
            apply: Boolean(options.apply),
            force: Boolean(options.force),
            timeoutMs: global.timeoutMs,
            account: global.account
          })
        );
      }
    );
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("reverse")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard")
    .action(async (input: string, options: { apply?: boolean; force?: boolean }, command: Command) => {
      await runHandled("playlist.reverse", command, async (global) =>
        runPlaylistReverseManaged(input, {
          apply: Boolean(options.apply),
          force: Boolean(options.force),
          timeoutMs: global.timeoutMs,
          account: global.account
        })
      );
    });
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("trim")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .requiredOption("--keep <N>", "Keep N tracks", parseNonNegativeIntOption("keep"))
    .addOption(new Option("--from <side>", "Keep from start or end").choices(["start", "end"]).default("start"))
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard")
    .action(
      async (
        input: string,
        options: { keep: number; from?: "start" | "end"; apply?: boolean; force?: boolean },
        command: Command
      ) => {
        await runHandled("playlist.trim", command, async (global) =>
          runPlaylistTrimManaged(input, {
            keep: options.keep,
            from: options.from ?? "start",
            apply: Boolean(options.apply),
            force: Boolean(options.force),
            timeoutMs: global.timeoutMs,
            account: global.account
          })
        );
      }
    );
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("copy")
    .argument("<source_ref>", "Source playlist URL/URI/ID")
    .option("--to <target_ref>", "Target existing playlist URL/URI/ID")
    .option("--to-new", "Create a new target playlist")
    .option("--name <name>", "Target playlist name for --to-new")
    .option("--description <text>", "Target playlist description for --to-new")
    .addOption(new Option("--mode <mode>", "append|replace (for --to)").choices(["append", "replace"]).default("append"))
    .option("--public", "For --to-new, create as public")
    .option("--private", "For --to-new, create as private")
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard")
    .action(
      async (
        sourceInput: string,
        options: {
          to?: string;
          toNew?: boolean;
          name?: string;
          description?: string;
          mode?: "append" | "replace";
          public?: boolean;
          private?: boolean;
          apply?: boolean;
          force?: boolean;
        },
        command: Command
      ) => {
        await runHandled("playlist.copy", command, async (global) => {
          if (options.public && options.private) {
            throw new CliError("INVALID_USAGE", "Use either --public or --private, not both.");
          }
          const isPublic = options.public ? true : options.private ? false : undefined;
          return runPlaylistCopyManaged(sourceInput, {
            to: options.to,
            toNew: Boolean(options.toNew),
            name: options.name,
            description: options.description,
            mode: options.mode,
            isPublic,
            apply: Boolean(options.apply),
            force: Boolean(options.force),
            timeoutMs: global.timeoutMs,
            account: global.account
          });
        });
      }
    );
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("export")
    .argument("<ref>", "Playlist URL/URI/ID")
    .option("--out <pathOrDash>", "Write base64 output to file path or '-' for stdout", "-")
    .action(async (input: string, options: { out?: string }, command: Command) => {
      await runHandled("playlist.export", command, async (global) =>
        runPlaylistExportManaged(input, {
          out: options.out,
          timeoutMs: global.timeoutMs,
          account: global.account
        })
      );
    });
  sharedFlags(playlist.commands.at(-1)!);

  playlist
    .command("import")
    .argument("<base64>", "Base64 payload or '-' for stdin")
    .option("--to <target_ref>", "Target existing playlist URL/URI/ID")
    .option("--to-new", "Create a new target playlist")
    .option("--name <name>", "Target playlist name for --to-new")
    .option("--description <text>", "Target playlist description for --to-new")
    .addOption(new Option("--mode <mode>", "append|replace (for --to)").choices(["append", "replace"]).default("append"))
    .option("--public", "For --to-new, create as public")
    .option("--private", "For --to-new, create as private")
    .option("--apply", "Apply changes")
    .option("--force", "Bypass snapshot guard")
    .action(
      async (
        base64Input: string,
        options: {
          to?: string;
          toNew?: boolean;
          name?: string;
          description?: string;
          mode?: "append" | "replace";
          public?: boolean;
          private?: boolean;
          apply?: boolean;
          force?: boolean;
        },
        command: Command
      ) => {
        await runHandled("playlist.import", command, async (global) => {
          if (options.public && options.private) {
            throw new CliError("INVALID_USAGE", "Use either --public or --private, not both.");
          }
          const isPublic = options.public ? true : options.private ? false : undefined;
          return runPlaylistImportManaged(base64Input, {
            to: options.to,
            toNew: Boolean(options.toNew),
            name: options.name,
            description: options.description,
            mode: options.mode,
            isPublic,
            noInput: global.noInput,
            apply: Boolean(options.apply),
            force: Boolean(options.force),
            timeoutMs: global.timeoutMs,
            account: global.account
          });
        });
      }
    );
  sharedFlags(playlist.commands.at(-1)!);

  const playlistCover = playlist.command("cover").description("Playlist cover operations");

  playlistCover
    .command("get")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .action(async (input: string, _options: unknown, command: Command) => {
      await runHandled("playlist.cover.get", command, async (global) =>
        runPlaylistCoverGetManaged(input, {
          timeoutMs: global.timeoutMs,
          account: global.account
        })
      );
    });
  sharedFlags(playlistCover.commands.at(-1)!);

  playlistCover
    .command("set")
    .argument("<ref>", "Spotify playlist URL/URI/ID")
    .option("--file <jpg>", "Path to JPG file")
    .option("--base64 <data>", "Base64-encoded JPEG data")
    .option("--apply", "Apply upload")
    .action(
      async (
        input: string,
        options: { file?: string; base64?: string; apply?: boolean },
        command: Command
      ) => {
        await runHandled("playlist.cover.set", command, async (global) =>
          runPlaylistCoverSetManaged(input, {
            file: options.file,
            base64: options.base64,
            apply: Boolean(options.apply),
            timeoutMs: global.timeoutMs,
            account: global.account
          })
        );
      }
    );
  sharedFlags(playlistCover.commands.at(-1)!);

  const account = program
    .command("account")
    .description("Manage Spotify user accounts for playlist operations");

  account
    .command("login")
    .option("--name <alias>", "Optional local alias for this account")
    .option("--no-open", "Do not automatically open the authorization URL in a browser")
    .option("--callback-port <N>", "OAuth callback port", parsePositiveIntOption("callback-port"))
    .option("--redirect-uri <uri>", "Explicit OAuth redirect URI (must match Spotify app settings)")
    .option("--scopes <csv>", "Override OAuth scopes (comma or space separated)")
    .action(
      async (
        options: { name?: string; noOpen?: boolean; callbackPort?: number; redirectUri?: string; scopes?: string },
        command: Command
      ) => {
        await runHandled("account.login", command, async (global) =>
          runAccountLogin({
            name: options.name,
            noOpen: Boolean(options.noOpen),
            callbackPort: options.callbackPort,
            redirectUri: options.redirectUri,
            scopes: options.scopes,
            timeoutMs: global.timeoutMs
          })
        );
      }
    );
  sharedFlags(account.commands.at(-1)!);

  account
    .command("import")
    .argument("<base64>", "Base64 account token bundle v2 or '-' for stdin")
    .option("--name <alias>", "Optional local alias for this account")
    .action(async (base64Input: string, options: { name?: string }, command: Command) => {
      await runHandled("account.import", command, async (global) =>
        runAccountImport(base64Input, {
          name: options.name,
          noInput: global.noInput
        })
      );
    });
  sharedFlags(account.commands.at(-1)!);

  account
    .command("export")
    .argument("[account]", "Account id/name (defaults to active account)")
    .action(async (accountRef: string | undefined, _options: unknown, command: Command) => {
      await runHandled("account.export", command, async () => runAccountExport(accountRef));
    });
  sharedFlags(account.commands.at(-1)!);

  account
    .command("list")
    .action(async (_options: unknown, command: Command) => {
      await runHandled("account.list", command, async () => runAccountList());
    });
  sharedFlags(account.commands.at(-1)!);

  account
    .command("use")
    .argument("<account>", "Account id or alias")
    .action(async (accountRef: string, _options: unknown, command: Command) => {
      await runHandled("account.use", command, async () => runAccountUse(accountRef));
    });
  sharedFlags(account.commands.at(-1)!);

  account
    .command("show")
    .argument("[account]", "Account id or alias (defaults to active account)")
    .action(async (accountRef: string | undefined, _options: unknown, command: Command) => {
      await runHandled("account.show", command, async () => runAccountShow(accountRef));
    });
  sharedFlags(account.commands.at(-1)!);

  account
    .command("remove")
    .argument("<account>", "Account id or alias")
    .option("--force", "Confirm account removal")
    .action(async (accountRef: string, options: { force?: boolean }, command: Command) => {
      await runHandled("account.remove", command, async () =>
        runAccountRemove(accountRef, {
          force: Boolean(options.force)
        })
      );
    });
  sharedFlags(account.commands.at(-1)!);

  program
    .command("completion")
    .argument("<shell>", "bash|zsh|fish")
    .action(async (shell: string, _options: unknown, command: Command) => {
      await runHandled("completion", command, async () => {
        const script = completionScriptFor(shell);
        return {
          data: { shell, script },
          human: script.trimEnd().split("\n"),
          source: "api",
          warnings: []
        };
      });
    });
  sharedFlags(program.commands.at(-1)!);

  return program;
}

async function main(): Promise<void> {
  process.on("SIGINT", () => {
    const opts = fallbackOptionsFromArgv(process.argv);
    emitError(new CliError("INTERRUPTED", "Interrupted by user."), opts);
    process.exit(130);
  });

  const program = createProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
        process.exit(0);
      }
      const opts = fallbackOptionsFromArgv(process.argv);
      const cliErr = new CliError("INVALID_USAGE", err.message.replace(/^error:\s*/i, ""), {
        hint: "Run with --help to see usage."
      });
      emitError(cliErr, opts);
      process.exit(exitCodeForError(cliErr));
    }

    const opts = fallbackOptionsFromArgv(process.argv);
    const cliErr = toCliError(err);
    emitError(cliErr, opts);
    process.exit(exitCodeForError(cliErr));
  }
}

main().catch((err) => {
  const opts = fallbackOptionsFromArgv(process.argv);
  const cliErr = toCliError(err);
  emitError(cliErr, opts);
  process.exit(exitCodeForError(cliErr));
});
