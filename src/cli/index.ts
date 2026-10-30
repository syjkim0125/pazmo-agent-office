import { join } from "node:path";
import { homedir } from "node:os";
import {
  dataRoot,
  init,
  locate,
  remove,
  OfficeError,
  fail,
  readManifest,
} from "./project.ts";
import type { LiveConfig } from "../runtime/live.ts";
import { up } from "./launcher.ts";
import { TEAM_ACTIONS, teamCommand } from "./team.ts";
import { setupRuntime, installedRuntime } from "./runtime-setup.ts";
import { runHub, linkOffice, linkOfficeWithConnection, unlinkOffice } from "./hub.ts";
import { parseListen, parsePublicUrl } from "../hub/run.ts";
import {
  dependenciesInstalled,
  start,
  status,
  stop,
  monitor,
  startTeam,
  statusTeam,
  stopTeam,
  NO_TEAM_SCREEN,
} from "./lifecycle.ts";

/** Commands of the legacy engine's operator API, removed with it (D30): named
 * on refusal so a stale script or chat host learns why. */
const REMOVED_COMMANDS = [
  "bridge",
  "operator-key",
  "contracts",
  "contract",
  "verification",
  "delivery",
  "deliver",
  "approval-request",
  "approval-decide",
  "intake-create",
  "intake",
  "intake-answer",
  "intake-cancel",
  "intake-publish",
];

export async function main(args: string[]): Promise<void> {
  try {
    const command = args.shift();
    if (command === "--help" || command === "help" || !command) {
      console.log(
        "pazmo-office <up|setup-runtime|monitor|hub|hub-link|hub-unlink|team|init|doctor|start|status|stop|remove> --project PATH [--data-dir PATH] [--apply|--dry-run] [--port N]\nOffice: up [--project PATH] [--no-open] (what ./office runs: checks the dependencies, VM and runner login, then opens the Office) or start --project PATH [--live] [--port N]; the Office has Tasks, task detail, Decisions and Agents on 127.0.0.1 (--lean is accepted and means the same)\nSetup: setup-runtime [--data-dir PATH] [--apply]\nLive startup: start --live --project PATH [--data-dir PATH] (optional paired --controller/--executor overrides)\nTeam Office repos: team add --project PATH [--data-dir PATH]; team remove --project PATH [--data-dir PATH]; team list [--data-dir PATH] (a registered repo cannot be started as a single Office)\nTeam Office settings: team pause|resume|status [--data-dir PATH]; team cap <1-100|off> [--data-dir PATH] (daily cap on new Story Tasks, default 5; works while the Office is stopped)\nTeam Office: start --team [--live] [--port N] [--data-dir PATH] or up --team [--data-dir PATH] (one Office for every registered repo; no --project, not combinable with --lean); status --team; stop --team (no screen yet: monitor --team is unsupported)",
      );
      return;
    }
    if (REMOVED_COMMANDS.includes(command))
      fail(
        "COMMAND_REMOVED",
        `${command} was removed with the chat bridge and the legacy engine (D30). Use the Office screen (./office); see docs/CHAT-CONTROL.md.`,
      );
    if (command === "--version") {
      console.log("0.1.0-alpha.1");
      return;
    }
    if (
      ![
        "up",
        "setup-runtime",
        "monitor",
        "hub",
        "hub-link",
        "hub-unlink",
        "team",
        "init",
        "doctor",
        "start",
        "status",
        "stop",
        "remove",
      ].includes(command)
    )
      fail("ARGUMENT", "Unknown command.");
    // `team` takes its action before the flags: team add|remove|list|pause|resume|cap|status.
    const teamAction = command === "team" ? args.shift() : undefined;
    if (command === "team" && !TEAM_ACTIONS.includes(teamAction ?? ""))
      fail(
        "ARGUMENT",
        "team needs an action: add, remove, list, pause, resume, cap or status.",
      );
    // `team cap` also takes its value, N or off, before the flags.
    const teamValue =
      teamAction === "cap" && args[0] !== undefined && !args[0].startsWith("--")
        ? args.shift()
        : undefined;
    const options: Record<string, string | boolean> = {};
    while (args.length) {
      const flag = args.shift()!;
      if (
        ![
          "--no-open",
          "--project",
          "--data-dir",
          "--apply",
          "--dry-run",
          "--port",
          "--live",
          "--claw",
          "--lean",
          "--team",
          "--controller",
          "--executor",
          "--codex-runtime",
          "--host",
          "--name",
          "--hub",
          "--code",
          "--fingerprint",
          "--connect",
          "--public-url",
          "--listen",
        ].includes(flag) ||
        flag in options
      )
        fail("ARGUMENT", `Unknown or repeated option: ${flag}`);
      if (
        flag === "--no-open" ||
        flag === "--apply" ||
        flag === "--dry-run" ||
        flag === "--live" ||
        flag === "--claw" ||
        flag === "--lean" ||
        flag === "--team"
      )
        options[flag] = true;
      else {
        const value = args.shift();
        if (!value || value.startsWith("--"))
          fail("ARGUMENT", `Missing value: ${flag}`);
        options[flag] = value;
      }
    }
    // The Claw Office was removed (D30): say so before any other check.
    if (options["--claw"])
      fail(
        "CLAW_REMOVED",
        "The Claw Office was removed. Start the Office with ./office (or start).",
      );
    if (options["--apply"] && options["--dry-run"])
      fail("ARGUMENT", "Choose either apply or dry-run.");
    if (
      (options["--apply"] || options["--dry-run"]) &&
      !["init", "remove", "setup-runtime"].includes(command)
    )
      fail(
        "ARGUMENT",
        "Apply and dry-run are only supported by init, remove and setup-runtime.",
      );
    if (options["--port"] !== undefined && !["start", "up", "hub"].includes(command))
      fail("ARGUMENT", "Port is only supported by start, up and hub.");
    const codexRuntime = options["--codex-runtime"] as "installed" | "pinned" | undefined;
    if (codexRuntime !== undefined && !["start", "up"].includes(command))
      fail("ARGUMENT", "--codex-runtime is only supported by start and up.");
    if (codexRuntime !== undefined && !["installed", "pinned"].includes(codexRuntime))
      fail("ARGUMENT", "--codex-runtime must be installed or pinned.");
    if (options["--lean"] && !["start", "up"].includes(command))
      fail("ARGUMENT", "--lean is only supported by start and up.");
    // The team Office runs every registered repo: it names no project and has
    // its own engine.
    if (options["--team"]) {
      if (!["start", "up", "status", "stop", "monitor"].includes(command))
        fail("ARGUMENT", "--team is only supported by start, up, status, stop and monitor.");
      if (options["--project"] !== undefined)
        fail("ARGUMENT", "--team runs every registered repo; omit --project (see team add).");
      if (options["--lean"])
        fail("ARGUMENT", "--team cannot be combined with --lean.");
    }
    if (
      ["--live", "--controller", "--executor"].some(
        (key) => options[key] !== undefined,
      ) &&
      command !== "start"
    )
      fail("ARGUMENT", "Live runtime options are only supported by start.");
    if (
      (options["--controller"] || options["--executor"]) &&
      !options["--live"]
    )
      fail("ARGUMENT", "Use --live with both qualified runtime binaries.");
    const allowed: Record<string, string[]> = {
      "--host": ["hub"],
      "--name": ["hub"],
      "--public-url": ["hub"],
      "--listen": ["hub"],
      "--hub": ["hub-link"],
      "--code": ["hub-link"],
      "--fingerprint": ["hub-link"],
      "--connect": ["hub-link"],
    };
    for (const [flag, commands] of Object.entries(allowed))
      if (options[flag] !== undefined && !commands.includes(command))
        fail("ARGUMENT", `${flag} is not supported by ${command}.`);
    const required = (flag: string): string => {
      const value = options[flag];
      if (typeof value !== "string")
        return fail("ARGUMENT", `${flag} is required.`);
      return value;
    };
    if (options["--no-open"] && command !== "up")
      fail("ARGUMENT", "--no-open is only supported by up.");
    if (command === "up") {
      const rawPort = options["--port"];
      if (
        rawPort !== undefined &&
        (typeof rawPort !== "string" ||
          !/^\d+$/.test(rawPort) ||
          Number(rawPort) > 65535)
      )
        fail("ARGUMENT", "Port must be an integer from 0 to 65535.");
      console.log(
        JSON.stringify(
          await up({
            project: options["--project"] as string | undefined,
            dataDir: options["--data-dir"] as string | undefined,
            port: rawPort === undefined ? undefined : Number(rawPort),
            open: !options["--no-open"],
            ...(options["--team"] ? { engine: "team" as const } : {}),
            ...(codexRuntime ? { codexRuntime } : {}),
          }),
        ),
      );
      return;
    }
    if (command === "team") {
      console.log(
        JSON.stringify(
          await teamCommand(teamAction!, {
            project: options["--project"] as string | undefined,
            dataDir: options["--data-dir"] as string | undefined,
            value: teamValue,
          }),
        ),
      );
      return;
    }
    if (command === "hub") {
      if (options["--project"]) fail("ARGUMENT", "hub serves the whole team; omit --project.");
      const publicUrl = options["--public-url"];
      if (publicUrl !== undefined) {
        if (options["--host"] !== undefined || options["--name"] !== undefined || options["--port"] !== undefined)
          fail("ARGUMENT", "--public-url은 --host·--name·--port와 함께 쓸 수 없습니다.");
        if (typeof options["--listen"] !== "string")
          fail("ARGUMENT", "--public-url에는 --listen <IP>:<포트>가 필요합니다.");
        const listen = parseListen(options["--listen"]);
        console.log(JSON.stringify(await runHub({
          mode: "proxy",
          publicUrl: parsePublicUrl(publicUrl as string).origin,
          listenHost: listen.host,
          listenPort: listen.port,
          dataDir: options["--data-dir"] as string | undefined,
        })));
        return;
      }
      if (options["--listen"] !== undefined)
        fail("ARGUMENT", "--listen은 --public-url과 함께만 쓸 수 있습니다.");
      const rawPort = options["--port"] ?? "8443";
      if (typeof rawPort !== "string" || !/^\d+$/.test(rawPort) || Number(rawPort) > 65535)
        fail("ARGUMENT", "Port must be an integer from 0 to 65535.");
      console.log(JSON.stringify(await runHub({
        mode: "lan",
        host: required("--host"),
        name: options["--name"] as string | undefined,
        port: Number(rawPort),
        dataDir: options["--data-dir"] as string | undefined,
      })));
      return;
    }
    if (command === "setup-runtime") {
      if (options["--project"])
        fail(
          "ARGUMENT",
          "setup-runtime prepares the shared runtime; omit --project.",
        );
      console.log(
        JSON.stringify(
          await setupRuntime(
            options["--data-dir"] as string | undefined,
            options["--apply"] === true,
          ),
        ),
      );
      return;
    }
    /** start's port; `fallback` when none is given. */
    const startPort = (fallback: string): number => {
      const rawPort = options["--port"] ?? fallback;
      if (
        typeof rawPort !== "string" ||
        !/^\d+$/.test(rawPort) ||
        Number(rawPort) > 65535
      )
        fail("ARGUMENT", "Port must be an integer from 0 to 65535.");
      return Number(rawPort);
    };
    /** start --live's runtime: the paired overrides, or the installed one. */
    const startLive = (): LiveConfig | undefined => {
      if (!options["--live"]) return undefined;
      const binaries =
        options["--controller"] || options["--executor"]
          ? {
              controller: required("--controller"),
              binary: required("--executor"),
            }
          : installedRuntime(options["--data-dir"] as string | undefined);
      return {
        controller: binaries.controller,
        binary: binaries.binary,
        authHome: join(homedir(), ".codex"),
        socket: join(homedir(), ".colima/pazmo-office/docker.sock"),
        userHome: homedir(),
        searchPath: process.env.PATH ?? "",
        ...(codexRuntime ? { codexRuntime } : {}),
      };
    };
    if (options["--team"]) {
      // monitor needs nothing else: there is no team screen to open.
      if (command === "monitor") fail(...NO_TEAM_SCREEN);
      const root = dataRoot(options["--data-dir"] as string | undefined);
      console.log(
        JSON.stringify(
          command === "status"
            ? await statusTeam(root)
            : command === "stop"
              ? await stopTeam(root)
              : // No page to bookmark: any free port unless one is given.
                await startTeam(root, startPort("0"), startLive()),
        ),
      );
      return;
    }
    if (typeof options["--project"] !== "string")
      fail("ARGUMENT", "--project is required.");
    const p = locate(
      options["--project"],
      options["--data-dir"] as string | undefined,
    );
    const apply = options["--apply"] === true;
    let result: unknown;
    if (command === "monitor") result = await monitor(p);
    else if (command === "hub-link" && options["--connect"] !== undefined) {
      if (options["--hub"] !== undefined || options["--code"] !== undefined || options["--fingerprint"] !== undefined)
        fail("ARGUMENT", "--connect는 --hub·--code·--fingerprint와 함께 쓸 수 없습니다.");
      result = await linkOfficeWithConnection(p, required("--connect"));
    } else if (command === "hub-link")
      result = await linkOffice(p, required("--hub"), required("--code"), (options["--fingerprint"] as string | undefined) ?? null);
    else if (command === "hub-unlink") result = unlinkOffice(p);
    else if (command === "init") result = init(p, apply);
    else if (command === "remove") {
      if (apply && (await status(p)).status !== "stopped")
        fail(
          "RUNNING",
          "Stop or recover the Office before removing project metadata.",
        );
      result = remove(p, apply);
    } else if (command === "doctor") {
      readManifest(p);
      result = {
        node: process.version,
        initialized: true,
        dependencies: dependenciesInstalled(),
        execution: "locked",
        reason:
          "Doctor checks installation only. Use start --live and runtime readiness for model execution.",
      };
    } else if (command === "status") result = await status(p);
    else if (command === "stop") result = await stop(p);
    else
      result = await start(p, startPort("8790"), startLive());
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      JSON.stringify({
        code: error instanceof OfficeError ? error.code : "FAILED",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  }
}
