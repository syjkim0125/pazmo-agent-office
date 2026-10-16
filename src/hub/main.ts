import { startHub, parseListen, parsePublicUrl } from "./run.ts";

function fail(error: unknown): never {
  const code = (error as { code?: unknown } | null)?.code;
  console.error(
    JSON.stringify({
      code: typeof code === "string" ? code : "HUB_START",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
}

/**
 * Container entrypoint: configuration comes only from the environment. Importing this module
 * starts nothing; bin/pazmo-hub.mjs calls main(). Any startup error is reported as JSON and exits 1.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    const publicUrl = parsePublicUrl(env.PAZMO_HUB_PUBLIC_URL ?? "");
    const listen = parseListen(env.PAZMO_HUB_LISTEN || "0.0.0.0:8080");
    const hub = await startHub({
      mode: "proxy",
      publicUrl: publicUrl.origin,
      listenHost: listen.host,
      listenPort: listen.port,
      dataDir: env.PAZMO_HUB_DATA_DIR || "/data",
    });
    console.log(JSON.stringify({ ...hub.result, listening: hub.address() }));
    const shutdown = () => {
      hub.stop().then(
        () => process.exit(0),
        (error) => fail(error),
      );
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    fail(error);
  }
}
