# JSON Output Schema

All commands support `--json`.

## Success Envelope

```json
{
  "ok": true,
  "command": "playlist.dedup",
  "data": {},
  "meta": {
    "source": "api",
    "market": "US",
    "warnings": [],
    "raw": {}
  }
}
```

Notes:

- `command`: executed command identifier (examples: `playlist.get`, `playlist.dedup`, `account.list`).
- `playlist.generate` returns:
  - `data.seed_count`: number of unique seed tracks used.
  - `data.target_size`: configured target track count.
  - `data.generated_count`: number of tracks in resulting payload.
  - `data.shortfall`: non-negative shortfall to target.
  - `data.filtered_count`: number of dropped tracks from source filters and key diversity.
  - `data.track_uris`: resulting tracks.
  - `data.apply`: whether changes are applied.
  - `data.target`: `existing` or `new`.
  - `data.filter_config`: chosen filter config (`min_popularity`, `max_duration_ms`, `seed_profile`, `diversify_keys`, `max_key_share`, `excluded`).
  - `data.filter_stats`: detailed drop counters and profile/key availability.
  - `data.playlist_id`: set when target playlist is known.
  - `data.snapshot_id`: set when changes were applied.
  - `data.result`: replace-mode metadata (`before_count`, `after_count`, etc.).
- `data`: command-specific payload.
- `meta.source`: one of `api`, `experimental`.
- `meta.market`: present when a market is in effect.
- `meta.warnings`: list of non-fatal warnings.
- `meta.raw`: present only when `--raw` is used.

## Error Envelope

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Playlist not found: ...",
    "hint": "..."
  }
}
```

Error `code` values:

- `INVALID_USAGE`
- `AUTH_CONFIG`
- `NETWORK`
- `SPOTIFY_API`
- `NOT_FOUND`
- `EXPERIMENTAL_UNAVAILABLE`
- `INTERNAL`
- `INTERRUPTED`
