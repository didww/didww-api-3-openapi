import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../.github/scripts/check-document.mjs', import.meta.url));
const VERSION = '2026-10-01';
const doc = (version = VERSION, title = 'DIDWW API v3') => ({ openapi: '3.0.3', info: { title, version }, paths: {} });

// Lays the repository out in a temporary directory and runs the check there, as CI does.
const check = ({ published = doc(), yaml = published, rebuilt = published, version = VERSION, sources = { 'api.json': doc() } } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-document-'));
  try {
    mkdirSync(join(dir, 'openapi', 'sources'), { recursive: true });
    writeFileSync(join(dir, 'VERSION'), `${version}\n`);
    writeFileSync(join(dir, 'openapi', 'v3_api.json'), JSON.stringify(published));
    for (const [file, source] of Object.entries(sources)) writeFileSync(join(dir, 'openapi', 'sources', file), JSON.stringify(source));
    writeFileSync(join(dir, 'yaml.json'), JSON.stringify(yaml));
    writeFileSync(join(dir, 'rebuilt.json'), JSON.stringify(rebuilt));
    return spawnSync(process.execPath, [SCRIPT, 'yaml.json', 'rebuilt.json'], { cwd: dir, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('check-document', () => {
  it('passes a document both formats, VERSION, every source and the build agree on', () => {
    const result = check({ sources: { 'api.json': doc(), 'voice_in.json': doc() } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /version 2026-10-01, built from 2 source\(s\)/);
  });

  it('fails when the two formats differ', () => {
    const result = check({ yaml: doc(VERSION, 'Another title') });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /openapi\/v3_api\.json and openapi\/v3_api\.yaml describe different documents/);
  });

  it('fails when VERSION disagrees with the document', () => {
    const result = check({ version: '2027-01-01' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /VERSION says 2027-01-01, but the document's info\.version is 2026-10-01/);
  });

  it('fails when a source carries another version', () => {
    const result = check({ sources: { 'api.json': doc(), 'voice_in.json': doc('2026-04-16') } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /openapi\/sources\/voice_in\.json carries info\.version 2026-04-16/);
  });

  it('fails when the committed document is not what the build makes of the sources', () => {
    const result = check({ rebuilt: doc(VERSION, 'Rebuilt') });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /openapi\/v3_api\.json is not what scripts\/build\.mjs builds from openapi\/sources\//);
  });
});
