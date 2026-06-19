#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
const commandArgs = args.slice(1);

switch (command) {
  case "quickstart":
    quickstart(commandArgs);
    break;
  case "env":
    printEnv(commandArgs);
    break;
  case "doctor":
    doctor(commandArgs);
    break;
  case "start":
  case "bridge":
    startBridge(commandArgs);
    break;
  case "help":
  case "-h":
  case "--help":
    process.stdout.write(helpText());
    break;
  default:
    process.stderr.write(`Unknown command: ${command}\n\n${helpText()}`);
    process.exit(2);
}

function printEnv(inputArgs) {
  const env = buildGeneratedEnv(inputArgs, "env");

  process.stdout.write(`${env.bridgeBlock}\n${env.gosperBlock}`);
}

function quickstart(inputArgs) {
  const env = buildGeneratedEnv(inputArgs, "quickstart");
  const dryRun = inputArgs.includes("--dry-run");
  const noStart = inputArgs.includes("--no-start");
  const force = inputArgs.includes("--force");
  const packageRoot = findPackageRoot();
  const envFile = resolve(
    packageRoot,
    readOption(inputArgs, "env-file") ?? ".env",
  );
  const composeFile = resolve(packageRoot, "deploy/compose.yaml");

  if (!dryRun && existsSync(envFile) && !force) {
    process.stderr.write(
      `${envFile} already exists. Pass --force to overwrite it.\n`,
    );
    process.exit(1);
  }

  if (dryRun) {
    process.stdout.write(`# Would write ${envFile}\n${env.bridgeBlock}\n`);
    process.stdout.write(env.gosperBlock);
    process.stdout.write(
      `\n# Would run\n` +
        `docker compose -f ${composeFile} --env-file ${envFile} up -d --build\n`,
    );
    return;
  }

  writeFileSync(envFile, env.bridgeBlock);
  process.stdout.write(`Wrote bridge env: ${envFile}\n\n`);
  process.stdout.write(env.gosperBlock);

  if (noStart) {
    process.stdout.write("\nSkipped Docker start because --no-start was passed.\n");
    return;
  }

  const dockerArgs = [
    "compose",
    "-f",
    composeFile,
    "--env-file",
    envFile,
    "up",
    "-d",
    "--build"
  ];
  process.stdout.write(`\nStarting bridge with: docker ${dockerArgs.join(" ")}\n`);
  const child = spawn("docker", dockerArgs, {
    stdio: "inherit",
    cwd: packageRoot
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

function doctor(inputArgs) {
  const json = inputArgs.includes("--json");
  const env = process.env;
  const required = [
    "OPENCLAW_WECHAT_BRIDGE_TOKEN",
    "OPENCLAW_WECHAT_GOSPER_BASE_URL",
    "OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET",
    "OPENCLAW_WECHAT_BRIDGE_STATE_SECRET"
  ];
  const missing = required.filter((name) => !envValue(env[name]));
  const warnings = [];

  const gosperBaseUrl = envValue(env.OPENCLAW_WECHAT_GOSPER_BASE_URL);
  if (gosperBaseUrl && !isHttpsOrigin(gosperBaseUrl)) {
    warnings.push(
      "OPENCLAW_WECHAT_GOSPER_BASE_URL should be a public https origin in production.",
    );
  }

  const scriptPath = findBridgeScript();
  if (!scriptPath) {
    warnings.push("Bridge runtime script was not found in this package.");
  }

  const result = {
    ok: missing.length === 0,
    missing,
    warnings,
    bridgeScriptFound: Boolean(scriptPath),
    mode: "external_openclaw_transport"
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(
      [
        `ok: ${result.ok}`,
        `mode: ${result.mode}`,
        `bridgeScriptFound: ${result.bridgeScriptFound}`,
        missing.length ? `missing: ${missing.join(", ")}` : "missing: none",
        warnings.length ? `warnings: ${warnings.join("; ")}` : "warnings: none"
      ].join("\n") + "\n",
    );
  }

  if (!result.ok) process.exit(1);
}

function startBridge(inputArgs) {
  const scriptPath = findBridgeScript();
  if (!scriptPath) {
    process.stderr.write("Cannot find src/openclaw-wechat-bridge.mjs.\n");
    process.exit(1);
  }

  const child = spawn(process.execPath, [scriptPath, ...inputArgs], {
    stdio: "inherit",
    env: process.env
  });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

function findBridgeScript() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../src/openclaw-wechat-bridge.mjs"),
    resolve(process.cwd(), "src/openclaw-wechat-bridge.mjs")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findPackageRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function buildGeneratedEnv(inputArgs, commandName) {
  const gosperBaseUrl = readOption(inputArgs, "gosper-base-url");
  const bridgeBaseUrl = readOption(inputArgs, "bridge-base-url");
  const ilinkBaseUrl =
    readOption(inputArgs, "ilink-base-url") ?? "https://ilinkai.weixin.qq.com";

  if (!gosperBaseUrl || !bridgeBaseUrl) {
    process.stderr.write(
      `${commandName} requires --gosper-base-url and --bridge-base-url.\n\n` +
        helpText(),
    );
    process.exit(2);
  }

  const bridgeToken = randomSecret();
  const triggerSecret = randomSecret();
  const stateSecret = randomSecret();
  const normalizedGosperBaseUrl = trimTrailingSlashes(gosperBaseUrl);
  const normalizedBridgeBaseUrl = trimTrailingSlashes(bridgeBaseUrl);
  const normalizedIlinkBaseUrl = trimTrailingSlashes(ilinkBaseUrl);

  return {
    bridgeBlock: `# Bridge host env
OPENCLAW_WECHAT_BRIDGE_TOKEN=${bridgeToken}
OPENCLAW_WECHAT_GOSPER_BASE_URL=${normalizedGosperBaseUrl}
OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET=${triggerSecret}
OPENCLAW_WECHAT_BRIDGE_STATE_PATH=/data/openclaw-wechat/state.json
OPENCLAW_WECHAT_BRIDGE_STATE_SECRET=${stateSecret}
OPENCLAW_WECHAT_ILINK_BASE_URL=${normalizedIlinkBaseUrl}
OPENCLAW_WECHAT_BOT_TYPE=3
OPENCLAW_WECHAT_POLL_INTERVAL_MS=2000
OPENCLAW_WECHAT_LONG_POLL_TIMEOUT_MS=35000
`,
    gosperBlock: `# Gosper Vercel env
GOSPER_WECHAT_TOOL_BASE_URL=${normalizedBridgeBaseUrl}
GOSPER_WECHAT_TOOL_TOKEN=${bridgeToken}
GOSPER_WECHAT_TRIGGER_SECRET=${triggerSecret}
GOSPER_APP_BASE_URL=${normalizedGosperBaseUrl}
`
  };
}

function readOption(inputArgs, name) {
  const flag = `--${name}`;
  const index = inputArgs.indexOf(flag);
  if (index === -1) return undefined;
  const value = inputArgs[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function randomSecret() {
  return randomBytes(32).toString("hex");
}

function envValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trimTrailingSlashes(value) {
  return String(value).replace(/\/+$/, "");
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/";
  } catch {
    return false;
  }
}

function helpText() {
  return `Usage:
  gosper-openclaw-wechat quickstart --gosper-base-url <url> --bridge-base-url <url>
  gosper-openclaw-wechat env --gosper-base-url <url> --bridge-base-url <url>
  gosper-openclaw-wechat doctor [--json]
  gosper-openclaw-wechat start [bridge options]

Commands:
  quickstart Generate .env, print Gosper env, and start Docker Compose.
  env       Generate matching bridge-host and Gosper Vercel env blocks.
  doctor    Check bridge-host env for the Gosper OpenClaw WeChat bridge.
  start     Start the resident iLink transport bridge.

Quickstart options:
  --dry-run     Print generated files and docker command without writing.
  --no-start    Write .env and print Gosper env, but do not run Docker.
  --force       Overwrite an existing .env file.
  --env-file    Bridge env file path relative to this package. Defaults to .env.

Notes:
  This package is an OpenClaw plugin package, but it does not register
  an OpenClaw channel runtime. WeChat messages are sent to Gosper through
  external_openclaw_transport.
`;
}
