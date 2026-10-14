import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchAgent } from '../src/installer.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('login service plist preserves paths containing XML metacharacters', () => {
  const xml = launchAgent({ node: '/node & tools/node', script: '/project <one>/bridge.js', host: '100.1.2.3', log: '/tmp/mirror.log' });
  assert.match(xml, /node &amp; tools/);
  assert.match(xml, /project &lt;one&gt;/);
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(xml, /<key>MIRROR_LOCAL_ONLY<\/key><string>1<\/string>/);
  assert.match(xml, /<key>MIRROR_NAME<\/key><string>iPhone<\/string>/);
  if (process.platform === 'darwin') {
    const dir = mkdtempSync(path.join(tmpdir(), 'mirror-test-'));
    try {
      const file = path.join(dir, 'agent.plist'); writeFileSync(file, xml);
      const result = spawnSync('/usr/bin/plutil', ['-lint', file], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally { rmSync(dir, { recursive: true }); }
  }
});
