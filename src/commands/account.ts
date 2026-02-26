import { CommandResult } from "../types";
import { CliError } from "../errors";
import {
  findAccountByRef,
  readAccountStore,
  removeAccount,
  resolveAccountFromStore,
  setActiveAccount,
  writeAccountStore
} from "../auth/account-store";
import { encodeBase64Json, parseImportedBase64 } from "../auth/base64-bundle";
import { runOAuthLoopbackLogin } from "../auth/oauth-loopback";
import {
  createAccountBundle,
  exchangeAuthorizationCode,
  fetchCurrentUserProfile,
  saveAccountBundle
} from "../auth/user-token";
import { parseScopeList } from "../auth/scope";
import { pushKv } from "../format";
import { readStdinTextOrThrow } from "../stdin";

function requiredClientId(): string {
  const id = process.env.SPM_CLIENT_ID?.trim();
  if (!id) {
    throw new CliError("AUTH_CONFIG", "Missing SPM_CLIENT_ID.", {
      hint: "Set SPM_CLIENT_ID in env/.env before running account login."
    });
  }
  return id;
}

function unixNowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function expiresInSeconds(expiresAtMs: number): number {
  return Math.floor((expiresAtMs - Date.now()) / 1000);
}

function humanAccountLine(account: {
  id: string;
  name: string;
  display_name?: string;
  scopes: string[];
  expires_at: number;
  has_refresh: boolean;
  active: boolean;
}): string {
  const active = account.active ? "*" : " ";
  const display = account.display_name ? ` (${account.display_name})` : "";
  const expires = expiresInSeconds(account.expires_at);
  const refresh = account.has_refresh ? "refresh" : "access-only";
  return `${active} ${account.name}${display} [${account.id}] ${refresh} exp:${expires}s scopes:${account.scopes.length}`;
}

export async function runAccountLogin(opts: {
  name?: string;
  noOpen?: boolean;
  callbackPort?: number;
  redirectUri?: string;
  scopes?: string;
  timeoutMs: number;
}): Promise<CommandResult> {
  const scopes = parseScopeList(opts.scopes);
  const clientId = requiredClientId();

  const login = await runOAuthLoopbackLogin({
    clientId,
    scopes,
    callbackPort: opts.callbackPort,
    redirectUri: opts.redirectUri,
    noOpen: opts.noOpen,
    timeoutMs: Math.max(opts.timeoutMs, 30_000),
    onReady: ({ authorizationUrl, redirectUri, openedBrowser }) => {
      process.stderr.write(`OAuth redirect URI: ${redirectUri}\n`);
      process.stderr.write("If you see INVALID_CLIENT/Invalid redirect URI, add this exact URI in Spotify Dashboard.\n");
      if (!openedBrowser) {
        process.stderr.write(`Open this URL to continue login:\n${authorizationUrl}\n`);
      }
    }
  });

  const token = await exchangeAuthorizationCode({
    code: login.code,
    redirectUri: login.redirect_uri,
    timeoutMs: opts.timeoutMs
  });
  const profile = await fetchCurrentUserProfile(token.access_token, opts.timeoutMs);
  const saved = saveAccountBundle(
    createAccountBundle({
      profile,
      token,
      requestedScopes: scopes,
      name: opts.name,
      source: "oauth"
    })
  );

  const data = {
    account: {
      id: saved.id,
      name: saved.name,
      display_name: saved.display_name,
      scopes: saved.scopes,
      refreshable: true,
      expires_at: saved.token.expires_at
    },
    active: true,
    authorization_url: login.authorization_url,
    opened_browser: login.opened_browser
  };

  const human: string[] = [];
  pushKv(human, "Account", `${saved.name} (${saved.id})`);
  pushKv(human, "Display Name", saved.display_name);
  pushKv(human, "Scopes", saved.scopes.join(", "));
  pushKv(human, "Refresh Token", "Yes");
  pushKv(human, "Expires In", `${expiresInSeconds(saved.token.expires_at)}s`);
  human.push("Active: Yes");

  return {
    data,
    human,
    source: "api"
  };
}

export async function runAccountImport(
  rawInput: string,
  opts: { name?: string; noInput?: boolean }
): Promise<CommandResult> {
  const encoded = rawInput === "-"
    ? await readStdinTextOrThrow(Boolean(opts.noInput), "Pipe base64 payload to stdin or pass it as an argument.")
    : rawInput;
  const imported = parseImportedBase64(encoded);

  const now = Date.now();
  const bundle = saveAccountBundle({
    ...imported.account,
    name: opts.name?.trim() || imported.account.name,
    source: "import",
    updated_at: now,
    created_at: imported.account.created_at || now
  });

  const data = {
    account: {
      id: bundle.id,
      name: bundle.name,
      display_name: bundle.display_name,
      refreshable: true,
      expires_at: bundle.token.expires_at,
      scopes: bundle.scopes
    },
    active: true
  };

  const human: string[] = [];
  pushKv(human, "Imported", `${bundle.name} (${bundle.id})`);
  pushKv(human, "Refresh Token", "Yes");
  pushKv(human, "Expires In", `${expiresInSeconds(bundle.token.expires_at)}s`);
  human.push("Active: Yes");

  return {
    data,
    human,
    source: "api"
  };
}

export async function runAccountExport(accountRef?: string): Promise<CommandResult> {
  const store = readAccountStore();
  const account = resolveAccountFromStore(store, {
    explicitRef: accountRef
  });

  const payload = {
    version: 2,
    kind: "spm-account-bundle",
    account,
    exported_at: unixNowSec()
  } as const;

  const encoded = encodeBase64Json(payload);

  return {
    data: {
      account: {
        id: account.id,
        name: account.name
      },
      base64: encoded
    },
    human: [encoded],
    source: "api"
  };
}

export async function runAccountList(): Promise<CommandResult> {
  const store = readAccountStore();

  const items = [...store.accounts]
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((account) => ({
      id: account.id,
      name: account.name,
      display_name: account.display_name,
      active: store.active_account_id === account.id,
      scopes: account.scopes,
      expires_at: account.token.expires_at,
      expires_in_s: expiresInSeconds(account.token.expires_at),
      refreshable: true
    }));

  const human: string[] = [];
  if (items.length === 0) {
    human.push("No accounts configured.");
  } else {
    for (const item of items) {
      human.push(
        humanAccountLine({
          id: item.id,
          name: item.name,
          display_name: item.display_name,
          scopes: item.scopes,
          expires_at: item.expires_at,
          has_refresh: true,
          active: item.active
        })
      );
    }
  }

  return {
    data: {
      count: items.length,
      active_account_id: store.active_account_id,
      items
    },
    human,
    source: "api"
  };
}

export async function runAccountUse(accountRef: string): Promise<CommandResult> {
  const store = readAccountStore();
  const next = setActiveAccount(store, accountRef);
  writeAccountStore(next);
  const active = resolveAccountFromStore(next);

  return {
    data: {
      active_account_id: active.id,
      active_account_name: active.name
    },
    human: [`Active account: ${active.name} (${active.id})`],
    source: "api"
  };
}

export async function runAccountShow(accountRef?: string): Promise<CommandResult> {
  const store = readAccountStore();
  const account = resolveAccountFromStore(store, {
    explicitRef: accountRef
  });

  const human: string[] = [];
  pushKv(human, "Name", account.name);
  pushKv(human, "ID", account.id);
  pushKv(human, "Display Name", account.display_name);
  pushKv(human, "Active", store.active_account_id === account.id ? "Yes" : "No");
  pushKv(human, "Refreshable", "Yes");
  pushKv(human, "Expires In", `${expiresInSeconds(account.token.expires_at)}s`);
  pushKv(human, "Scopes", account.scopes.join(", "));

  return {
    data: {
      id: account.id,
      name: account.name,
      display_name: account.display_name,
      active: store.active_account_id === account.id,
      refreshable: true,
      expires_at: account.token.expires_at,
      scopes: account.scopes
    },
    human,
    source: "api"
  };
}

export async function runAccountRemove(accountRef: string, opts: { force?: boolean }): Promise<CommandResult> {
  if (!opts.force) {
    throw new CliError("INVALID_USAGE", "Account removal requires --force.", {
      hint: "Run: spm account remove <account> --force"
    });
  }

  const store = readAccountStore();
  const account = findAccountByRef(store, accountRef);
  if (!account) {
    throw new CliError("NOT_FOUND", `Account not found: ${accountRef}`);
  }

  const next = removeAccount(store, accountRef);
  writeAccountStore(next);

  return {
    data: {
      removed_account_id: account.id,
      removed_account_name: account.name,
      active_account_id: next.active_account_id
    },
    human: [`Removed account: ${account.name} (${account.id})`],
    source: "api"
  };
}
