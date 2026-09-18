#!/usr/bin/env node

/**
 * Claw-Empire setup script
 *
 * Prepends CEO directive + orchestration rules to the user's AGENTS.md.
 * This is an UPDATE, not an OVERWRITE — existing content is preserved.
 *
 * Usage:
 *   node scripts/setup.mjs [--agents-path /path/to/AGENTS.md] [--port 8790]
 *   pnpm setup [-- --agents-path /path/to/AGENTS.md --port 8790]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "..", "templates", "AGENTS-empire.md");
const START_MARKER = "<!-- BEGIN claw-empire orchestration rules -->";
const END_MARKER = "<!-- END claw-empire orchestration rules -->";

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { agentsPath: null, port: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agents-path" && args[i + 1]) {
      result.agentsPath = path.resolve(args[++i]);
    } else if (args[i] === "--port" && args[i + 1]) {
      result.port = args[++i];
    }
  }
  return result;
}

function detectPort() {
  // 1. CLI arg (handled by caller)
  // 2. .env file in project root
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    const match = envContent.match(/^PORT\s*=\s*(\d+)/m);
    if (match) return match[1];
  }
  // 3. Default
  return "8790";
}

function resolveWorkspaceDir() {
  // Try reading workspace from openclaw.json
  const openclawJson = path.join(os.homedir(), ".openclaw", "openclaw.json");
  if (fs.existsSync(openclawJson)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(openclawJson, "utf8"));
      const w = cfg?.agents?.defaults?.workspace?.trim();
      if (w) {
        const resolved = w.replace(/^~/, os.homedir());
        if (fs.existsSync(resolved)) return resolved;
      }
    } catch {
      /* ignore */
    }
  }

  // Check OPENCLAW_PROFILE
  const profile = process.env.OPENCLAW_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    const profdir = path.join(os.homedir(), ".openclaw", `workspace-${profile}`);
    if (fs.existsSync(profdir)) return profdir;
  }

  return path.join(os.homedir(), ".openclaw", "workspace");
}

function findAgentsPath() {
  const projectAgentsPath = path.join(process.cwd(), "AGENTS.md");
  // Default target: current project root (claw-empire users first).
  // OpenClaw workspace targeting should be explicit via --agents-path.
  return projectAgentsPath;
}

function main() {
  const args = parseArgs();
  const agentsPath = args.agentsPath || findAgentsPath();
  const port = args.port || detectPort();

  let templateContent = fs.readFileSync(TEMPLATE_PATH, "utf8");
  templateContent = templateContent.replace(/__PORT__/g, port);

  console.log(`[Claw-Empire] Setting up orchestration rules`);
  console.log(`[Claw-Empire] Target: ${agentsPath}`);
  console.log(`[Claw-Empire] Port: ${port}`);

  // Read existing content
  let existingContent = "";
  if (fs.existsSync(agentsPath)) {
    existingContent = fs.readFileSync(agentsPath, "utf8");
  }

  // Check if already installed — offer update
  if (existingContent.includes(START_MARKER) && existingContent.includes(END_MARKER)) {
    const startIdx = existingContent.indexOf(START_MARKER);
    const endIdx = existingContent.indexOf(END_MARKER) + END_MARKER.length;
    const before = existingContent.slice(0, startIdx);
    const after = existingContent.slice(endIdx);
    const newContent = before + templateContent + after;
    fs.writeFileSync(agentsPath, newContent, "utf8");
    console.log(`[Claw-Empire] Updated existing orchestration rules in ${agentsPath}`);
    console.log(`[Claw-Empire] Done!`);
    return;
  }

  // Prepend template to existing content
  const newContent = templateContent + "\n\n" + existingContent;

  // Ensure parent directory exists
  const dir = path.dirname(agentsPath);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(agentsPath, newContent, "utf8");
  console.log(`[Claw-Empire] Orchestration rules added to top of ${agentsPath}`);
  console.log(`[Claw-Empire] Your existing AGENTS.md content is preserved below.`);
  console.log(`[Claw-Empire] Done!`);
}

main();
