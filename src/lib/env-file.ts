import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import dotenv from "dotenv";

import { parseJsonObject } from "./json-object.ts";
import { readStringValue as stringValue } from "./ops-values.ts";

type EnvRecord = Record<string, string | undefined>;

export async function loadRuntimeEnv(
  options: { cwd?: string; env?: EnvRecord } = {},
) {
  const cwd = options.cwd ?? process.cwd();
  const processEnv = options.env ?? process.env;
  const fileEnv = {
    ...(await parseVercelProjectEnv(join(cwd, ".vercel/project.json"))),
    ...(await parseEnvFile(join(cwd, ".env"))),
    ...(await parseEnvFile(join(cwd, ".env.local"))),
  };
  return { ...fileEnv, ...processEnv };
}

export async function parseEnvFile(path: string) {
  if (!existsSync(path)) return {};

  const text = await readFile(path, "utf8");
  return dotenv.parse(text);
}

export async function parseVercelProjectEnv(path: string) {
  if (!existsSync(path)) return {};

  const project = parseJsonObject(await readFile(path, "utf8")) ?? {};
  const orgId = stringValue(project.orgId);
  const projectId = stringValue(project.projectId);
  return {
    ...(orgId
      ? {
          VERCEL_ORG_ID: orgId,
          VERCEL_TEAM_ID: orgId,
        }
      : {}),
    ...(projectId ? { VERCEL_PROJECT_ID: projectId } : {}),
  };
}
