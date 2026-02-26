import fs from "node:fs";
import { CliError } from "../errors";

export type PlaylistTracksExportV2 = {
  version: 2;
  kind: "spm-playlist-tracks";
  source: {
    id: string;
    name?: string;
    exported_at: number;
  };
  tracks: string[];
};

export function encodePlaylistExport(payload: PlaylistTracksExportV2): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodePlaylistImport(input: string): PlaylistTracksExportV2 {
  let text: string;
  try {
    text = Buffer.from(input.trim(), "base64").toString("utf8");
  } catch {
    throw new CliError("INVALID_USAGE", "Invalid base64 playlist payload.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError("INVALID_USAGE", "Playlist payload must be JSON encoded in base64.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new CliError("INVALID_USAGE", "Playlist payload is not an object.");
  }

  const obj = parsed as Partial<PlaylistTracksExportV2>;
  if (obj.version !== 2 || obj.kind !== "spm-playlist-tracks" || !Array.isArray(obj.tracks)) {
    throw new CliError("INVALID_USAGE", "Unsupported playlist import payload format.");
  }

  const tracks = obj.tracks.filter((x): x is string => typeof x === "string" && x.startsWith("spotify:track:"));
  if (tracks.length !== obj.tracks.length) {
    throw new CliError("INVALID_USAGE", "Playlist import payload contains invalid track URIs.");
  }

  return {
    version: 2,
    kind: "spm-playlist-tracks",
    source: {
      id: obj.source?.id ?? "unknown",
      name: obj.source?.name,
      exported_at: obj.source?.exported_at ?? 0
    },
    tracks
  };
}

export function writeMaybeFile(pathOrDash: string | undefined, data: string): string | undefined {
  if (!pathOrDash || pathOrDash === "-") {
    return undefined;
  }
  fs.writeFileSync(pathOrDash, `${data}\n`, "utf8");
  return pathOrDash;
}
