import { CliError } from "./errors";

export async function readStdinTextOrThrow(noInput: boolean, purposeHint: string): Promise<string> {
  if (noInput) {
    throw new CliError("INVALID_USAGE", "Standard input is disabled by --no-input.", {
      hint: purposeHint
    });
  }
  if (process.stdin.isTTY) {
    throw new CliError("INVALID_USAGE", "Expected data from stdin but stdin is a TTY.", {
      hint: purposeHint
    });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    throw new CliError("INVALID_USAGE", "No data was provided via stdin.", {
      hint: purposeHint
    });
  }
  return text;
}
