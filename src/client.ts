import { getUserAccessToken } from "./auth/user-token";
import { CliError } from "./errors";
import { RequestContext } from "./types";

const API_BASE = "https://api.spotify.com/v1";

type QueryValue = string | number | boolean | undefined;

type RequestOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  request?: RequestContext;
  auth?: {
    mode?: "user";
    account?: string;
  };
};

function buildUrl(pathOrUrl: string, query?: RequestOpts["query"]): string {
  const base = pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${API_BASE}${pathOrUrl}`;
  const url = new URL(base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contentType(headers: Record<string, string>): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === "content-type");
  return key ? headers[key] : undefined;
}

async function doFetch(url: string, token: string, timeoutMs: number, opts: RequestOpts): Promise<Response> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(opts.headers ?? {})
  };

  let body: BodyInit | undefined;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    const ctype = contentType(headers) ?? "application/json";
    if (!contentType(headers)) {
      headers["Content-Type"] = ctype;
    }
    if (ctype.toLowerCase().includes("application/json")) {
      body = JSON.stringify(opts.body);
    } else if (typeof opts.body === "string" || opts.body instanceof Uint8Array || opts.body instanceof URLSearchParams) {
      body = opts.body as BodyInit;
    } else {
      body = String(opts.body);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new CliError("NETWORK", `Request timed out after ${timeoutMs}ms.`, {
        hint: "Increase --timeout-ms or set SPM_TIMEOUT_MS."
      });
    }
    throw new CliError("NETWORK", "Network error calling Spotify API.", {
      hint: "Retry the command.",
      details: err
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function apiRequest<T>(pathOrUrl: string, opts?: RequestOpts): Promise<T> {
  const requestOpts: RequestOpts = opts ?? {};
  const timeoutMs = requestOpts.request?.timeoutMs ?? 15_000;
  const account = requestOpts.auth?.account ?? requestOpts.request?.account;
  const url = buildUrl(pathOrUrl, requestOpts.query);

  let refreshed = false;
  let rateRetries = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const token = (await getUserAccessToken({ timeoutMs, account, forceRefresh: refreshed })).token;
    const res = await doFetch(url, token, timeoutMs, requestOpts);

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      continue;
    }

    if (res.status === 429 && rateRetries < 3) {
      rateRetries += 1;
      const ra = Number(res.headers.get("retry-after") || "1");
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000;
      await sleep(waitMs);
      continue;
    }

    if (res.status === 429) {
      throw new CliError("NETWORK", "Spotify API rate limit exceeded after retries.", {
        hint: "Retry later or reduce request frequency."
      });
    }

    if (res.status === 404) {
      throw new CliError("NOT_FOUND", "Resource not found.");
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new CliError(
        "SPOTIFY_API",
        `Spotify API error: HTTP ${res.status} ${res.statusText}${txt ? ` - ${txt}` : ""}`,
        { details: { status: res.status } }
      );
    }

    if (res.status === 204 || res.status === 202) {
      return {} as T;
    }

    const text = await res.text();
    if (!text.trim()) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}

export async function apiUserRequest<T>(path: string, opts?: RequestOpts): Promise<T> {
  return apiRequest<T>(path, {
    ...opts,
    auth: {
      account: opts?.auth?.account ?? opts?.request?.account
    }
  });
}

export async function apiUserGet<T>(path: string, opts?: Omit<RequestOpts, "method">): Promise<T> {
  return apiUserRequest<T>(path, {
    ...opts,
    method: "GET"
  });
}

// Legacy helper retained for internal compile compatibility. `spm` command surface uses user-auth only.
export async function apiGet<T>(path: string, opts?: Omit<RequestOpts, "method">): Promise<T> {
  return apiUserGet<T>(path, opts);
}

export async function paginate<TPage extends { items: any[]; next: string | null }>(
  firstPath: string,
  opts?: Omit<RequestOpts, "method">
): Promise<any[]> {
  const first = await apiUserGet<TPage>(firstPath, opts);
  const all = [...first.items];
  let next = first.next;

  while (next) {
    const page = await apiUserGet<TPage>(next, {
      request: opts?.request,
      auth: opts?.auth
    });
    all.push(...page.items);
    next = page.next;
  }

  return all;
}
