import { CliError } from "../errors";
import { AccountBundleV2 } from "../types";

type JsonObject = Record<string, unknown>;

export type ExportedAccountBundleV2 = {
  version: 2;
  kind: "spm-account-bundle";
  account: AccountBundleV2;
  exported_at: number;
};

function decodeBase64Utf8(input: string): string {
  try {
    return Buffer.from(input.trim(), "base64").toString("utf8");
  } catch {
    throw new CliError("INVALID_USAGE", "Invalid base64 input.");
  }
}

function parseAccountBundleV2(input: unknown): AccountBundleV2 {
  if (!input || typeof input !== "object") {
    throw new CliError("INVALID_USAGE", "Invalid account bundle: object expected.");
  }

  const obj = input as JsonObject;
  if (obj.version !== 2) {
    throw new CliError("INVALID_USAGE", `Unsupported account bundle version: ${String(obj.version)}.`);
  }

  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const displayName = typeof obj.display_name === "string" ? obj.display_name : undefined;
  const scopes = Array.isArray(obj.scopes)
    ? obj.scopes.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const source = obj.source;
  const createdAt = obj.created_at;
  const updatedAt = obj.updated_at;

  if (!id || !name) {
    throw new CliError("INVALID_USAGE", "Invalid account bundle: id/name are required.");
  }
  if (source !== "oauth" && source !== "import") {
    throw new CliError("INVALID_USAGE", "Invalid account bundle: source must be 'oauth' or 'import'.");
  }
  if (!Number.isInteger(createdAt) || Number(createdAt) <= 0 || !Number.isInteger(updatedAt) || Number(updatedAt) <= 0) {
    throw new CliError("INVALID_USAGE", "Invalid account bundle: created_at/updated_at must be positive integers.");
  }

  if (!obj.token || typeof obj.token !== "object") {
    throw new CliError("INVALID_USAGE", "Invalid account bundle: token payload is missing.");
  }

  const tokenObj = obj.token as JsonObject;
  const accessToken = typeof tokenObj.access_token === "string" ? tokenObj.access_token.trim() : "";
  const refreshToken = typeof tokenObj.refresh_token === "string" ? tokenObj.refresh_token.trim() : "";
  const tokenType = tokenObj.token_type;
  const expiresAt = tokenObj.expires_at;

  if (!accessToken || !refreshToken) {
    throw new CliError("INVALID_USAGE", "Invalid account bundle: access_token and refresh_token are required.");
  }
  if (tokenType !== "Bearer") {
    throw new CliError("INVALID_USAGE", "Invalid account bundle: token_type must be 'Bearer'.");
  }
  if (!Number.isInteger(expiresAt) || Number(expiresAt) <= 0) {
    throw new CliError("INVALID_USAGE", "Invalid account bundle: expires_at must be a positive integer.");
  }

  return {
    version: 2,
    id,
    name,
    display_name: displayName,
    scopes,
    token: {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_at: Number(expiresAt)
    },
    source,
    created_at: Number(createdAt),
    updated_at: Number(updatedAt)
  };
}

export function parseImportedBase64(input: string): ExportedAccountBundleV2 {
  const text = decodeBase64Utf8(input).trim();
  if (!text) {
    throw new CliError("INVALID_USAGE", "Decoded base64 payload is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError("INVALID_USAGE", "Account import payload must be JSON encoded in base64.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new CliError("INVALID_USAGE", "Account import payload must be an object.");
  }

  const root = parsed as JsonObject;
  if (root.version !== 2 || root.kind !== "spm-account-bundle") {
    throw new CliError("INVALID_USAGE", "Unsupported account import payload format.");
  }

  const exportedAt = root.exported_at;
  if (!Number.isInteger(exportedAt) || Number(exportedAt) <= 0) {
    throw new CliError("INVALID_USAGE", "Invalid account import payload: exported_at must be a positive integer.");
  }

  return {
    version: 2,
    kind: "spm-account-bundle",
    account: parseAccountBundleV2(root.account),
    exported_at: Number(exportedAt)
  };
}

export function encodeBase64Json(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}
