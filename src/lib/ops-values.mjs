export function readEnvValue(env, key) {
  const value = env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createOpsEnvReader(env) {
  return {
    readEnv: (key) => readEnvValue(env, key),
    readBool: (key) => readBoolEnv(env, key),
    readPositiveIntegerEnv: (key, fallback) =>
      readPositiveIntegerEnv(env, key, fallback),
    readListEnv: (key) => readListEnv(env, key),
  };
}

export function readStringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringOrNullValue(value) {
  return typeof value === "string" ? value : null;
}

export function numberOrNullValue(value) {
  return typeof value === "number" ? value : null;
}

export function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

export function normalizeOptionalBaseUrl(value) {
  const text = readStringValue(value);
  return text ? normalizeBaseUrl(text) : null;
}

export function isLocalBaseUrl(value, invalidFallback) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  } catch (error) {
    if (arguments.length >= 2) return invalidFallback;
    throw error;
  }
}

export function readBoolEnv(env, key) {
  return readBoolValue(readEnvValue(env, key), false);
}

export function readBoolValue(value, fallback) {
  const defaultValue = arguments.length >= 2 ? fallback : false;
  if (value === undefined || value === null) return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function readStrictBoolEnv(env, key) {
  return readStrictBoolValue(readEnvValue(env, key));
}

export function readStrictBoolValue(value) {
  return value === "true";
}

export function readStrictBoolOption(optionValue, env, key) {
  if (optionValue !== undefined) return readStrictBoolValue(optionValue);
  const envValue = readEnvValue(env, key);
  return envValue === undefined ? undefined : readStrictBoolValue(envValue);
}

export function readPositiveIntegerEnv(env, key, fallback) {
  return readPositiveIntegerValue(readEnvValue(env, key), fallback);
}

export function readPositiveIntegerValue(value, fallback) {
  const parsed = Number.parseInt(readStringValue(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readListEnv(env, key) {
  const value = readEnvValue(env, key);
  return value === undefined ? undefined : parseCommaList(value);
}

export function readCliList(value) {
  return value === undefined || value === null ? undefined : parseCommaList(value);
}

export function parseCommaList(value) {
  return unique(
    String(value)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function unique(values) {
  return [...new Set(values)];
}
