import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  init,
  locate,
  remove,
  OfficeError,
  fail,
  packageRoot,
  readManifest,
} from "./project.ts";
import { start, status, stop, operatorRequest } from "./lifecycle.ts";

export async function main(args: string[]): Promise<void> {
  try {
    const command = args.shift();
    if (command === "--help" || command === "help" || !command) {
      console.log(
        "pazmo-office <init|doctor|start|status|stop|remove|contracts|contract|verification|delivery|deliver|intake-create|intake|intake-answer|intake-cancel|approval-request|approval-decide> --project PATH [--data-dir PATH] [--apply|--dry-run] [--port N] [--file JSON] [--task-id ID] [--gate G1|G3|G4] [--challenge ID]",
      );
      return;
    }
    if (command === "--version") {
      console.log("0.1.0-alpha.1");
      return;
    }
    if (
      ![
        "init",
        "doctor",
        "start",
        "status",
        "stop",
        "remove",
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
      ].includes(command)
    )
      fail("ARGUMENT", "Unknown command.");
    const options: Record<string, string | boolean> = {};
    while (args.length) {
      const flag = args.shift()!;
      if (
        ![
          "--project",
          "--data-dir",
          "--apply",
          "--dry-run",
          "--port",
          "--file",
          "--task-id",
          "--gate",
          "--challenge",
        ].includes(flag) ||
        flag in options
      )
        fail("ARGUMENT", `Unknown or repeated option: ${flag}`);
      if (flag === "--apply" || flag === "--dry-run") options[flag] = true;
      else {
        const value = args.shift();
        if (!value || value.startsWith("--"))
          fail("ARGUMENT", `Missing value: ${flag}`);
        options[flag] = value;
      }
    }
    if (options["--apply"] && options["--dry-run"])
      fail("ARGUMENT", "Choose either apply or dry-run.");
    if (
      (options["--apply"] || options["--dry-run"]) &&
      !["init", "remove"].includes(command)
    )
      fail(
        "ARGUMENT",
        "Apply and dry-run are only supported by init and remove.",
      );
    if (options["--port"] !== undefined && command !== "start")
      fail("ARGUMENT", "Port is only supported by start.");
    const allowed: Record<string, string[]> = {
      "--file": [
        "contract",
        "approval-decide",
        "intake-create",
        "intake-answer",
        "intake-cancel",
      ],
      "--task-id": [
        "contract",
        "approval-request",
        "verification",
        "delivery",
        "deliver",
        "intake",
        "intake-answer",
        "intake-cancel",
      ],
      "--gate": ["approval-request"],
      "--challenge": ["approval-decide"],
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
    const inputJSON = (): unknown => {
      const file = required("--file");
      const stat = statSync(file);
      if (!stat.isFile() || stat.size > 65536)
        fail(
          "ARGUMENT",
          "JSON input must be a regular file of at most 64 KiB.",
        );
      return JSON.parse(readFileSync(file, "utf8"));
    };
    if (typeof options["--project"] !== "string")
      fail("ARGUMENT", "--project is required.");
    const p = locate(
      options["--project"],
      options["--data-dir"] as string | undefined,
    );
    const apply = options["--apply"] === true;
    let result: unknown;
    if (command === "intake-create")
      result = await operatorRequest(p, "/api/pazmo/intakes", inputJSON());
    else if (command === "intake")
      result = await operatorRequest(
        p,
        `/api/pazmo/intakes/${encodeURIComponent(required("--task-id"))}`,
      );
    else if (command === "intake-answer" || command === "intake-cancel")
      result = await operatorRequest(
        p,
        `/api/pazmo/intakes/${encodeURIComponent(required("--task-id"))}/${command === "intake-answer" ? "answer" : "cancel"}`,
        inputJSON(),
      );
    else if (command === "contracts")
      result = await operatorRequest(p, "/api/pazmo/contracts");
    else if (command === "delivery")
      result = await operatorRequest(
        p,
        `/api/pazmo/deliveries/${encodeURIComponent(required("--task-id"))}`,
      );
    else if (command === "deliver")
      result = await operatorRequest(p, "/api/pazmo/deliveries", {
        taskId: required("--task-id"),
      });
    else if (command === "verification")
      result = await operatorRequest(
        p,
        `/api/pazmo/verification/${encodeURIComponent(required("--task-id"))}`,
      );
    else if (command === "contract")
      result = await operatorRequest(p, "/api/pazmo/contracts", {
        input: inputJSON(),
        taskId: options["--task-id"],
      });
    else if (command === "approval-request")
      result = await operatorRequest(p, "/api/pazmo/approvals/request", {
        taskId: required("--task-id"),
        gate: required("--gate"),
      });
    else if (command === "approval-decide")
      result = await operatorRequest(p, "/api/pazmo/approvals/decide", {
        id: required("--challenge"),
        answer: inputJSON(),
      });
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
        uiBuilt: existsSync(
          join(packageRoot, "vendor/claw-empire/dist/index.html"),
        ),
        execution: "locked",
        reason: "Isolation and completion guards are not yet verified.",
      };
    } else if (command === "status") result = await status(p);
    else if (command === "stop") result = await stop(p);
    else {
      const rawPort = options["--port"] ?? "8790";
      if (
        typeof rawPort !== "string" ||
        !/^\d+$/.test(rawPort) ||
        Number(rawPort) > 65535
      )
        fail("ARGUMENT", "Port must be an integer from 0 to 65535.");
      result = await start(p, Number(rawPort));
    }
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
