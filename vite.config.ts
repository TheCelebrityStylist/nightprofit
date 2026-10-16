import vinext from "vinext";
import { defineConfig } from "vite";
import sites from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
// Base44 preview runs in Docker, which also needs polling and 0.0.0.0 binding.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const isBase44Preview = process.env.BASE44_PREVIEW_MODE === "1";

const localBindingConfig: Record<string, unknown> = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox || isBase44Preview
      ? {
          ...(isBase44Preview ? { host: "0.0.0.0" } : {}),
          watch: { useFsEvents: false, usePolling: true },
        }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: isBase44Preview
          ? (cfg: Record<string, unknown>) => ({ ...cfg, dev: { ...(cfg.dev as object | undefined), ip: "0.0.0.0" } })
          : localBindingConfig,
      }),
    ],
  };
});
