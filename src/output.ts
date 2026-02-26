import { CliError, toJsonErrorPayload } from "./errors";
import { CommandResult, GlobalOptions } from "./types";

type JsonSuccessEnvelope = {
  ok: true;
  command: string;
  data: unknown;
  meta: {
    source: "api" | "embed" | "experimental";
    market?: string;
    warnings: string[];
    raw?: unknown;
  };
};

export function emitSuccess(
  command: string,
  result: CommandResult,
  opts: GlobalOptions
): void {
  const warnings = result.warnings ?? [];

  if (opts.json) {
    const envelope: JsonSuccessEnvelope = {
      ok: true,
      command,
      data: result.data,
      meta: {
        source: result.source ?? "api",
        market: result.market,
        warnings
      }
    };
    if (opts.raw) {
      envelope.meta.raw = result.raw ?? result.data;
    }
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  for (const line of result.human) {
    process.stdout.write(`${line}\n`);
  }

  if (!opts.quiet) {
    for (const warning of warnings) {
      process.stderr.write(`Warning: ${warning}\n`);
    }
  }
}

export function emitError(err: CliError, opts: GlobalOptions): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(toJsonErrorPayload(err), null, 2)}\n`);
    return;
  }

  process.stderr.write(`Error: ${err.message}\n`);
  if (err.hint) process.stderr.write(`Hint: ${err.hint}\n`);
  if (opts.verbose && err.details !== undefined) {
    process.stderr.write(`Details: ${JSON.stringify(err.details, null, 2)}\n`);
  }
}
