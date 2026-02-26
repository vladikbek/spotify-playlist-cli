import crypto from "node:crypto";
import http from "node:http";
import { CliError } from "../errors";
import { openBrowser } from "./open-browser";

export type OAuthLoopbackResult = {
  code: string;
  authorization_url: string;
  redirect_uri: string;
  opened_browser: boolean;
};

const DEFAULT_CALLBACK_PORT = 43_821;

type CallbackTarget = {
  host: string;
  port: number;
  path: string;
  redirectUri: string;
};

function parseCallbackTarget(input: string): CallbackTarget {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new CliError("INVALID_USAGE", `Invalid redirect URI: ${input}`);
  }

  if (parsed.protocol !== "http:") {
    throw new CliError("INVALID_USAGE", "OAuth redirect URI must use http:// for loopback login.");
  }
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new CliError("INVALID_USAGE", "OAuth redirect URI host must be 127.0.0.1 or localhost.");
  }
  if (!parsed.port) {
    throw new CliError("INVALID_USAGE", "OAuth redirect URI must include an explicit port.");
  }
  const port = Number(parsed.port);
  if (!Number.isFinite(port) || port <= 0 || !Number.isInteger(port)) {
    throw new CliError("INVALID_USAGE", `Invalid OAuth redirect port: ${parsed.port}`);
  }

  const path = parsed.pathname || "/callback";
  return {
    host: parsed.hostname,
    port,
    path,
    redirectUri: parsed.toString()
  };
}

function resolveCallbackTarget(opts: { callbackPort?: number; redirectUri?: string }): CallbackTarget {
  const fromEnv = process.env.SPM_OAUTH_REDIRECT_URI?.trim();
  const fromArg = opts.redirectUri?.trim();
  const explicit = fromArg || fromEnv;
  if (explicit) {
    return parseCallbackTarget(explicit);
  }

  const configuredPort = Number(process.env.SPM_OAUTH_CALLBACK_PORT);
  const port = opts.callbackPort ?? (Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : DEFAULT_CALLBACK_PORT);
  return {
    host: "127.0.0.1",
    port,
    path: "/callback",
    redirectUri: `http://127.0.0.1:${port}/callback`
  };
}

function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}): string {
  const u = new URL("https://accounts.spotify.com/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", opts.clientId);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("scope", opts.scopes.join(" "));
  u.searchParams.set("state", opts.state);
  return u.toString();
}

function callbackHtml(message: string): string {
  return `<!doctype html><html><body><p>${message}</p><p>You can close this tab now.</p></body></html>`;
}

export async function runOAuthLoopbackLogin(opts: {
  clientId: string;
  scopes: string[];
  callbackPort?: number;
  redirectUri?: string;
  noOpen?: boolean;
  timeoutMs?: number;
  onReady?: (params: { authorizationUrl: string; redirectUri: string; openedBrowser: boolean }) => void;
}): Promise<OAuthLoopbackResult> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const state = crypto.randomBytes(16).toString("hex");
  const target = resolveCallbackTarget({
    callbackPort: opts.callbackPort,
    redirectUri: opts.redirectUri
  });

  const server = http.createServer();
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", (err) => reject(err));
    server.listen(target.port, target.host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new CliError("NETWORK", "Unable to bind OAuth callback server."));
        return;
      }
      resolve(addr.port);
    });
  }).catch((err: unknown) => {
    throw new CliError("NETWORK", "Failed to start OAuth callback server.", {
      details: err
    });
  });

  const redirectUri = target.redirectUri;
  const authorizationUrl = buildAuthorizeUrl({
    clientId: opts.clientId,
    redirectUri,
    state,
    scopes: opts.scopes
  });

  const opened = opts.noOpen ? false : openBrowser(authorizationUrl);
  opts.onReady?.({
    authorizationUrl,
    redirectUri,
    openedBrowser: opened
  });

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new CliError("NETWORK", `OAuth login timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    server.on("request", (req, res) => {
      try {
        const requestUrl = new URL(req.url || "/", `http://${target.host}:${port}`);
        if (requestUrl.pathname !== target.path) {
          res.statusCode = 404;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(callbackHtml("Unknown callback path."));
          return;
        }

        const incomingState = requestUrl.searchParams.get("state") || "";
        const error = requestUrl.searchParams.get("error");
        const incomingCode = requestUrl.searchParams.get("code");

        if (error) {
          res.statusCode = 400;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(callbackHtml(`Spotify returned OAuth error: ${error}`));
          clearTimeout(timer);
          reject(new CliError("AUTH_CONFIG", `OAuth login failed: ${error}.`));
          return;
        }

        if (!incomingCode || incomingState !== state) {
          res.statusCode = 400;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(callbackHtml("Invalid OAuth callback payload."));
          clearTimeout(timer);
          reject(new CliError("AUTH_CONFIG", "OAuth callback state validation failed."));
          return;
        }

        res.statusCode = 200;
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(callbackHtml("Spotify authorization received."));
        clearTimeout(timer);
        resolve(incomingCode);
      } catch (err) {
        clearTimeout(timer);
        reject(new CliError("AUTH_CONFIG", "Invalid OAuth callback request.", { details: err }));
      }
    });
  }).finally(() => {
    server.close();
  });

  return {
    code,
    authorization_url: authorizationUrl,
    redirect_uri: redirectUri,
    opened_browser: opened
  };
}
