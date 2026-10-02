#!/usr/bin/env node
// Installed alongside check.mjs; imports resolve inside .ai-workflow, without npm.
import { runGraphCommand } from '../graph/cli.mjs';
import { checkArtifact, checkGate } from './check.mjs';
try {
  console.log(JSON.stringify(await runGraphCommand(process.argv.slice(2), { checkArtifact, checkGate }), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
