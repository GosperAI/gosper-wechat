import { z } from "zod";

export const jsonObjectSchema = z.object({}).passthrough();

type JsonObjectOptions = {
  emptyObject?: boolean;
  invalidMessage?: string;
};

export function asJsonObject(value: unknown) {
  const result = jsonObjectSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function jsonObjectValue(value: unknown) {
  return asJsonObject(value) ?? {};
}

export function parseJsonObject(text: unknown, options: JsonObjectOptions = {}) {
  const raw = String(text ?? "");
  if (!raw.trim()) return options.emptyObject ? {} : null;

  try {
    return asJsonObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseJsonObjectOutput(
  text: unknown,
  options: JsonObjectOptions = {},
) {
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

export async function readJsonObjectResponse(
  response: { text: () => Promise<string> },
  options: JsonObjectOptions = {},
) {
  const text = await response.text();
  if (!text) return {};

  try {
    return asJsonObject(JSON.parse(text)) ?? {};
  } catch {
    throw new Error(options.invalidMessage ?? "Invalid JSON response.");
  }
}

function invalidJsonOutputObject(message?: string) {
  return { ok: false, error: message ?? "Invalid JSON output." };
}
