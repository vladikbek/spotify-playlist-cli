import { ParsedSpotifyRef, SpotifyRefType } from "./types";
import { CliError } from "./errors";

function stripQueryAndHash(s: string): string {
  return s.split("?")[0]!.split("#")[0]!;
}

export function parseSpotifyRef(input: string): ParsedSpotifyRef {
  const raw = input.trim();
  if (!raw) {
    throw new CliError("INVALID_USAGE", "Missing Spotify ID/URL/URI.");
  }

  // spotify:track:<id>
  const uri = raw.startsWith("spotify:") ? raw : "";
  if (uri) {
    const parts = uri.split(":").filter(Boolean);
    // spotify:user:<userId>:playlist:<playlistId>
    if (parts[1] === "user" && parts[3] === "playlist" && parts[4]) {
      return { type: "playlist", id: parts[4] };
    }
    const t = parts[1] as SpotifyRefType | undefined;
    const id = parts[2];
    if (t && id) return { type: t, id };
  }

  // https://open.spotify.com/<type>/<id>
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const u = new URL(raw);
    const p = stripQueryAndHash(u.pathname).replace(/\/+$/, "");
    const seg = p.split("/").filter(Boolean);

    // /user/<userId>/playlist/<playlistId>
    if (seg[0] === "user" && seg[2] === "playlist" && seg[3]) {
      return { type: "playlist", id: seg[3] };
    }

    const type = seg[0] as SpotifyRefType | undefined;
    const id = seg[1];
    if (type && id) return { type, id };
  }

  // Raw ID (type unknown)
  return { id: raw };
}

export function parseIdForType(
  input: string,
  expectedType: SpotifyRefType
): string {
  const ref = parseSpotifyRef(input);
  if (ref.type && ref.type !== expectedType) {
    throw new CliError("INVALID_USAGE", `Expected a ${expectedType} reference, got ${ref.type}.`, {
      hint: `Provide a Spotify ${expectedType} URL, URI, or ID.`
    });
  }
  return ref.id;
}
