import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

test('both actual image galleries preserve provenance and block unloaded lightboxes',async()=>{
 const base=path.resolve(tmpdir()),directory=await mkdtemp(path.join(base,'graph-image-ui-'));
 try{
  const outfile=path.join(directory,'fixture.cjs');
  await build({entryPoints:[fileURLToPath(new URL('./resource-image-fixture.jsx',import.meta.url))],outfile,bundle:true,format:'cjs',platform:'node',alias:{react:fileURLToPath(new URL('../node_modules/react',import.meta.url))},loader:{'.css':'empty'},logLevel:'silent'});
  const result=spawnSync(process.execPath,[outfile],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/Both galleries retain missing provenance/);
 }finally{
  if(path.dirname(directory)!==base||!path.basename(directory).startsWith('graph-image-ui-'))throw Error('Unexpected image test temporary directory');
  await rm(directory,{recursive:true,force:true});
 }
});
