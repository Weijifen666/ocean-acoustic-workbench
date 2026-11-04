import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('real public workbench recovers ambiguous sends without duplicate requests or blind step retries',async()=>{
 const base=path.resolve(tmpdir()),directory=await mkdtemp(path.join(base,'ocean-chat-recovery-'));
 try{
  const outfile=path.join(directory,'fixture.cjs');
  await build({entryPoints:[fileURLToPath(new URL('./chat-recovery-fixture.jsx',import.meta.url))],outfile,bundle:true,format:'cjs',platform:'node',
   alias:Object.fromEntries(['react','react-dom','lucide-react','react-test-renderer'].map(name=>[name,fileURLToPath(new URL('../node_modules/'+name,import.meta.url))])),
   nodePaths:[fileURLToPath(new URL('../node_modules',import.meta.url))],loader:{'.css':'empty'},logLevel:'silent'});
  const result=spawnSync(process.execPath,[outfile],{encoding:'utf8',timeout:25000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/Public chat recovery: 9 scenarios passed/);
 }finally{
  if(path.dirname(directory)!==base||!path.basename(directory).startsWith('ocean-chat-recovery-'))throw Error('Unexpected recovery test output path');
  await rm(directory,{recursive:true,force:true});
 }
});
