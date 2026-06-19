#!/usr/bin/env node

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import { loadRuntimeEnv } from "./lib/env-file.mjs";
import {
  createOpsEnvReader,
  normalizeBaseUrl,
  normalizeOptionalBaseUrl,
  readPositiveIntegerValue,
  readStringValue as stringValue,
} from "./lib/ops-values.mjs";

const openClawWeixinChannel = "openclaw-weixin";
const defaultBridgeHost = "127.0.0.1";
const defaultBridgePort = 8787;
const defaultIlinkBaseUrl = "https://ilinkai.weixin.qq.com";
const defaultBotType = "3";
const defaultChannelVersion = "2.4.3";
const defaultIlinkAppId = "bot";
const defaultPollIntervalMs = 2_000;
const defaultLongPollTimeoutMs = 35_000;
const defaultApiTimeoutMs = 15_000;
const activeLoginTtlMs = 5 * 60_000;
const maxSeenMessages = 2_000;
const executePath = "/v1/wechat/tools/execute";
const stateVersion = 1;

async function main() {
  const cli = parseBridgeArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(bridgeUsage());
    return;
  }

  const env = await loadRuntimeEnv();
  const config = readBridgeConfig(env, cli);
  const validation = validateBridgeConfig(config);

  if (cli.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: validation.configured,
          dryRun: true,
          configured: validation.configured,
          missing: validation.missing,
          invalid: validation.invalid,
          bridge: describeBridgeConfig(config),
          contract: bridgeContract(),
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  if (!validation.configured) {
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          configured: false,
          missing: validation.missing,
          invalid: validation.invalid,
        },
        null,
        2,
      ) + "\n",
    );
    process.exitCode = 1;
    return;
  }

  const store = new JsonStateStore(config.statePath, {
    stateSecret: config.stateSecret,
  });
  await store.load();

  const bridge = new OpenClawWechatBridge({ config, store });
  await bridge.listen();

  process.on("SIGINT", () => bridge.close().finally(() => process.exit(0)));
  process.on("SIGTERM", () => bridge.close().finally(() => process.exit(0)));
}

function parseBridgeArgs(argv) {
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        help: { type: "boolean", short: "h" },
        "dry-run": { type: "boolean" },
        host: { type: "string" },
        port: { type: "string" },
        "state-path": { type: "string" },
        "bridge-token": { type: "string" },
        "gosper-base-url": { type: "string" },
        "trigger-secret": { type: "string" },
        "ilink-base-url": { type: "string" },
        "bot-type": { type: "string" },
        "poll-interval-ms": { type: "string" },
        "long-poll-timeout-ms": { type: "string" },
      },
    });
    return {
      help: Boolean(parsed.values.help),
      dryRun: Boolean(parsed.values["dry-run"]),
      host: parsed.values.host,
      port: parsed.values.port,
      statePath: parsed.values["state-path"],
      bridgeToken: parsed.values["bridge-token"],
      gosperBaseUrl: parsed.values["gosper-base-url"],
      triggerSecret: parsed.values["trigger-secret"],
      ilinkBaseUrl: parsed.values["ilink-base-url"],
      botType: parsed.values["bot-type"],
      pollIntervalMs: parsed.values["poll-interval-ms"],
      longPollTimeoutMs: parsed.values["long-poll-timeout-ms"],
    };
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${bridgeUsage()}`,
    );
    process.exit(2);
  }
}

function readBridgeConfig(env, cli) {
  const { readEnv, readBool } = createOpsEnvReader(env);
  const host =
    cli.host ?? readEnv("OPENCLAW_WECHAT_BRIDGE_HOST") ?? defaultBridgeHost;
  const port = readNonNegativeIntegerValue(
    cli.port ?? readEnv("OPENCLAW_WECHAT_BRIDGE_PORT") ?? readEnv("PORT"),
    defaultBridgePort,
  );
  const bridgeToken =
    cli.bridgeToken ??
    readEnv("OPENCLAW_WECHAT_BRIDGE_TOKEN") ??
    readEnv("GOSPER_WECHAT_TOOL_TOKEN");
  const gosperBaseUrl = normalizeOptionalBaseUrl(
    cli.gosperBaseUrl ??
      readEnv("OPENCLAW_WECHAT_GOSPER_BASE_URL") ??
      readEnv("GOSPER_APP_BASE_URL") ??
      readEnv("GOSPER_PUBLIC_BASE_URL") ??
      readEnv("NEXT_PUBLIC_APP_URL"),
  );
  const triggerSecret =
    cli.triggerSecret ??
    readEnv("OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET") ??
    readEnv("GOSPER_WECHAT_TRIGGER_SECRET");
  const ilinkBaseUrl =
    normalizeOptionalBaseUrl(
      cli.ilinkBaseUrl ?? readEnv("OPENCLAW_WECHAT_ILINK_BASE_URL"),
    ) ?? defaultIlinkBaseUrl;
  const statePath =
    cli.statePath ??
    readEnv("OPENCLAW_WECHAT_BRIDGE_STATE_PATH") ??
    join(homedir(), ".gosper", "openclaw-wechat-bridge", "state.json");
  const stateSecret = readEnv("OPENCLAW_WECHAT_BRIDGE_STATE_SECRET");
  const allowPlaintextState = readBool(
    "OPENCLAW_WECHAT_BRIDGE_ALLOW_PLAINTEXT_STATE",
  );

  return {
    host,
    port,
    bridgeToken,
    gosperBaseUrl,
    triggerSecret,
    ilinkBaseUrl,
    botType: cli.botType ?? readEnv("OPENCLAW_WECHAT_BOT_TYPE") ?? defaultBotType,
    ilinkAppId:
      readEnv("OPENCLAW_WECHAT_ILINK_APP_ID") ?? defaultIlinkAppId,
    channelVersion:
      readEnv("OPENCLAW_WECHAT_CHANNEL_VERSION") ?? defaultChannelVersion,
    botAgent: readEnv("OPENCLAW_WECHAT_BOT_AGENT") ?? "GosperOpenClawBridge",
    statePath,
    stateSecret,
    allowPlaintextState,
    pollIntervalMs: readPositiveIntegerValue(
      cli.pollIntervalMs ?? readEnv("OPENCLAW_WECHAT_POLL_INTERVAL_MS"),
      defaultPollIntervalMs,
    ),
    longPollTimeoutMs: readPositiveIntegerValue(
      cli.longPollTimeoutMs ??
        readEnv("OPENCLAW_WECHAT_LONG_POLL_TIMEOUT_MS"),
      defaultLongPollTimeoutMs,
    ),
    apiTimeoutMs: readPositiveIntegerValue(
      readEnv("OPENCLAW_WECHAT_API_TIMEOUT_MS"),
      defaultApiTimeoutMs,
    ),
  };
}

function validateBridgeConfig(config) {
  const missing = [];
  const invalid = [];
  if (!config.bridgeToken) missing.push("OPENCLAW_WECHAT_BRIDGE_TOKEN or GOSPER_WECHAT_TOOL_TOKEN");
  if (!config.gosperBaseUrl) {
    missing.push(
      "OPENCLAW_WECHAT_GOSPER_BASE_URL or GOSPER_APP_BASE_URL or GOSPER_PUBLIC_BASE_URL or NEXT_PUBLIC_APP_URL",
    );
  }
  if (!config.triggerSecret) {
    missing.push(
      "OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET or GOSPER_WECHAT_TRIGGER_SECRET",
    );
  }
  validateHttpUrl(config.ilinkBaseUrl, "OPENCLAW_WECHAT_ILINK_BASE_URL", invalid);
  if (config.gosperBaseUrl) {
    validateHttpUrl(config.gosperBaseUrl, "Gosper callback base URL", invalid);
  }
  if (isProductionEnv() && !config.stateSecret && !config.allowPlaintextState) {
    missing.push("OPENCLAW_WECHAT_BRIDGE_STATE_SECRET");
  }
  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
  };
}

function describeBridgeConfig(config) {
  return {
    mode: "external_openclaw_transport",
    listen: {
      host: config.host,
      port: config.port,
      executePath,
    },
    gosperBaseUrl: config.gosperBaseUrl,
    ilinkBaseUrl: config.ilinkBaseUrl,
    botType: config.botType,
    statePath: config.statePath,
    stateEncrypted: Boolean(config.stateSecret),
    plaintextStateAllowed: Boolean(config.allowPlaintextState),
    transportLoop: "resident_getupdates",
    pollIntervalMs: config.pollIntervalMs,
    longPollTimeoutMs: config.longPollTimeoutMs,
    bridgeTokenConfigured: Boolean(config.bridgeToken),
    triggerSecretConfigured: Boolean(config.triggerSecret),
  };
}

function bridgeContract() {
  return {
    provider: "wechat",
    tool: "WECHAT",
    channel: openClawWeixinChannel,
    executePath,
    operations: [
      "create_bind_session",
      "get_bind_session",
      "submit_bind_verification",
      "send_supervisor_reply",
      "send_inbox_item",
    ],
    callbacks: {
      message: "/api/tools/triggers/wechat",
      binding: "/api/tools/triggers/wechat/bind",
    },
    openclawLlmLayer: "bypassed",
    transport: [
      "ilink/bot/get_bot_qrcode",
      "ilink/bot/get_qrcode_status",
      "ilink/bot/getupdates",
      "ilink/bot/sendmessage",
    ],
  };
}

class JsonStateStore {
  constructor(path, input = {}) {
    this.path = path;
    this.stateSecret = input.stateSecret ?? null;
    this.state = defaultState();
    this.saveChain = Promise.resolve();
  }

  async load() {
    if (!existsSync(this.path)) {
      this.state = defaultState();
      return;
    }
    const parsed = parseStateEnvelope(
      await readFile(this.path, "utf8"),
      this.stateSecret,
    );
    this.state = {
      ...defaultState(),
      ...parsed,
      bindSessions: asRecord(parsed.bindSessions) ?? {},
      accounts: asRecord(parsed.accounts) ?? {},
      seenMessages: asRecord(parsed.seenMessages) ?? {},
    };
  }

  async save() {
    const plaintext = JSON.stringify(this.state, null, 2) + "\n";
    const snapshot = this.stateSecret
      ? encryptedStateEnvelope(plaintext, this.stateSecret)
      : plaintext;
    this.saveChain = this.saveChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const tmpPath = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmpPath, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(tmpPath, this.path);
    });
    return this.saveChain;
  }
}

function defaultState() {
  return {
    version: stateVersion,
    bindSessions: {},
    accounts: {},
    seenMessages: {},
  };
}

class OpenClawWechatBridge {
  constructor(input) {
    this.config = input.config;
    this.store = input.store;
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        writeJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
    this.pollTimer = null;
    this.polling = false;
    this.abortController = new AbortController();
  }

  async listen() {
    await new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, resolve);
    });
    const address = this.server.address();
    const port =
      address && typeof address !== "string" ? address.port : this.config.port;
    const baseUrl = `http://${this.config.host}:${port}`;
    process.stdout.write(
      JSON.stringify({
        event: "openclaw_wechat_bridge.listening",
        mode: "external_openclaw_transport",
        host: this.config.host,
        port,
        baseUrl,
        executeUrl: `${baseUrl}${executePath}`,
        transportLoop: "resident_getupdates",
      }) + "\n",
    );
    this.startPolling();
  }

  async close() {
    this.abortController.abort();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    await new Promise((resolve) => this.server.close(() => resolve()));
  }

  async handleRequest(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/healthz") {
      writeJson(res, 200, {
        ok: true,
        mode: "external_openclaw_transport",
        channel: openClawWeixinChannel,
        accounts: Object.keys(this.store.state.accounts).length,
        stateEncrypted: Boolean(this.store.stateSecret),
      });
      return;
    }
    if (req.method !== "POST" || url.pathname !== executePath) {
      writeJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    if (!authorizedBearer(req.headers.authorization, this.config.bridgeToken)) {
      writeJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const body = await readJsonRequest(req);
    const op = stringValue(body.op) ?? stringValue(body.name);
    const args = asRecord(body.arguments) ?? asRecord(body.args) ?? {};
    const context = asRecord(body.context) ?? {};
    try {
      const result = await this.executeOperation(op, args, context);
      writeJson(res, 200, result);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async executeOperation(op, args, context) {
    switch (op) {
      case "create_bind_session":
        return this.createBindSession(args, context);
      case "get_bind_session":
        return this.getBindSession(args);
      case "submit_bind_verification":
        return this.submitBindVerification(args);
      case "send_supervisor_reply":
        return this.sendWechatMessage(args, "send_supervisor_reply");
      case "send_inbox_item":
        return this.sendWechatMessage(args, "send_inbox_item");
      default:
        throw new Error(`Unknown WeChat bridge operation ${op ?? ""}.`);
    }
  }

  async createBindSession(args, context) {
    const triggerUrl =
      stringValue(args.triggerUrl) ??
      stringValue(args.trigger_url) ??
      `${this.config.gosperBaseUrl}/api/tools/triggers/wechat`;
    const bindCallbackUrl =
      stringValue(args.bindCallbackUrl) ??
      stringValue(args.bind_callback_url) ??
      `${this.config.gosperBaseUrl}/api/tools/triggers/wechat/bind`;
    const triggerAuth =
      asRecord(args.triggerAuth) ?? asRecord(args.trigger_auth) ?? {
        type: "bearer",
        token: this.config.triggerSecret,
      };
    const bindCallbackAuth =
      asRecord(args.bindCallbackAuth) ??
      asRecord(args.bind_callback_auth) ?? {
        type: "bearer",
        token: this.config.triggerSecret,
      };
    const triggerContext =
      asRecord(args.triggerContext) ??
      asRecord(args.trigger_context) ??
      openClawContextFrom(context);
    const bindCallbackContext =
      asRecord(args.bindCallbackContext) ??
      asRecord(args.bind_callback_context) ??
      triggerContext;

    const qr = await fetchIlinkQrCode({
      config: this.config,
      localTokenList: latestLocalTokenList(this.store.state),
    });
    const sessionKey = randomUUID();
    const now = Date.now();
    const session = {
      sessionKey,
      qrcode: qr.qrcode,
      qrCodeContent: qr.qrcode_img_content,
      status: "wait",
      startedAt: now,
      expiresAt: new Date(now + activeLoginTtlMs).toISOString(),
      currentApiBaseUrl: this.config.ilinkBaseUrl,
      triggerUrl,
      triggerAuth,
      triggerContext,
      bindCallbackUrl,
      bindCallbackAuth,
      bindCallbackContext,
      bindCallbackSentAt: null,
      lastStatusResponse: null,
    };
    this.store.state.bindSessions[sessionKey] = session;
    await this.store.save();
    return publicBindSession(session, this.store.state);
  }

  async getBindSession(args) {
    const session = this.readBindSession(args);
    if (bindSessionExpired(session)) {
      session.status = "expired";
      await this.store.save();
      return publicBindSession(session, this.store.state);
    }
    const status = await pollIlinkQrStatus({
      config: this.config,
      session,
    });
    return this.updateBindSessionFromStatus(session, status);
  }

  async submitBindVerification(args) {
    const session = this.readBindSession(args);
    const verifyCode =
      stringValue(args.verifyCode) ?? stringValue(args.verify_code);
    if (!verifyCode) throw new Error("submit_bind_verification requires verifyCode.");
    const status = await pollIlinkQrStatus({
      config: this.config,
      session,
      verifyCode,
    });
    return this.updateBindSessionFromStatus(session, status);
  }

  readBindSession(args) {
    const sessionKey =
      stringValue(args.sessionId) ??
      stringValue(args.sessionKey) ??
      stringValue(args.session_key);
    if (!sessionKey) throw new Error("WeChat bind operation requires sessionId.");
    const session = asRecord(this.store.state.bindSessions[sessionKey]);
    if (!session) throw new Error(`Unknown WeChat bind session ${sessionKey}.`);
    return session;
  }

  async updateBindSessionFromStatus(session, status) {
    session.status = status.status ?? session.status ?? "wait";
    session.lastStatusResponse = status;
    if (status.redirect_host) {
      session.currentApiBaseUrl = normalizeRedirectHost(
        status.redirect_host,
        session.currentApiBaseUrl ?? this.config.ilinkBaseUrl,
      );
    }

    if (isConfirmedStatus(status.status)) {
      const account = await this.upsertAccountFromBindStatus(session, status);
      await this.maybeSendBindCallback(session, account).catch((error) => {
        session.bindCallbackError =
          error instanceof Error ? error.message : String(error);
      });
    }
    await this.store.save();
    return publicBindSession(session, this.store.state);
  }

  async upsertAccountFromBindStatus(session, status) {
    const accountId =
      stringValue(status.ilink_bot_id) ??
      stringValue(status.botId) ??
      stringValue(status.bot_id);
    const userId =
      stringValue(status.ilink_user_id) ??
      stringValue(status.accountRef) ??
      stringValue(status.account_ref) ??
      stringValue(status.providerAccountId) ??
      stringValue(status.provider_account_id);
    const botToken = stringValue(status.bot_token);
    if (!accountId) {
      return null;
    }
    const previous = asRecord(this.store.state.accounts[accountId]) ?? {};
    const next = {
      ...previous,
      accountId,
      openclawAccountId: accountId,
      ilinkUserId: userId ?? stringValue(previous.ilinkUserId) ?? null,
      botToken: botToken ?? stringValue(previous.botToken) ?? null,
      baseUrl:
        normalizeOptionalBaseUrl(status.baseurl) ??
        normalizeOptionalBaseUrl(status.baseUrl) ??
        stringValue(previous.baseUrl) ??
        session.currentApiBaseUrl ??
        this.config.ilinkBaseUrl,
      status: "connected",
      triggerUrl: session.triggerUrl,
      triggerAuth: session.triggerAuth,
      triggerContext: session.triggerContext,
      bindCallbackUrl: session.bindCallbackUrl,
      bindCallbackAuth: session.bindCallbackAuth,
      bindCallbackContext: session.bindCallbackContext,
      getUpdatesBuf: stringValue(previous.getUpdatesBuf) ?? "",
      connectedAt: stringValue(previous.connectedAt) ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastContextToken: stringValue(status.context_token) ?? stringValue(status.contextToken) ?? stringValue(previous.lastContextToken) ?? null,
      lastRecipientRef: userId ?? stringValue(previous.lastRecipientRef) ?? null,
    };
    this.store.state.accounts[accountId] = next;
    return next;
  }

  async maybeSendBindCallback(session, account) {
    if (!account || session.bindCallbackSentAt) return;
    if (!session.bindCallbackUrl) return;
    const body = bindCallbackBody({ session, account });
    await postJsonCallback({
      url: session.bindCallbackUrl,
      auth: session.bindCallbackAuth,
      body,
      timeoutMs: this.config.apiTimeoutMs,
    });
    session.bindCallbackSentAt = new Date().toISOString();
  }

  async sendWechatMessage(args, operation) {
    const account = this.findDeliveryAccount(args);
    if (!account) throw new Error("No connected OpenClaw Weixin account is available.");
    if (!stringValue(account.botToken)) {
      throw new Error(`OpenClaw Weixin account ${account.accountId} is missing botToken.`);
    }

    const msg = buildOutboundMessage({ args, account, operation });
    if (!msg.to_user_id) {
      throw new Error(`${operation} requires recipientRef or to_user_id.`);
    }
    if (!msg.context_token) {
      throw new Error(`${operation} requires contextToken from a recent WeChat conversation.`);
    }

    await postIlinkJson({
      config: this.config,
      baseUrl: account.baseUrl,
      endpoint: "ilink/bot/sendmessage",
      token: account.botToken,
      body: {
        msg,
        base_info: baseInfo(this.config),
      },
      timeoutMs: this.config.apiTimeoutMs,
    });
    account.lastRecipientRef = msg.to_user_id;
    account.lastContextToken = msg.context_token;
    account.updatedAt = new Date().toISOString();
    await this.store.save();
    return {
      ok: true,
      status: "sent",
      provider: "wechat",
      openclawChannel: openClawWeixinChannel,
      openclawAccountId: account.accountId,
      recipientRef: msg.to_user_id,
      contextToken: msg.context_token,
      outboundId: msg.client_id ?? null,
    };
  }

  findDeliveryAccount(args) {
    const candidates = [
      stringValue(args.openclawAccountId),
      stringValue(args.openclaw_account_id),
      stringValue(args.boundAccountRef),
      stringValue(args.bound_account_ref),
    ].filter(Boolean);
    for (const candidate of candidates) {
      const account = asRecord(this.store.state.accounts[candidate]);
      if (account) return account;
    }
    const accountRef =
      stringValue(args.accountRef) ??
      stringValue(args.account_ref) ??
      stringValue(args.recipientRef) ??
      stringValue(args.to_user_id);
    if (accountRef) {
      for (const account of Object.values(this.store.state.accounts)) {
        const record = asRecord(account);
        if (
          stringValue(record?.ilinkUserId) === accountRef ||
          stringValue(record?.lastRecipientRef) === accountRef
        ) {
          return record;
        }
      }
    }
    return Object.values(this.store.state.accounts)
      .map((account) => asRecord(account))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))[0] ?? null;
  }

  startPolling() {
    const tick = async () => {
      if (this.abortController.signal.aborted) return;
      await this.pollConnectedAccounts().catch((error) => {
        process.stderr.write(
          `[openclaw-wechat-bridge] poll failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
      if (!this.abortController.signal.aborted) {
        this.pollTimer = setTimeout(tick, this.config.pollIntervalMs);
      }
    };
    this.pollTimer = setTimeout(tick, 0);
  }

  async pollConnectedAccounts() {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const account of Object.values(this.store.state.accounts)) {
        const record = asRecord(account);
        if (!record || record.status !== "connected" || !stringValue(record.botToken)) {
          continue;
        }
        await this.pollAccount(record);
      }
    } finally {
      this.polling = false;
    }
  }

  async pollAccount(account) {
    const response = await getIlinkUpdates({
      config: this.config,
      account,
      abortSignal: this.abortController.signal,
    });
    if (isIlinkErrorResponse(response)) {
      account.lastPollError = response.errmsg ?? `ret=${response.ret} errcode=${response.errcode}`;
      account.updatedAt = new Date().toISOString();
      await this.store.save();
      return;
    }
    const nextUpdatesBuf =
      typeof response.get_updates_buf === "string"
        ? response.get_updates_buf
        : undefined;
    const messages = Array.isArray(response.msgs) ? response.msgs : [];
    for (const message of messages) {
      await this.forwardInboundMessage(account, asRecord(message) ?? {});
    }
    if (nextUpdatesBuf !== undefined) {
      account.getUpdatesBuf = nextUpdatesBuf;
    }
    account.lastPolledAt = new Date().toISOString();
    account.updatedAt = new Date().toISOString();
    await this.store.save();
  }

  async forwardInboundMessage(account, message) {
    const messageKey = inboundMessageKey(account, message);
    if (this.store.state.seenMessages[messageKey]) return;

    const contextToken = stringValue(message.context_token);
    const senderRef = stringValue(message.from_user_id);
    if (contextToken) account.lastContextToken = contextToken;
    if (senderRef) account.lastRecipientRef = senderRef;

    const callback = await postJsonCallback({
      url: account.triggerUrl,
      auth: account.triggerAuth,
      body: inboundTriggerBody({
        account,
        message,
        triggerContext: asRecord(account.triggerContext) ?? {},
      }),
      timeoutMs: this.config.apiTimeoutMs,
    });
    account.lastInboundCallback = mergeInboundCallbackProof(
      account.lastInboundCallback,
      inboundCallbackProof({ message, callback }),
    );
    this.store.state.seenMessages[messageKey] = new Date().toISOString();
    pruneSeenMessages(this.store.state.seenMessages);
  }
}

function publicBindSession(session, state) {
  const status = asRecord(session.lastStatusResponse) ?? {};
  const accountId =
    stringValue(status.ilink_bot_id) ??
    stringValue(status.botId) ??
    stringValue(status.bot_id);
  const fallbackAccount = uniqueConnectedAccount(state.accounts);
  const account =
    (accountId ? asRecord(state.accounts[accountId]) : null) ??
    fallbackAccount;
  const userId =
    stringValue(status.ilink_user_id) ??
    stringValue(status.accountRef) ??
    stringValue(status.account_ref) ??
    stringValue(account?.ilinkUserId) ??
    stringValue(account?.lastRecipientRef);
  const rawStatus = stringValue(status.status) ?? stringValue(session.status) ?? "wait";
  const connected = isConfirmedStatus(rawStatus) || stringValue(account?.status) === "connected";
  const sessionKey = stringValue(session.sessionKey);
  return {
    ok: true,
    provider: "wechat",
    tool: "WECHAT",
    openclawChannel: openClawWeixinChannel,
    openclaw_channel: openClawWeixinChannel,
    sessionId: sessionKey,
    sessionKey,
    session_key: sessionKey,
    status: connected ? "connected" : normalizePublicBindStatus(rawStatus),
    rawStatus,
    connected,
    alreadyConnected: rawStatus === "binded_redirect",
    already_connected: rawStatus === "binded_redirect",
    needsVerification: rawStatus === "need_verifycode",
    needs_verification: rawStatus === "need_verifycode",
    verificationPrompt:
      rawStatus === "need_verifycode" ? "Enter the WeChat verification code." : null,
    qrCodeContent: stringValue(session.qrCodeContent) ?? null,
    qr_code_content: stringValue(session.qrCodeContent) ?? null,
    qrcode_img_content: stringValue(session.qrCodeContent) ?? null,
    expiresAt: stringValue(session.expiresAt) ?? null,
    expires_at: stringValue(session.expiresAt) ?? null,
    pollAfterMs: defaultPollIntervalMs,
    poll_after_ms: defaultPollIntervalMs,
    accountRef: userId ?? null,
    account_ref: userId ?? null,
    providerAccountId: userId ?? null,
    provider_account_id: userId ?? null,
    wechatUserRef: userId ?? null,
    wechat_user_ref: userId ?? null,
    ilink_user_id: userId ?? null,
    openclawAccountId: accountId ?? stringValue(account?.accountId) ?? null,
    openclaw_account_id: accountId ?? stringValue(account?.accountId) ?? null,
    ilink_bot_id: accountId ?? stringValue(account?.accountId) ?? null,
    boundAccountRef: accountId ?? stringValue(account?.accountId) ?? null,
    bound_account_ref: accountId ?? stringValue(account?.accountId) ?? null,
    contextToken: stringValue(status.contextToken) ?? stringValue(status.context_token) ?? stringValue(account?.lastContextToken) ?? null,
    context_token: stringValue(status.context_token) ?? stringValue(status.contextToken) ?? stringValue(account?.lastContextToken) ?? null,
    conversationRef: sessionKey,
    conversation_ref: sessionKey,
    messageRef: sessionKey,
    message_ref: sessionKey,
    lastInboundCallback: publicCallbackProof(account?.lastInboundCallback),
    last_inbound_callback: publicCallbackProof(account?.lastInboundCallback),
    data: {
      status: rawStatus,
      ...status,
    },
  };
}

function uniqueConnectedAccount(accounts) {
  const connected = Object.values(asRecord(accounts) ?? {})
    .map((account) => asRecord(account))
    .filter(
      (account) =>
        account && stringValue(account.status) === "connected",
    );
  return connected.length === 1 ? connected[0] : null;
}

function bindCallbackBody({ session, account }) {
  const sessionKey = stringValue(session.sessionKey);
  const accountId = stringValue(account.accountId);
  const userId = stringValue(account.ilinkUserId) ?? stringValue(account.lastRecipientRef);
  const contextToken = stringValue(account.lastContextToken);
  const body = {
    provider: "wechat",
    tool: "WECHAT",
    openclawChannel: openClawWeixinChannel,
    openclaw_channel: openClawWeixinChannel,
    sessionId: sessionKey,
    sessionKey,
    session_key: sessionKey,
    status: "connected",
    connected: true,
    accountRef: userId,
    account_ref: userId,
    providerAccountId: userId,
    provider_account_id: userId,
    wechatUserRef: userId,
    wechat_user_ref: userId,
    ilink_user_id: userId,
    openclawAccountId: accountId,
    openclaw_account_id: accountId,
    boundAccountRef: accountId,
    bound_account_ref: accountId,
    ilink_bot_id: accountId,
    recipientRef: userId,
    recipient_ref: userId,
    senderRef: userId,
    sender_ref: userId,
    from_user_id: userId,
    to_user_id: accountId,
    conversationRef: sessionKey,
    conversation_ref: sessionKey,
    messageRef: sessionKey,
    message_ref: sessionKey,
    contextToken,
    context_token: contextToken,
    bindCallbackContext: session.bindCallbackContext,
    bind_callback_context: session.bindCallbackContext,
    context: session.bindCallbackContext,
  };
  return stripUndefined({
    ...body,
    data: body,
  });
}

function inboundTriggerBody({ account, message, triggerContext }) {
  const senderRef = stringValue(message.from_user_id);
  const recipientRef =
    stringValue(message.to_user_id) ?? stringValue(account.accountId);
  const messageRef =
    textLikeValue(message.message_id) ??
    textLikeValue(message.msgid) ??
    textLikeValue(message.client_id) ??
    textLikeValue(message.seq);
  const text = inboundText(message);
  const contextToken = stringValue(message.context_token);
  const sessionId = stringValue(message.session_id);
  const publicTriggerContext = stripUndefined({
    ...triggerContext,
    openclawChannel: openClawWeixinChannel,
    openclaw_channel: openClawWeixinChannel,
    OriginatingChannel: openClawWeixinChannel,
    Provider: openClawWeixinChannel,
  });
  const publicMessage = stripUndefined({
    ...message,
    session_id: sessionId,
    sessionId:
      stringValue(message.sessionId) ??
      sessionId,
  });
  return stripUndefined({
    ...publicTriggerContext,
    type: "message.received",
    provider: "wechat",
    openclawChannel: openClawWeixinChannel,
    openclaw_channel: openClawWeixinChannel,
    openclawAccountId: account.accountId,
    openclaw_account_id: account.accountId,
    boundAccountRef: account.accountId,
    bound_account_ref: account.accountId,
    accountRef: senderRef,
    account_ref: senderRef,
    providerAccountId: senderRef,
    provider_account_id: senderRef,
    wechatUserRef: senderRef,
    wechat_user_ref: senderRef,
    contactRef: senderRef,
    contact_ref: senderRef,
    senderRef,
    sender_ref: senderRef,
    recipientRef,
    recipient_ref: recipientRef,
    from_user_id: senderRef,
    to_user_id: recipientRef,
    conversationRef:
      stringValue(message.session_id) ?? contextToken ?? senderRef ?? recipientRef,
    conversation_ref:
      stringValue(message.session_id) ?? contextToken ?? senderRef ?? recipientRef,
    messageRef,
    message_ref: messageRef,
    messageId: messageRef,
    message_id: message.message_id,
    msgId: stringValue(message.msgid),
    msgid: stringValue(message.msgid),
    message_type: message.message_type,
    messageType: message.message_type,
    message_state: message.message_state,
    messageState: message.message_state,
    session_id: sessionId,
    sessionId,
    contextToken,
    context_token: contextToken,
    ilink_user_id: senderRef,
    ilink_bot_id: account.accountId,
    text,
    content: text,
    Body: text,
    From: senderRef,
    To: recipientRef,
    AccountId: account.accountId,
    OriginatingChannel: openClawWeixinChannel,
    OriginatingTo: senderRef,
    MessageSid: messageRef,
    Timestamp: message.create_time_ms,
    Provider: openClawWeixinChannel,
    triggerContext: publicTriggerContext,
    trigger_context: publicTriggerContext,
    context: publicTriggerContext,
    msg: publicMessage,
    payload: {
      msg: publicMessage,
      triggerContext: publicTriggerContext,
      openclawChannel: openClawWeixinChannel,
      openclaw_channel: openClawWeixinChannel,
      Provider: openClawWeixinChannel,
    },
  });
}

function inboundCallbackProof({ message, callback }) {
  const messageRef =
    textLikeValue(message.message_id) ??
    textLikeValue(message.msgid) ??
    textLikeValue(message.client_id) ??
    textLikeValue(message.seq);
  return {
    ...callbackProof(callback),
    messageRef: messageRef ?? null,
    contextTokenPresent: Boolean(stringValue(message.context_token)),
    textPresent: Boolean(inboundText(message)),
  };
}

function mergeInboundCallbackProof(previous, next) {
  const previousRecord = asRecord(previous);
  if (
    isSupervisorReplyDeliveryProof(previousRecord) &&
    stringValue(next.supervisorStatus) === "duplicate_reply"
  ) {
    return previousRecord;
  }
  return next;
}

function isSupervisorReplyDeliveryProof(value) {
  const record = asRecord(value);
  if (!record) return false;
  return (
    record.supervisorReplied === true &&
    booleanOrNull(record.supervisorDeliveryOk) === true &&
    booleanOrNull(record.supervisorDeliveryBodyOk) !== false
  );
}

function callbackProof(callback) {
  const body = asRecord(callback?.body) ?? {};
  const supervisor = asRecord(body.supervisor) ?? {};
  const delivery = asRecord(supervisor.delivery) ?? {};
  const status = numberValue(callback?.status);
  const bodyOk = booleanOrNull(body.ok);
  const supervisorStatus = stringValue(supervisor.status);
  const supervisorDeliveryOk = booleanOrNull(delivery.ok);
  const supervisorDeliveryBodyOk = booleanOrNull(delivery.bodyOk);
  return stripUndefined({
    ok: status ? status >= 200 && status < 300 && bodyOk !== false : false,
    status: status ?? null,
    bodyOk,
    supervisorStatus: supervisorStatus ?? null,
    supervisorReplied: supervisorStatus === "replied",
    supervisorDeliveryOk,
    supervisorDeliveryStatus: numberValue(delivery.status) ?? null,
    supervisorDeliveryBodyOk,
    recordedAt: new Date().toISOString(),
  });
}

function publicCallbackProof(value) {
  const record = asRecord(value);
  if (!record) return null;
  return stripUndefined({
    ok: record.ok === true,
    status: numberValue(record.status) ?? null,
    bodyOk: booleanOrNull(record.bodyOk),
    supervisorStatus: stringValue(record.supervisorStatus) ?? null,
    supervisorReplied: record.supervisorReplied === true,
    supervisorDeliveryOk: booleanOrNull(record.supervisorDeliveryOk),
    supervisorDeliveryStatus: numberValue(record.supervisorDeliveryStatus) ?? null,
    supervisorDeliveryBodyOk: booleanOrNull(record.supervisorDeliveryBodyOk),
    messageRefPresent:
      record.messageRefPresent === true || Boolean(textLikeValue(record.messageRef)),
    contextTokenPresent: record.contextTokenPresent === true,
    textPresent: record.textPresent === true,
    recordedAt: stringValue(record.recordedAt) ?? null,
  });
}

function buildOutboundMessage({ args, account, operation }) {
  const provided = asRecord(args.msg);
  const recipientRef =
    stringValue(args.recipientRef) ??
    stringValue(args.recipient_ref) ??
    stringValue(args.to_user_id) ??
    stringValue(provided?.to_user_id) ??
    stringValue(account.lastRecipientRef) ??
    stringValue(account.ilinkUserId);
  const contextToken =
    stringValue(args.contextToken) ??
    stringValue(args.context_token) ??
    stringValue(provided?.context_token) ??
    stringValue(account.lastContextToken);
  const text =
    operation === "send_inbox_item"
      ? inboxText(args)
      : stringValue(args.text);
  return stripUndefined({
    ...provided,
    from_user_id:
      stringValue(provided?.from_user_id) ??
      stringValue(args.from_user_id) ??
      stringValue(args.openclawAccountId) ??
      stringValue(args.openclaw_account_id) ??
      stringValue(account.accountId) ??
      "",
    to_user_id: recipientRef,
    client_id:
      stringValue(provided?.client_id) ??
      stringValue(args.idempotencyKey) ??
      stringValue(args.eventId) ??
      randomUUID(),
    message_type: numberValue(provided?.message_type) ?? 2,
    message_state: numberValue(provided?.message_state) ?? 2,
    context_token: contextToken,
    item_list:
      Array.isArray(provided?.item_list) && provided.item_list.length
        ? provided.item_list
        : text
          ? [{ type: 1, text_item: { text } }]
          : undefined,
  });
}

function inboxText(args) {
  const title = stringValue(args.title);
  const summary = stringValue(args.summary);
  if (title && summary) return `${title}\n${summary}`;
  return summary ?? title;
}

async function fetchIlinkQrCode({ config, localTokenList }) {
  return postIlinkJson({
    config,
    baseUrl: config.ilinkBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(config.botType)}`,
    body: {
      local_token_list: localTokenList,
    },
    timeoutMs: config.apiTimeoutMs,
  });
}

async function pollIlinkQrStatus({ config, session, verifyCode }) {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(
    stringValue(session.qrcode) ?? "",
  )}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  try {
    return await getIlinkJson({
      config,
      baseUrl: stringValue(session.currentApiBaseUrl) ?? config.ilinkBaseUrl,
      endpoint,
      timeoutMs: config.longPollTimeoutMs,
    });
  } catch (error) {
    if (isAbortError(error)) return { status: "wait" };
    throw error;
  }
}

async function getIlinkUpdates({ config, account, abortSignal }) {
  try {
    return await postIlinkJson({
      config,
      baseUrl: account.baseUrl,
      endpoint: "ilink/bot/getupdates",
      token: account.botToken,
      body: {
        get_updates_buf: stringValue(account.getUpdatesBuf) ?? "",
        base_info: baseInfo(config),
      },
      timeoutMs: config.longPollTimeoutMs,
      abortSignal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return {
        ret: 0,
        msgs: [],
        get_updates_buf: stringValue(account.getUpdatesBuf) ?? "",
      };
    }
    throw error;
  }
}

async function getIlinkJson(input) {
  const response = await fetchWithTimeout(joinBasePath(input.baseUrl, input.endpoint), {
    method: "GET",
    headers: buildIlinkHeaders(input.config, {}),
    timeoutMs: input.timeoutMs,
  });
  return readJsonResponse(response, "iLink GET");
}

async function postIlinkJson(input) {
  const response = await fetchWithTimeout(joinBasePath(input.baseUrl, input.endpoint), {
    method: "POST",
    headers: buildIlinkHeaders(input.config, { token: input.token }),
    body: JSON.stringify(input.body),
    timeoutMs: input.timeoutMs,
    abortSignal: input.abortSignal,
  });
  return readJsonResponse(response, "iLink POST");
}

async function postJsonCallback(input) {
  const response = await fetchWithTimeout(input.url, {
    method: "POST",
    headers: stripUndefined({
      "content-type": "application/json",
      authorization: authHeaderFromAuth(input.auth),
    }),
    body: JSON.stringify(input.body),
    timeoutMs: input.timeoutMs,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gosper callback returned ${response.status}: ${text.slice(0, 500)}`);
  }
  const text = await response.text();
  return {
    status: response.status,
    body: parseJsonObject(text) ?? {},
  };
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
  const externalSignal = init.abortSignal;
  const abort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return parseJsonObject(text) ?? {};
}

function buildIlinkHeaders(config, input) {
  return stripUndefined({
    "content-type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    "iLink-App-Id": config.ilinkAppId,
    "iLink-App-ClientVersion": String(buildClientVersion(config.channelVersion)),
    authorization: input.token ? `Bearer ${input.token}` : undefined,
  });
}

function baseInfo(config) {
  return {
    channel_version: config.channelVersion,
    bot_agent: config.botAgent,
  };
}

function buildClientVersion(version) {
  const [major = 0, minor = 0, patch = 0] = String(version)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function randomWechatUin() {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf8").toString(
    "base64",
  );
}

async function readJsonRequest(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 1024 * 1024) throw new Error("Request body too large.");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return parseJsonObject(text) ?? {};
}

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body, null, 2));
}

function authorizedBearer(header, token) {
  const expected = stringValue(token);
  const actual = String(header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || !actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authHeaderFromAuth(auth) {
  const record = asRecord(auth) ?? {};
  const type = stringValue(record.type) ?? "bearer";
  const token = stringValue(record.token);
  if (!token) return undefined;
  return type.toLowerCase() === "bearer" ? `Bearer ${token}` : token;
}

function openClawContextFrom(context) {
  return {
    ...context,
    openclawChannel: openClawWeixinChannel,
    openclaw_channel: openClawWeixinChannel,
  };
}

function inboundText(message) {
  const items = Array.isArray(message.item_list) ? message.item_list : [];
  for (const item of items) {
    const record = asRecord(item) ?? {};
    const textItem = asRecord(record.text_item) ?? {};
    const text = stringValue(textItem.text);
    if (Number(record.type) === 1 && text) return text;
  }
  return undefined;
}

function inboundMessageKey(account, message) {
  return [
    account.accountId,
    stringValue(message.message_id) ??
      stringValue(message.client_id) ??
      stringValue(message.seq) ??
      JSON.stringify(message),
  ].join(":");
}

function latestLocalTokenList(state) {
  return Object.values(state.accounts)
    .map((account) => asRecord(account))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .flatMap((account) => {
      const token = stringValue(account.botToken);
      return token ? [token] : [];
    })
    .slice(0, 10);
}

function bindSessionExpired(session) {
  const expiresAt = stringValue(session.expiresAt);
  return expiresAt ? Date.parse(expiresAt) <= Date.now() : false;
}

function isConfirmedStatus(status) {
  const value = String(status ?? "").toLowerCase();
  return (
    value === "confirmed" ||
    value === "connected" ||
    value === "bound" ||
    value === "binded_redirect"
  );
}

function normalizePublicBindStatus(status) {
  const value = String(status ?? "").toLowerCase();
  if (value === "scaned" || value === "scaned_but_redirect" || value === "need_verifycode") {
    return "scanned";
  }
  if (value === "expired") return "expired";
  if (value === "verify_code_blocked" || value === "failed" || value === "error") {
    return "failed";
  }
  return "pending";
}

function isIlinkErrorResponse(response) {
  return (
    (response.ret !== undefined && response.ret !== 0) ||
    (response.errcode !== undefined && response.errcode !== 0)
  );
}

function pruneSeenMessages(seenMessages) {
  const entries = Object.entries(seenMessages);
  if (entries.length <= maxSeenMessages) return;
  entries
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    .slice(0, entries.length - maxSeenMessages)
    .forEach(([key]) => {
      delete seenMessages[key];
    });
}

function normalizeRedirectHost(value, fallbackBaseUrl) {
  const text = stringValue(value);
  if (!text) return fallbackBaseUrl;
  if (/^https?:\/\//i.test(text)) return normalizeBaseUrl(text);
  const fallback = new URL(fallbackBaseUrl);
  return `${fallback.protocol}//${text.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function joinBasePath(baseUrl, path) {
  const base = `${normalizeBaseUrl(baseUrl)}/`;
  return new URL(path.replace(/^\/+/, ""), base).toString();
}

function validateHttpUrl(value, label, invalid) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      invalid.push(`${label} must be an http(s) URL.`);
    }
  } catch {
    invalid.push(`${label} must be an absolute URL.`);
  }
}

function parseStateEnvelope(text, stateSecret) {
  const envelope = parseJsonObject(text) ?? {};
  if (envelope.encrypted === true) {
    if (!stateSecret) {
      throw new Error(
        "OpenClaw WeChat bridge state is encrypted but OPENCLAW_WECHAT_BRIDGE_STATE_SECRET is not configured.",
      );
    }
    return parseJsonObject(decryptStateEnvelope(envelope, stateSecret)) ?? {};
  }
  return envelope;
}

function encryptedStateEnvelope(plaintext, stateSecret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", stateKey(stateSecret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${JSON.stringify(
    {
      version: stateVersion,
      encrypted: true,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      data: ciphertext.toString("base64"),
    },
    null,
    2,
  )}\n`;
}

function decryptStateEnvelope(envelope, stateSecret) {
  if (envelope.algorithm !== "aes-256-gcm") {
    throw new Error("Unsupported OpenClaw WeChat bridge state encryption algorithm.");
  }
  const iv = Buffer.from(stringValue(envelope.iv) ?? "", "base64");
  const tag = Buffer.from(stringValue(envelope.tag) ?? "", "base64");
  const data = Buffer.from(stringValue(envelope.data) ?? "", "base64");
  const decipher = createDecipheriv("aes-256-gcm", stateKey(stateSecret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}

function stateKey(stateSecret) {
  return createHash("sha256")
    .update("gosper-openclaw-wechat-bridge-state:", "utf8")
    .update(stateSecret, "utf8")
    .digest();
}

function isProductionEnv() {
  return process.env.NODE_ENV === "production";
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textLikeValue(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function readNonNegativeIntegerValue(value, fallback) {
  const parsed = Number.parseInt(stringValue(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseJsonObject(text) {
  if (!text || !String(text).trim()) return null;
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

function bridgeUsage() {
  return `Usage: gosper-openclaw-wechat start -- [options]

Runs the Gosper OpenClaw WeChat transport bridge. This process bypasses
OpenClaw's LLM/channel runtime and only uses iLink QR, getupdates, and
sendmessage transport APIs.

Options:
  --dry-run                         Print sanitized config and contract.
  --host <host>                     Listen host. Defaults to 127.0.0.1.
  --port <port>                     Listen port. Defaults to 8787 or PORT.
  --state-path <path>               Durable JSON state file path.
  --bridge-token <token>            Incoming bearer token.
  --gosper-base-url <url>           Public Gosper origin for callbacks.
  --trigger-secret <secret>         Bearer token for Gosper trigger routes.
  --ilink-base-url <url>            iLink base URL. Defaults to Tencent iLink.
  --bot-type <type>                 iLink bot_type. Defaults to 3.
  --poll-interval-ms <ms>           Delay between poll loops.
  --long-poll-timeout-ms <ms>       iLink getupdates/get_qrcode_status timeout.
  -h, --help                        Show this help.

Environment:
  OPENCLAW_WECHAT_BRIDGE_TOKEN or GOSPER_WECHAT_TOOL_TOKEN
  OPENCLAW_WECHAT_GOSPER_BASE_URL or GOSPER_APP_BASE_URL
  OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET or GOSPER_WECHAT_TRIGGER_SECRET
  OPENCLAW_WECHAT_BRIDGE_STATE_PATH
  OPENCLAW_WECHAT_ILINK_BASE_URL
`;
}

await main();
