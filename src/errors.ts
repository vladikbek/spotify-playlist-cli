export type CliErrorCode =
  | "INVALID_USAGE"
  | "AUTH_CONFIG"
  | "NETWORK"
  | "SPOTIFY_API"
  | "NOT_FOUND"
  | "EXPERIMENTAL_UNAVAILABLE"
  | "INTERNAL"
  | "INTERRUPTED";

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: CliErrorCode, message: string, opts?: { hint?: string; details?: unknown }) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.hint = opts?.hint;
    this.details = opts?.details;
  }
}

const EXIT_CODE_BY_ERROR: Record<CliErrorCode, number> = {
  INVALID_USAGE: 2,
  AUTH_CONFIG: 3,
  NETWORK: 4,
  SPOTIFY_API: 5,
  NOT_FOUND: 6,
  EXPERIMENTAL_UNAVAILABLE: 7,
  INTERNAL: 1,
  INTERRUPTED: 130
};

export function exitCodeForError(err: CliError): number {
  return EXIT_CODE_BY_ERROR[err.code] ?? 1;
}

export function toCliError(err: unknown): CliError {
  if (err instanceof CliError) return err;
  if (err instanceof Error) {
    return new CliError("INTERNAL", err.message);
  }
  return new CliError("INTERNAL", String(err));
}

export function toJsonErrorPayload(err: CliError): {
  ok: false;
  error: { code: CliErrorCode; message: string; hint?: string };
} {
  const payload: { ok: false; error: { code: CliErrorCode; message: string; hint?: string } } = {
    ok: false,
    error: {
      code: err.code,
      message: err.message
    }
  };
  if (err.hint) payload.error.hint = err.hint;
  return payload;
}
