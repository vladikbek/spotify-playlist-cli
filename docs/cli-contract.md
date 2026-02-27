# CLI Contract

## Usage

```bash
spm [global flags] <command> [command flags] [args]
spm <command> --help
spm --version
```

## Command Groups

Account commands:

- `account login [--name <alias>] [--no-open] [--callback-port <N>] [--redirect-uri <uri>] [--scopes <csv>]`
- `account import <base64|'-'> [--name <alias>]`
- `account export [account]`
- `account list`
- `account use <account>`
- `account show [account]`
- `account remove <account> --force`

Playlist management commands:

- `playlist get <ref> [--tracks] [--limit <N>] [--offset <N>]`
- `playlist list [--all] [--limit <N>] [--offset <N>]`
- `playlist create --name <name> [--description <text>] [--public|--private] [--collaborative]`
- `playlist random [--name <name>] [--description <text>] [--genre <genre>] [--public|--private]`
- `playlist generate <seed_track_refs|'-'> [--target-size <N>] [--min-popularity <N>] [--max-duration-ms <N>] [--exclude <track_refs>] [--to <target_ref>|--to-new] [--name <name>] [--description <text>] [--mode append|replace] [--public|--private] [--seed-profile] [--no-seed-profile] [--diversify-keys] [--no-diversify-keys] [--max-key-share <N>] [--apply] [--force]`
- `playlist update <ref> [--name <name>] [--description <text>] [--public|--private] [--collaborative|--no-collaborative]`
- `playlist add <ref> <track_refs|'-'> --pos <1-based>`
- `playlist shuffle <ref> [--group-size <N>|--groups <N>] [--seed <N>] [--apply] [--force]`
- `playlist dedup <ref> [--keep first|last] [--apply] [--force]`
- `playlist cleanup <ref> [--market <XX>] [--apply] [--force]`
- `playlist sort <ref> --by added_at|popularity [--order asc|desc] [--apply] [--force]`
- `playlist trim <ref> --keep <N> [--from start|end] [--apply] [--force]`
- `playlist reverse <ref> [--apply] [--force]`
- `playlist copy <source_ref> --to <target_ref> --mode append|replace [--apply] [--force]`
- `playlist copy <source_ref> --to-new --name <name> [--public|--private] [--description <text>] [--apply]`
- `playlist export <ref> [--out <path|->]`
- `playlist import <base64|'-'> (--to <target_ref>|--to-new) [--mode append|replace] [--name <name>] [--description <text>] [--apply] [--force]`
- `playlist cover get <ref>`
- `playlist cover set <ref> (--file <jpg>|--base64 <data>) [--apply]`

No legacy alias is supported: `playlist <ref>` is invalid. Use `playlist get <ref>`.

## Global Flags

- `--json`
- `--raw`
- `-q, --quiet`
- `-v, --verbose`
- `--no-color`
- `--no-input`
- `--timeout-ms <N>`
- `--market <XX>`
- `--account <nameOrId>`
- `--version`
- `-h, --help`

## Playlist generate details

- `--target-size`: default `100`, must be `1..100`.
- `--min-popularity`: default `30`, must be `0..100`.
- `--max-duration-ms`: default `240000`.
- `--exclude`: comma/newline-separated track refs to filter out from recommendations.
- `--seed-profile` is enabled by default and applies quality-aware target attributes from seed audio features.
- `--no-seed-profile` disables seed-derived `target_*` query parameters; only quality filters are applied.
- `--diversify-keys` is enabled by default; `--no-diversify-keys` disables key share enforcement.
- `--max-key-share`: default `25`; valid only with `--diversify-keys`.

## Safety Rules

- Destructive playlist operations are preview-first.
- Persist changes only when `--apply` is provided.
- `--force` bypasses snapshot guard for non-critical race checks.

## Import/Export Compatibility

- `account import` accepts only `AccountBundleV2` payload (`kind: spm-account-bundle`, `version: 2`).
- `playlist import` accepts only `spm-playlist-tracks` payload (`version: 2`).
- Legacy payloads are intentionally rejected.

## Output Streams

- `stdout`: primary command output (human text or JSON envelope).
- `stderr`: diagnostics and human-mode errors only.

## Exit Codes

- `0`: success
- `1`: unexpected internal failure
- `2`: invalid usage or validation error
- `3`: auth/config error
- `4`: network/timeout/rate-limit exhaustion
- `5`: Spotify API error (non-404)
- `6`: not found
- `7`: experimental endpoint unavailable
- `130`: interrupted (Ctrl-C)

## Configuration and Precedence

Precedence: `flags > env > project .env`.

Supported env vars:

- `SPM_CLIENT_ID`
- `SPM_CLIENT_SECRET`
- `SPM_MARKET`
- `SPM_TIMEOUT_MS`
- `SPM_ACCOUNT`
- `SPM_ACCOUNTS_PATH`
- `SPM_OAUTH_CALLBACK_PORT`
- `SPM_OAUTH_REDIRECT_URI`
