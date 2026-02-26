type NextData = any;

function extractNextDataJson(html: string): NextData {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("Unable to parse embed page (__NEXT_DATA__ missing).");
  return JSON.parse(m[1]);
}

export type EmbedPlaylist = {
  id: string;
  name: string;
  ownerName?: string;
  ownerId?: string;
  description?: string;
  totalTracks?: number;
  images: Array<{ url: string; width?: number; height?: number }>;
  tracks: Array<{ title: string; subtitle: string; duration_ms?: number; uri?: string }>;
};

function parsePlaylistOwnerFromUri(uri: string | undefined): { ownerId?: string } {
  if (!uri) return {};
  // spotify:user:<ownerId>:playlist:<playlistId>
  const parts = uri.split(":");
  const userIdx = parts.indexOf("user");
  if (userIdx !== -1 && parts[userIdx + 1] && parts[userIdx + 2] === "playlist") {
    return { ownerId: parts[userIdx + 1] };
  }
  return {};
}

export async function fetchEmbedPlaylist(playlistId: string): Promise<EmbedPlaylist> {
  const url = `https://open.spotify.com/embed/playlist/${playlistId}?utm_source=oembed`;
  const res = await fetch(url, {
    headers: {
      // Spotify blocks some botty requests; a plain UA helps.
      "user-agent": "Mozilla/5.0",
      accept: "text/html"
    }
  });
  if (!res.ok) {
    throw new Error(`Embed fetch failed: HTTP ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const next = extractNextDataJson(html);

  const entity = next?.props?.pageProps?.state?.data?.entity;
  if (!entity || entity.id !== playlistId) {
    throw new Error("Unable to parse embed playlist entity.");
  }

  const attrs: Array<{ key: string; value: string }> = entity.attributes || [];
  const description = attrs.find((a) => a.key === "episode_description")?.value;

  const images =
    (entity.visualIdentity?.image || []).map((i: any) => ({
      url: i.url,
      width: i.maxWidth,
      height: i.maxHeight
    })) ?? [];

  const tracks =
    (entity.trackList || []).map((t: any) => ({
      title: t.title,
      subtitle: t.subtitle,
      duration_ms: t.duration,
      uri: t.uri
    })) ?? [];

  const { ownerId } = parsePlaylistOwnerFromUri(entity.uri);

  return {
    id: playlistId,
    name: entity.name ?? entity.title ?? `playlist:${playlistId}`,
    ownerName: entity.subtitle,
    ownerId,
    description,
    totalTracks: tracks.length,
    images,
    tracks
  };
}

export async function fetchOpenPlaylistSavesText(playlistId: string): Promise<string | undefined> {
  const url = `https://open.spotify.com/playlist/${playlistId}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } });
  if (!res.ok) return undefined;
  const html = await res.text();
  const m = html.match(/<meta property="og:description" content="([^"]+)"\/?>/);
  return m?.[1];
}

