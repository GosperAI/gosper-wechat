import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const legacyName = ["open", "claw"].join("");
const legacyUpperName = ["OPEN", "CLAW"].join("");

describe("gosper-wechat package", () => {
  it("declares a standalone Gosper WeChat package", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));

    await expect(access(`${legacyName}.plugin.json`)).rejects.toThrow();
    await expect(access("src/index.ts")).rejects.toThrow();

    expect(pkg.name).toBe("@gosper/gosper-wechat");
    expect(pkg.description).toBe("Gosper WeChat transport bridge");
    expect(pkg[legacyName]).toBeUndefined();
    expect(pkg.peerDependencies?.[legacyName]).toBeUndefined();
    expect(pkg.scripts.quickstart).toBe("tsx bin/gosper-wechat.ts quickstart");
    expect(pkg.scripts.bridge).toBe("tsx src/gosper-wechat-bridge.ts");
    expect(pkg.bin["gosper-wechat"]).toBe("bin/gosper-wechat.ts");
  });

  it("does not ship legacy transport-host strings in published files", async () => {
    const files = await publishedTextFiles(".");
    const offenders = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (new RegExp(legacyName, "i").test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("generates paired bridge and Gosper env blocks", async () => {
    const { stdout } = await execFileAsync("tsx", [
      "bin/gosper-wechat.ts",
      "env",
      "--bridge-base-url",
      "https://wechat-bridge.example.com"
    ]);

    expect(stdout).toContain("GOSPER_WECHAT_TOOL_TOKEN=");
    expect(stdout).toContain("GOSPER_APP_BASE_URL=https://gosper-ashen.vercel.app");
    expect(stdout).toContain("GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com");
    expect(stdout).toContain("GOSPER_WECHAT_TRIGGER_SECRET=");
    expect(stdout).not.toContain(legacyUpperName);
  });

  it("allows self-hosted Gosper to override the public default", async () => {
    const { stdout } = await execFileAsync("tsx", [
      "bin/gosper-wechat.ts",
      "env",
      "--bridge-base-url",
      "https://wechat-bridge.example.com",
      "--gosper-base-url",
      "https://gosper.example.com"
    ]);

    expect(stdout).toContain("GOSPER_APP_BASE_URL=https://gosper.example.com");
  });

  it("ships a real Chinese usage guide with setup and verification steps", async () => {
    const readme = await readFile("README.zh_CN.md", "utf8");
    const usage = await readFile("docs/usage.zh-CN.md", "utf8");

    expect(readme).toContain("GosperAI/gosper-wechat");
    expect(readme).toContain("五分钟快速开始");
    expect(readme).toContain("Gosper 公开生产地址是内置默认值，不需要配置");
    expect(readme).toContain("GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com");
    expect(usage).toContain("最终链路");
    expect(usage).toContain("部署 bridge");
    expect(usage).toContain("配置 Gosper");
    expect(usage).toContain("用户绑定流程");
    expect(usage).toContain("Gosper probe 验收");
    expect(usage).toContain("GOSPER_WECHAT_TOOL_BASE_URL");
  });

  it("supports quickstart dry-run", async () => {
    const { stdout } = await execFileAsync("tsx", [
      "bin/gosper-wechat.ts",
      "quickstart",
      "--bridge-base-url",
      "https://wechat-bridge.example.com",
      "--dry-run"
    ]);

    expect(stdout).toContain("# Would write");
    expect(stdout).toContain("GOSPER_WECHAT_TOOL_TOKEN=");
    expect(stdout).toContain("GOSPER_APP_BASE_URL=https://gosper-ashen.vercel.app");
    expect(stdout).toContain("GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com");
    expect(stdout).toContain("docker compose");
    expect(stdout).not.toContain(legacyUpperName);
  });

  it("runs bridge dry-run through the CLI", async () => {
    const { stdout } = await execFileAsync(
      "tsx",
      ["bin/gosper-wechat.ts", "start", "--dry-run"],
      {
        env: {
          ...process.env,
          GOSPER_WECHAT_TOOL_TOKEN: "bridge-token",
          GOSPER_APP_BASE_URL: "https://gosper.example.com",
          GOSPER_WECHAT_TRIGGER_SECRET: "trigger-secret",
          GOSPER_WECHAT_BRIDGE_STATE_SECRET: "state-secret"
        }
      },
    );
    const output = JSON.parse(stdout);

    expect(output.ok).toBe(true);
    expect(output.bridge.mode).toBe("gosper_wechat_transport");
    expect(output.contract.transport).toBe("ilink-wechat");
    expect(output.contract.operations).toEqual(
      expect.arrayContaining(["create_bind_session", "send_supervisor_reply"]),
    );
  });

  it("routes outbound messages inside the Gosper user owner scope", async () => {
    const sendRequests: Array<{ authorization: string | undefined; body: any }> = [];
    const ilinkServer = createServer(async (req, res) => {
      const body = await readRequestBody(req);
      if (String(req.url ?? "").includes("sendmessage")) {
        sendRequests.push({
          authorization: req.headers.authorization,
          body: JSON.parse(body || "{}"),
        });
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: "" }));
    });
    const ilinkBaseUrl = await listenTestServer(ilinkServer);
    const dir = await mkdtemp(join(tmpdir(), "gosper-wechat-"));
    const statePath = join(dir, "state.json");
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        bindSessions: {},
        seenMessages: {},
        accounts: {
          userA: {
            accountId: "bot-a",
            status: "connected",
            organizationId: "org-1",
            userId: "user-a",
            ilinkUserId: "same-wechat-user",
            lastRecipientRef: "same-wechat-user",
            lastContextToken: "ctx-a",
            botToken: "token-a",
            baseUrl: ilinkBaseUrl,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          userB: {
            accountId: "bot-b",
            status: "connected",
            organizationId: "org-1",
            userId: "user-b",
            ilinkUserId: "same-wechat-user",
            lastRecipientRef: "same-wechat-user",
            lastContextToken: "ctx-b",
            botToken: "token-b",
            baseUrl: ilinkBaseUrl,
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        },
      }),
    );

    const bridge = spawn(
      "tsx",
      [
        "src/gosper-wechat-bridge.ts",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
        "--state-path",
        statePath,
        "--poll-interval-ms",
        "60000",
      ],
      {
        env: {
          ...process.env,
          GOSPER_WECHAT_TOOL_TOKEN: "bridge-token",
          GOSPER_APP_BASE_URL: "https://gosper.example.com",
          GOSPER_WECHAT_TRIGGER_SECRET: "trigger-secret",
          GOSPER_WECHAT_ILINK_BASE_URL: ilinkBaseUrl,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    try {
      const bridgeBaseUrl = await readBridgeBaseUrl(bridge);
      const response = await fetch(`${bridgeBaseUrl}/v1/wechat/tools/execute`, {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          op: "send_supervisor_reply",
          args: {
            accountRef: "same-wechat-user",
            recipientRef: "same-wechat-user",
            contextToken: "ctx-a",
            text: "hello user-a",
          },
          context: {
            organizationId: "org-1",
            userId: "user-a",
          },
        }),
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.wechatBotId).toBe("bot-a");
      expect(body.ownerScoped).toBe(true);
      expect(sendRequests).toHaveLength(1);
      expect(sendRequests[0].authorization).toBe("Bearer token-a");
      expect(sendRequests[0].body.msg.from_user_id).toBe("bot-a");
    } finally {
      bridge.kill("SIGTERM");
      await Promise.race([waitForExit(bridge), sleep(1000)]);
      await closeTestServer(ilinkServer);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function listenTestServer(server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Test server did not bind to a TCP port.");
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeTestServer(server): Promise<undefined> {
  return new Promise((resolve) => server.close(() => resolve(undefined)));
}

function waitForExit(child): Promise<unknown> {
  return new Promise((resolve) => child.once("exit", resolve));
}

function sleep(ms): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRequestBody(req): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function readBridgeBaseUrl(child): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Bridge did not start. stderr=${stderr}`));
    }, 5000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const line = stdout.split(/\r?\n/).find(Boolean);
      if (!line) return;
      try {
        const event = JSON.parse(line);
        if (event.baseUrl) {
          clearTimeout(timeout);
          resolve(event.baseUrl);
        }
      } catch {
        // Ignore non-JSON startup output.
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bridge exited before listening with code ${code}. stderr=${stderr}`));
    });
  });
}

async function publishedTextFiles(root) {
  const entries = await readdir(root);
  const result = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "tests"].includes(entry)) continue;
    const path = join(root, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      result.push(...(await publishedTextFiles(path)));
      continue;
    }
    if (
      path.endsWith(".ts") ||
      path.endsWith(".json") ||
      path.endsWith(".md") ||
      path.endsWith(".yaml") ||
      path.endsWith(".yml") ||
      path.endsWith(".example") ||
      path.endsWith("Dockerfile")
    ) {
      result.push(path);
    }
  }
  return result;
}
