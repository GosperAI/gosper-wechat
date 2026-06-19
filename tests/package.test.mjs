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
