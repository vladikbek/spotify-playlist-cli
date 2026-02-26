import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AccountBundleV2, AccountStoreV2 } from "../types";
import { CliError } from "../errors";

const STORE_VERSION = 2;

function defaultAccountsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, "spotify-playlist-cli", "accounts.json");
  return path.join(os.homedir(), ".config", "spotify-playlist-cli", "accounts.json");
}

export function resolveAccountsPath(): string {
  const fromEnv = process.env.SPM_ACCOUNTS_PATH?.trim();
  return fromEnv || defaultAccountsPath();
}

function emptyStore(): AccountStoreV2 {
  return {
    version: STORE_VERSION,
    accounts: []
  };
}

function normalizeToken(input: unknown): AccountBundleV2["token"] {
  if (!input || typeof input !== "object") {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: token payload is missing.");
  }

  const token = input as Record<string, unknown>;
  const access = typeof token.access_token === "string" ? token.access_token.trim() : "";
  const refresh = typeof token.refresh_token === "string" ? token.refresh_token.trim() : "";
  const tokenType = token.token_type;
  const expiresAt = token.expires_at;

  if (!access || !refresh) {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: access_token/refresh_token are required.");
  }
  if (tokenType !== "Bearer") {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: token_type must be 'Bearer'.");
  }
  if (!Number.isInteger(expiresAt) || Number(expiresAt) <= 0) {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: expires_at must be a positive integer.");
  }

  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer",
    expires_at: Number(expiresAt)
  };
}

function normalizeAccount(input: unknown): AccountBundleV2 {
  if (!input || typeof input !== "object") {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: account payload is malformed.");
  }

  const account = input as Record<string, unknown>;
  if (account.version !== STORE_VERSION) {
    throw new CliError("AUTH_CONFIG", `Unsupported account bundle version: ${String(account.version)}.`);
  }

  const id = typeof account.id === "string" ? account.id.trim() : "";
  const name = typeof account.name === "string" ? account.name.trim() : "";
  const displayName = typeof account.display_name === "string" ? account.display_name : undefined;
  const scopes = Array.isArray(account.scopes)
    ? account.scopes.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const source = account.source;
  const createdAt = account.created_at;
  const updatedAt = account.updated_at;

  if (!id || !name) {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: account id/name are required.");
  }
  if (source !== "oauth" && source !== "import") {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: account source must be 'oauth' or 'import'.");
  }
  if (!Number.isInteger(createdAt) || Number(createdAt) <= 0 || !Number.isInteger(updatedAt) || Number(updatedAt) <= 0) {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: created_at/updated_at must be positive integers.");
  }

  return {
    version: STORE_VERSION,
    id,
    name,
    display_name: displayName,
    scopes,
    token: normalizeToken(account.token),
    source,
    created_at: Number(createdAt),
    updated_at: Number(updatedAt)
  };
}

function normalizeStore(input: unknown): AccountStoreV2 {
  if (!input || typeof input !== "object") {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: JSON object expected.");
  }

  const raw = input as Record<string, unknown>;
  if (raw.version !== STORE_VERSION) {
    throw new CliError("AUTH_CONFIG", `Unsupported accounts store version: ${String(raw.version)}.`);
  }

  const accountsRaw = raw.accounts;
  if (!Array.isArray(accountsRaw)) {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: accounts must be an array.");
  }

  const accounts = accountsRaw.map((item) => normalizeAccount(item));
  const active = typeof raw.active_account_id === "string" && raw.active_account_id.trim()
    ? raw.active_account_id
    : undefined;

  if (active && !accounts.some((account) => account.id === active)) {
    throw new CliError("AUTH_CONFIG", "Invalid accounts store: active_account_id does not exist.");
  }

  return {
    version: STORE_VERSION,
    active_account_id: active,
    accounts
  };
}

export function readAccountStore(): AccountStoreV2 {
  const file = resolveAccountsPath();
  try {
    const raw = fs.readFileSync(file, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return emptyStore();
    }
    if (err instanceof CliError) {
      throw err;
    }
    throw new CliError("AUTH_CONFIG", "Failed to read account store file.", {
      hint: `Fix or remove ${file}.`,
      details: err
    });
  }
}

function ensurePrivateFile(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best effort only (e.g. Windows)
  }
}

export function writeAccountStore(store: AccountStoreV2): void {
  if (store.version !== STORE_VERSION) {
    throw new CliError("INTERNAL", `Account store version must be ${STORE_VERSION}.`);
  }

  const file = resolveAccountsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
  ensurePrivateFile(file);
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function findAccountByRef(
  store: AccountStoreV2,
  ref: string
): AccountBundleV2 | undefined {
  const id = ref.trim();
  if (!id) return undefined;
  const byId = store.accounts.find((a) => a.id === id);
  if (byId) return byId;
  const key = normalizeName(id);
  return store.accounts.find((a) => normalizeName(a.name) === key);
}

export function resolveRequestedAccountRef(explicit?: string): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  const fromEnv = process.env.SPM_ACCOUNT?.trim();
  if (fromEnv) return fromEnv;
  return undefined;
}

export function resolveAccountFromStore(
  store: AccountStoreV2,
  opts?: { explicitRef?: string }
): AccountBundleV2 {
  const explicitRef = resolveRequestedAccountRef(opts?.explicitRef);
  const account = explicitRef
    ? findAccountByRef(store, explicitRef)
    : store.active_account_id
      ? findAccountByRef(store, store.active_account_id)
      : undefined;

  if (!account) {
    throw new CliError("AUTH_CONFIG", "No active Spotify account is configured.", {
      hint: "Use 'spm account login', 'spm account import', or 'spm account use <name>'."
    });
  }

  return account;
}

export function upsertAccount(store: AccountStoreV2, incoming: AccountBundleV2): AccountStoreV2 {
  const idx = store.accounts.findIndex((x) => x.id === incoming.id);
  const out: AccountStoreV2 = {
    version: STORE_VERSION,
    active_account_id: store.active_account_id,
    accounts: [...store.accounts]
  };
  if (idx >= 0) {
    out.accounts[idx] = incoming;
  } else {
    out.accounts.push(incoming);
  }
  if (!out.active_account_id) {
    out.active_account_id = incoming.id;
  }
  return out;
}

export function setActiveAccount(store: AccountStoreV2, ref: string): AccountStoreV2 {
  const account = findAccountByRef(store, ref);
  if (!account) {
    throw new CliError("NOT_FOUND", `Account not found: ${ref}`);
  }
  return {
    ...store,
    active_account_id: account.id
  };
}

export function removeAccount(store: AccountStoreV2, ref: string): AccountStoreV2 {
  const account = findAccountByRef(store, ref);
  if (!account) {
    throw new CliError("NOT_FOUND", `Account not found: ${ref}`);
  }
  const accounts = store.accounts.filter((x) => x.id !== account.id);
  const active = store.active_account_id === account.id ? accounts[0]?.id : store.active_account_id;
  return {
    version: STORE_VERSION,
    active_account_id: active,
    accounts
  };
}
