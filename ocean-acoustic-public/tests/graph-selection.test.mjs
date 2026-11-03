import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';

test('actual graph selection component and request helper preserve explicit context and clear it',async()=>{
 const base=path.resolve(tmpdir()),directory=await mkdtemp(path.join(base,'graph-context-ui-'));
 try{
  const outfile=path.join(directory,'fixture.cjs');
  await build({entryPoints:[fileURLToPath(new URL('./graph-selection-fixture.jsx',import.meta.url))],outfile,bundle:true,format:'cjs',platform:'node',
   alias:Object.fromEntries(['react','react-dom','lucide-react'].map(name=>[name,fileURLToPath(new URL('../node_modules/'+name,import.meta.url))])),
   nodePaths:[fileURLToPath(new URL('../node_modules',import.meta.url))],loader:{'.css':'empty'},logLevel:'silent'});
  const result=spawnSync(process.execPath,[outfile],{encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/Graph selection display, removal, clear and request context passed/);
 }finally{
  if(path.dirname(directory)!==base||!path.basename(directory).startsWith('graph-context-ui-'))throw Error('Unexpected UI test temporary directory');
  await rm(directory,{recursive:true,force:true});
 }
});
