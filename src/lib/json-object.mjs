import { z } from "zod";

export const jsonObjectSchema = z.object({}).passthrough();

export function asJsonObject(value) {
  const result = jsonObjectSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function jsonObjectValue(value) {
  return asJsonObject(value) ?? {};
}

export function parseJsonObject(text, options = {}) {
  const raw = String(text ?? "");
  if (!raw.trim()) return options.emptyObject ? {} : null;

  try {
    return asJsonObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseJsonObjectOutput(text, options = {}) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return null;

  try {
    return (
      asJsonObject(JSON.parse(raw)) ?? invalidJsonOutputObject(options.invalidMessage)
    );
  } catch {
    return invalidJsonOutputObject(options.invalidMessage);
  }
}

export async function readJsonObjectResponse(response, options = {}) {
  const text = await response.text();
  if (!text) return {};

  try {
    return asJsonObject(JSON.parse(text)) ?? {};
  } catch {
    throw new Error(options.invalidMessage ?? "Invalid JSON response.");
  }
}

function invalidJsonOutputObject(message) {
  return { ok: false, error: message ?? "Invalid JSON output." };
}
