import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

// Evaluate the actual upstream module without loading runtime configuration,
// user .env files, dependencies, or any provider/network service.
const source = await readFile(new URL('../vendor/claw-empire/server/oauth/helpers.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source);

async function loadHelpers(env) {
  const context = vm.createContext({ process: { env }, Buffer, URL });
  const helpers = new vm.SourceTextModule(code, { context });
  await helpers.link((specifier) => {
    if (specifier === 'node:crypto') {
      const names = ['createCipheriv', 'createDecipheriv', 'createHash', 'randomBytes'];
      return new vm.SyntheticModule(names, function () {
        for (const name of names) this.setExport(name, crypto[name]);
      }, { context });
    }
    if (specifier === '../config/runtime.ts') {
      return new vm.SyntheticModule(['OAUTH_BASE_HOST', 'PORT'], function () {
        this.setExport('OAUTH_BASE_HOST', '127.0.0.1');
        this.setExport('PORT', 8790);
      }, { context });
    }
    throw new Error(`Unexpected import: ${specifier}`);
  });
  await helpers.evaluate();
  return helpers.namespace;
}

test('Google credentials are absent when environment variables are unset', async () => {
  const helpers = await loadHelpers({});
  // Avoid printing a credential if the unmodified upstream fails this test.
  assert.ok(helpers.BUILTIN_GOOGLE_CLIENT_ID === '', 'Google client ID must have no built-in fallback');
  assert.ok(helpers.BUILTIN_GOOGLE_CLIENT_SECRET === '', 'Google client secret must have no built-in fallback');
});

test('explicit Google and GitHub configuration is preserved', async () => {
  const helpers = await loadHelpers({
    OAUTH_GOOGLE_CLIENT_ID: 'test-client-id',
    OAUTH_GOOGLE_CLIENT_SECRET: 'test-client-secret',
    OAUTH_GITHUB_CLIENT_ID: 'test-github-id',
  });
  assert.equal(helpers.BUILTIN_GOOGLE_CLIENT_ID, 'test-client-id');
  assert.equal(helpers.BUILTIN_GOOGLE_CLIENT_SECRET, 'test-client-secret');
  assert.equal(helpers.BUILTIN_GITHUB_CLIENT_ID, 'test-github-id');
});

test('explicit empty Google configuration does not select a fallback', async () => {
  const helpers = await loadHelpers({ OAUTH_GOOGLE_CLIENT_ID: '', OAUTH_GOOGLE_CLIENT_SECRET: '' });
  assert.ok(helpers.BUILTIN_GOOGLE_CLIENT_ID === '', 'Empty client ID must stay empty');
  assert.ok(helpers.BUILTIN_GOOGLE_CLIENT_SECRET === '', 'Empty client secret must stay empty');
});
