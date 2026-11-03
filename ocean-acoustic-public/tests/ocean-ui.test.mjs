import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('shared ocean UI preserves cloud privacy, accurate status and export columns', async () => {
  const base = path.resolve(tmpdir()), directory = await mkdtemp(path.join(base, 'ocean-ui-'));
  try {
    const outfile = path.join(directory, 'ocean-ui.cjs');
    // Match production Vite's React deduplication for components shared from
    // the local workspace, rather than bundling a second hook dispatcher.
    await build({entryPoints: [fileURLToPath(new URL('./ocean-ui-fixture.jsx', import.meta.url))], outfile, bundle: true, platform: 'node', format: 'cjs', alias: {react: fileURLToPath(new URL('../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../node_modules/react-dom', import.meta.url))}, nodePaths: [fileURLToPath(new URL('../node_modules', import.meta.url))], loader: {'.css': 'empty'}, logLevel: 'silent'});
    const result = spawnSync(process.execPath, [outfile], {encoding: 'utf8', timeout: 20000, windowsHide: true});
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Ocean UI contracts passed/);
  } finally {
    if (path.dirname(path.resolve(directory)) !== base || !path.basename(directory).startsWith('ocean-ui-')) throw Error('Unexpected ocean UI test output path.');
    await rm(directory, {recursive: true, force: true});
  }
});
