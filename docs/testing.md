# Testing

## Test Layers

- Unit:
  - parser behavior
  - error serialization and exit-code mapping
  - account bundle/store v2 validation
  - playlist transform algorithms
- Contract (mocked API):
  - playlist mutation request shapes (`/items`, chunking, snapshot guard)
- CLI integration:
  - help/version and parse behavior
  - stdout/stderr split
  - account/playlist command wiring
  - no legacy alias behavior
- Live opt-in:
  - authenticated smoke checks for playlist/account flow

## Commands

Run default test suite (offline + mocked):

```bash
npm test
```

Run live tests (opt-in):

```bash
SPM_CLIENT_ID=...
SPM_CLIENT_SECRET=...
npm run test:live
```

`npm run test:live` sets `SPM_LIVE_TEST=1` internally and executes the full suite including live smoke checks.

## Notes

- Contract tests for playlist management use mocked account store via `SPM_ACCOUNTS_PATH`.
- Destructive playlist operations are validated in preview and apply modes.
