import dotenv from "dotenv";
import path from "node:path";
import { AccountBundleV2 } from "../types";
import { CliError } from "../errors";
import {
  readAccountStore,
  resolveAccountFromStore,
  upsertAccount,
  writeAccountStore
} from "./account-store";
import { normalizeScopes, scopesFromOAuthValue } from "./scope";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const REFRESH_MARGIN_MS = 60_000;

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

export type CurrentUserProfile = {
  id: string;
  display_name?: string;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new CliError("AUTH_CONFIG", `Missing ${name}.`, {
      hint: `Set ${name} in env or .env.`
    });
  }
  return value;
}

function basicAuthHeader(): string {
  const clientId = getRequiredEnv("SPM_CLIENT_ID");
  const clientSecret = getRequiredEnv("SPM_CLIENT_SECRET");
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function postToken(
  body: URLSearchParams,
  timeoutMs: number
): Promise<TokenResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: body.toString(),
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new CliError("NETWORK", `Token request timed out after ${timeoutMs}ms.`);
    }
    throw new CliError("NETWORK", "Failed to call Spotify token endpoint.", {
      details: err
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new CliError(
      "AUTH_CONFIG",
      `Spotify user token request failed: HTTP ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ""}`
    );
  }

  return (await res.json()) as TokenResponse;
}

export async function exchangeAuthorizationCode(opts: {
  code: string;
  redirectUri: string;
  timeoutMs: number;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri
  });
  return postToken(body, opts.timeoutMs);
}

export async function refreshUserAccessToken(opts: {
  refreshToken: string;
  timeoutMs: number;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken
  });
  return postToken(body, opts.timeoutMs);
}

export async function fetchCurrentUserProfile(
  accessToken: string,
  timeoutMs: number
): Promise<CurrentUserProfile> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.spotify.com/v1/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new CliError("NETWORK", `Request timed out after ${timeoutMs}ms.`);
    }
    throw new CliError("NETWORK", "Failed to fetch current user profile.", {
      details: err
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new CliError(
      "AUTH_CONFIG",
      `Failed to fetch current user profile: HTTP ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ""}`,
      { hint: "Ensure this token can access /v1/me, then re-run 'spm account login' with supported scopes." }
    );
  }

  const payload = (await res.json()) as { id: string; display_name?: string };
  if (!payload?.id) {
    throw new CliError("AUTH_CONFIG", "Spotify /me response did not include user id.");
  }
  return {
    id: payload.id,
    display_name: payload.display_name
  };
}

export function createAccountBundle(opts: {
  profile: CurrentUserProfile;
  token: TokenResponse;
  requestedScopes: string[];
  name?: string;
  source: "oauth" | "import";
  refreshTokenFallback?: string;
}): AccountBundleV2 {
  const now = Date.now();
  const scopeList =
    scopesFromOAuthValue(opts.token.scope).length > 0
      ? scopesFromOAuthValue(opts.token.scope)
      : normalizeScopes(opts.requestedScopes);

  const refreshToken = opts.token.refresh_token ?? opts.refreshTokenFallback;
  if (!refreshToken) {
    throw new CliError("AUTH_CONFIG", "Missing refresh_token in token response.", {
      hint: "Spotify playlist manager requires refresh-token based accounts."
    });
  }

  return {
    version: 2,
    id: opts.profile.id,
    name: opts.name?.trim() || opts.profile.display_name?.trim() || opts.profile.id,
    display_name: opts.profile.display_name,
    scopes: scopeList,
    token: {
      access_token: opts.token.access_token,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_at: now + opts.token.expires_in * 1000
    },
    source: opts.source,
    created_at: now,
    updated_at: now
  };
}

export function saveAccountBundle(bundle: AccountBundleV2): AccountBundleV2 {
  const store = readAccountStore();
  const existing = store.accounts.find((x) => x.id === bundle.id);
  const merged: AccountBundleV2 = existing
    ? {
        ...existing,
        ...bundle,
        token: {
          ...existing.token,
          ...bundle.token,
          refresh_token: bundle.token.refresh_token || existing.token.refresh_token
        },
        created_at: existing.created_at,
        updated_at: Date.now()
      }
    : bundle;

  const next = upsertAccount(store, merged);
  next.active_account_id = merged.id;
  writeAccountStore(next);
  return merged;
}

export async function getUserAccessToken(opts: {
  timeoutMs: number;
  account?: string;
  forceRefresh?: boolean;
}): Promise<{ token: string; account: AccountBundleV2 }> {
  const store = readAccountStore();
  const account = resolveAccountFromStore(store, {
    explicitRef: opts.account
  });

  const shouldReuse =
    !opts.forceRefresh && account.token.expires_at - Date.now() > REFRESH_MARGIN_MS;
  if (shouldReuse) {
    return {
      token: account.token.access_token,
      account
    };
  }

  const refreshed = await refreshUserAccessToken({
    refreshToken: account.token.refresh_token,
    timeoutMs: opts.timeoutMs
  });

  const updated: AccountBundleV2 = {
    ...account,
    scopes:
      scopesFromOAuthValue(refreshed.scope).length > 0
        ? scopesFromOAuthValue(refreshed.scope)
        : account.scopes,
    token: {
      access_token: refreshed.access_token,
      token_type: "Bearer",
      expires_at: Date.now() + refreshed.expires_in * 1000,
      refresh_token: refreshed.refresh_token ?? account.token.refresh_token
    },
    updated_at: Date.now()
  };

  const next = upsertAccount(store, updated);
  writeAccountStore(next);

  return {
    token: updated.token.access_token,
    account: updated
  };
}
