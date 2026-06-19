import { execFile } from "node:child_process";
import { access, readdir, readFile, stat } from "node:fs/promises";
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
    await expect(access("src/index.mjs")).rejects.toThrow();

    expect(pkg.name).toBe("@gosper/gosper-wechat");
    expect(pkg.description).toBe("Gosper WeChat transport bridge");
    expect(pkg[legacyName]).toBeUndefined();
    expect(pkg.peerDependencies?.[legacyName]).toBeUndefined();
    expect(pkg.scripts.quickstart).toBe("node bin/gosper-wechat.mjs quickstart");
    expect(pkg.scripts.bridge).toBe("node src/gosper-wechat-bridge.mjs");
    expect(pkg.bin["gosper-wechat"]).toBe("bin/gosper-wechat.mjs");
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
    const { stdout } = await execFileAsync("node", [
      "bin/gosper-wechat.mjs",
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
    const { stdout } = await execFileAsync("node", [
      "bin/gosper-wechat.mjs",
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
    const { stdout } = await execFileAsync("node", [
      "bin/gosper-wechat.mjs",
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
      "node",
      ["bin/gosper-wechat.mjs", "start", "--dry-run"],
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
});

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
      path.endsWith(".mjs") ||
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
