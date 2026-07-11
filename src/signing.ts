import { createHash, createHmac } from "node:crypto";

export function stringToSign(
  timestamp: string | number,
  method: string,
  path: string,
  query = "",
  body = "",
): string {
  const bodyHash = body === "" ? "" : createHash("sha256").update(body, "utf8").digest("hex");
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${query}\n${bodyHash}`;
}

export function sign(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64");
}

export function authorizationHeader(
  apiKey: string,
  apiSecret: string,
  timestamp: string | number,
  method: string,
  path: string,
  query = "",
  body = "",
): string {
  const signature = sign(apiSecret, stringToSign(timestamp, method, path, query, body));
  return `HMAC-SHA256 ${apiKey}:${signature}`;
}

export function encodePathSegment(value: string): string {
  return rfc3986(value);
}

export function buildQuery<T extends object>(filters: T): string {
  const valuesByKey = filters as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(filters).sort()) {
    const raw = valuesByKey[key];
    if (raw === undefined || raw === null) continue;
    const values = Array.isArray(raw) ? [...raw].sort() : [raw];
    if (values.length === 0) throw new TypeError(`Paymos list filter cannot be empty: ${key}`);
    for (const value of values) {
      if ((typeof value !== "string" && typeof value !== "number") || String(value) === "") {
        throw new TypeError(`Invalid Paymos list filter: ${key}`);
      }
      parts.push(`${rfc3986(key)}=${rfc3986(String(value))}`);
    }
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
