import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { noSymlinks } from "../cli/project.ts";
import { createNativeOffice } from "./native-office.ts";
import type { LiveConfig } from "./live.ts";
import { configurePazmoHost } from "../../vendor/claw-empire/server/pazmo/host.ts";

// IPC configuration is supplied by the trusted local launcher, never an agent.
process.once("message", async (raw: unknown) => {
  try {
    const value = raw as {
      project: string;
      dataDir: string;
      port: number;
      token: string;
      instance: string;
      live?: LiveConfig;
    };
    if (
      !value ||
      !Number.isInteger(value.port) ||
      value.port < 0 ||
      value.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(value.token) ||
      !/^[a-f0-9]{32}$/.test(value.instance)
    )
      throw new Error("INVALID_HOST_CONFIG");

    const project = realpathSync(value.project),
      dataDir = realpathSync(value.dataDir);
    noSymlinks(dataDir);
    const nativeData = join(dataDir, "claw");
    noSymlinks(nativeData);
    mkdirSync(nativeData, { recursive: true, mode: 0o700 });
    process.env.PAZMO_MANAGED = "1";
    process.env.HOST = "127.0.0.1";
    process.env.PORT = String(value.port);
    process.env.APP_DATA_DIR = nativeData;
    process.env.DB_PATH = join(nativeData, "claw.sqlite");
    process.env.LOGS_DIR = join(nativeData, "logs");
    process.env.API_AUTH_TOKEN = value.token;
    process.env.PROJECT_PATH_ALLOWED_ROOTS = project;
    configurePazmoHost({
      project,
      instance: value.instance,
      token: value.token,
      initialize: (db) =>
        createNativeOffice({
          db,
          project,
          dataDir: nativeData,
          token: value.token,
          live: value.live,
        }),
    });
    // Upstream uses its own bundler-mode TypeScript project; do not pull it
    // into the Office NodeNext compilation unit.
    await import(
      new URL("../../vendor/claw-empire/server/server-main.ts", import.meta.url)
        .href
    );
  } catch (error) {
    process.send?.({
      type: "error",
      error: error instanceof Error ? error.message : "STARTUP_FAILED",
    });
    process.exitCode = 1;
    process.disconnect?.();
  }
});
