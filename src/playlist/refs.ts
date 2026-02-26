import { CliError } from "../errors";
import { parseIdForType, parseSpotifyRef } from "../parser";
import { readStdinTextOrThrow } from "../stdin";

function splitRefs(raw: string): string[] {
  return raw
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function parsePlaylistId(input: string): string {
  return parseIdForType(input, "playlist");
}

export function toTrackUri(input: string): string {
  const ref = parseSpotifyRef(input);
  if (ref.type && ref.type !== "track") {
    throw new CliError("INVALID_USAGE", `Expected track reference, got ${ref.type}.`, {
      hint: "Provide Spotify track URL/URI/ID values only."
    });
  }
  return `spotify:track:${ref.id}`;
}

export async function parseTrackUrisInput(
  rawInput: string,
  opts: { noInput: boolean }
): Promise<string[]> {
  const resolved = rawInput === "-"
    ? await readStdinTextOrThrow(opts.noInput, "Pipe track refs to stdin or pass them as argument.")
    : rawInput;
  const refs = splitRefs(resolved);
  if (refs.length === 0) {
    throw new CliError("INVALID_USAGE", "No track references were provided.");
  }
  return refs.map(toTrackUri);
}
