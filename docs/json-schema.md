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
