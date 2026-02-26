# @vbr/spotify-playlist-cli

`spm` is a Node.js/TypeScript CLI for Spotify account and playlist management.

This tool is intentionally separate from public-read Spotify CLIs and does not include backward compatibility with legacy account/import formats.

## Setup

1. Copy `.env.example` to `.env` and set:
   - `SPM_CLIENT_ID`
   - `SPM_CLIENT_SECRET`
2. Install/build:

```bash
npm install
npm run build
```

## Account Store

Default store path:
- `~/.config/spotify-playlist-cli/accounts.json`
- override with `SPM_ACCOUNTS_PATH`

## OAuth Redirect

- Default redirect: `http://127.0.0.1:43821/callback`
- Add the exact URI to Spotify Dashboard Redirect URIs.
- Override with `--redirect-uri` or `SPM_OAUTH_REDIRECT_URI`.

## Usage

```bash
spm [global flags] <command> [command flags] [args]
spm --version
spm <command> --help
```

Global flags:

- `--json`
- `--raw`
- `-q/--quiet`, `-v/--verbose`
- `--no-color`, `--no-input`
- `--timeout-ms <N>`
- `--market <XX>`
- `--account <name|id>`

## Commands

Account:

- `account login|import|export|list|use|show|remove`

Playlist management:

- `playlist get|list|create|update|add`
- `playlist shuffle|dedup|cleanup|sort|trim`
- `playlist copy|export|import`
- `playlist cover get|set`

There is no `playlist <ref>` legacy alias. Use `playlist get <ref>` explicitly.

## Preview/Apply Safety

Destructive playlist operations are preview-first:
- default: dry preview (no mutation)
- mutate only with `--apply`
- snapshot guard bypass: `--force`

## Examples

```bash
# Login and set active account
spm account login --name main

# List your playlists
spm playlist list --all --account main

# Add track to 1-based position 3
spm playlist add <playlist_ref> <track_ref> --pos 3 --account main

# Deduplicate (preview), then apply
spm playlist dedup <playlist_ref> --keep first --account main
spm playlist dedup <playlist_ref> --keep first --apply --account main

# Export/import tracks payload (spm v2 format)
spm playlist export <playlist_ref> --out backup.b64 --account main
spm playlist import - --to <playlist_ref> --mode replace --apply --account main < backup.b64
```

## Docs

- `docs/cli-contract.md`
- `docs/json-schema.md`
- `docs/testing.md`
