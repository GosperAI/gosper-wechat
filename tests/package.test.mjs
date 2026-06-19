import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("openclaw-wechat package", () => {
  it("declares a native OpenClaw manifest without a channel runtime", async () => {
    const manifest = JSON.parse(await readFile("openclaw.plugin.json", "utf8"));
    const pkg = JSON.parse(await readFile("package.json", "utf8"));

    expect(manifest.id).toBe("gosper-openclaw-wechat");
    expect(manifest.channels).toBeUndefined();
    expect(manifest.activation.onStartup).toBe(false);
    expect(manifest.configSchema.type).toBe("object");
    expect(manifest.setup.requiresRuntime).toBe(false);
    expect(manifest.setup.providers[0].envVars).toEqual(
      expect.arrayContaining([
        "OPENCLAW_WECHAT_BRIDGE_TOKEN",
        "OPENCLAW_WECHAT_GOSPER_BASE_URL",
        "OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET",
        "OPENCLAW_WECHAT_BRIDGE_STATE_SECRET"
      ]),
    );

    expect(pkg.name).toBe("@gosper/openclaw-wechat");
    expect(pkg.openclaw.extensions).toEqual(["./src/index.mjs"]);
    expect(pkg.openclaw.startup).toBeUndefined();
    expect(pkg.scripts.quickstart).toBe("node bin/gosper-openclaw-wechat.mjs quickstart");
    expect(pkg.bin["gosper-openclaw-wechat"]).toBe(
      "bin/gosper-openclaw-wechat.mjs",
    );
  });

  it("generates paired bridge and Gosper env blocks", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/gosper-openclaw-wechat.mjs",
      "env",
      "--gosper-base-url",
      "https://gosper.example.com",
      "--bridge-base-url",
      "https://wechat-bridge.example.com"
    ]);

    expect(stdout).toContain("OPENCLAW_WECHAT_BRIDGE_TOKEN=");
    expect(stdout).toContain("OPENCLAW_WECHAT_GOSPER_BASE_URL=https://gosper.example.com");
    expect(stdout).toContain("GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com");
    expect(stdout).toContain("GOSPER_WECHAT_TRIGGER_SECRET=");
  });

  it("ships a real Chinese usage guide with setup and verification steps", async () => {
    const readme = await readFile("README.zh_CN.md", "utf8");
    const usage = await readFile("docs/usage.zh-CN.md", "utf8");

    expect(readme).toContain("五分钟快速开始");
    expect(readme).toContain("不需要安装 OpenClaw CLI");
    expect(readme).toContain("完整使用手册");
    expect(readme).toContain("推荐把 bridge 部署在 OpenClaw 所在的常驻机器上");
    expect(usage).toContain("一键启动，不安装 OpenClaw");
    expect(usage).toContain("部署 bridge");
    expect(usage).toContain("推荐部署位置是 OpenClaw 所在机器");
    expect(usage).toContain("配置 Gosper");
    expect(usage).toContain("用户绑定流程");
    expect(usage).toContain("Gosper probe 验收");
    expect(usage).toContain("不需要执行 `openclaw channels login --channel openclaw-weixin`");
  });

  it("supports quickstart dry-run without installing OpenClaw", async () => {
    const { stdout } = await execFileAsync("node", [
      "bin/gosper-openclaw-wechat.mjs",
      "quickstart",
      "--gosper-base-url",
      "https://gosper.example.com",
      "--bridge-base-url",
      "https://wechat-bridge.example.com",
      "--dry-run"
    ]);

    expect(stdout).toContain("# Would write");
    expect(stdout).toContain("OPENCLAW_WECHAT_BRIDGE_TOKEN=");
    expect(stdout).toContain("GOSPER_WECHAT_TOOL_BASE_URL=https://wechat-bridge.example.com");
    expect(stdout).toContain("docker compose");
  });

  it("runs bridge dry-run through the CLI", async () => {
    const { stdout } = await execFileAsync(
      "node",
      ["bin/gosper-openclaw-wechat.mjs", "start", "--dry-run"],
      {
        env: {
          ...process.env,
          OPENCLAW_WECHAT_BRIDGE_TOKEN: "bridge-token",
          OPENCLAW_WECHAT_GOSPER_BASE_URL: "https://gosper.example.com",
          OPENCLAW_WECHAT_GOSPER_TRIGGER_SECRET: "trigger-secret",
          OPENCLAW_WECHAT_BRIDGE_STATE_SECRET: "state-secret"
        }
      },
    );
    const output = JSON.parse(stdout);

    expect(output.ok).toBe(true);
    expect(output.bridge.mode).toBe("external_openclaw_transport");
    expect(output.contract.openclawLlmLayer).toBe("bypassed");
    expect(output.contract.operations).toEqual(
      expect.arrayContaining(["create_bind_session", "send_supervisor_reply"]),
    );
  });
});
