import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('public research, model library and tasks render with honest execution boundaries',async()=>{
 const base=path.resolve(tmpdir()),directory=await mkdtemp(path.join(base,'unified-ocean-ui-'));
 try{
  const outfile=path.join(directory,'fixture.cjs');
  await build({entryPoints:[fileURLToPath(new URL('./unified-ui-fixture.jsx',import.meta.url))],outfile,bundle:true,format:'cjs',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
  const result=spawnSync(process.execPath,[outfile],{encoding:'utf8',timeout:20000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/Unified public workbench UI contracts passed/);
  // Conditional runtime/recovery/alert states are absent from the initial SSR
  // render. Verify their placement in the same component remains outside all
  // native disclosure regions, without introducing a browser or API fixture.
  const source=await readFile(new URL('../src/DialogueWorkbench.jsx',import.meta.url),'utf8');
  const markup=source.slice(source.indexOf('return <div className="dialogue-workbench">'));
  for(const visible of ['<ResearchBudgetRecovery','className="dialogue-runtime"','role="alert"','aria-label="输入问题"','aria-label="发送问题"']){
   const index=markup.indexOf(visible);assert(index>=0,visible);let depth=0;
   for(const tag of markup.slice(0,index).matchAll(/<details\b[^>]*>|<\/details>/g))depth+=tag[0].startsWith('</')?-1:1;
   assert.equal(depth,0,visible+'必须在辅助折叠区外');
  }
 }finally{
  if(path.dirname(directory)!==base||!path.basename(directory).startsWith('unified-ocean-ui-'))throw Error('Unexpected UI test output path');
  await rm(directory,{recursive:true,force:true});
 }
});

test('public shell preserves cloud account/config protocols and excludes local administration',async()=>{
 const main=await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/import DialogueWorkbench from '.\/DialogueWorkbench'/);
 assert.match(main,/useState\("chat"\)/);
 assert.match(main,/AccountProvider/);
 assert.match(main,/ResearchWorkspace/);
 assert.match(main,/ModelPanel/);
 assert.doesNotMatch(main,/MatlabPanel|MascotDock|模型未配置|cfg\.matlab_path/);
 assert(main.indexOf('["project", "项目文件"')>main.indexOf('["workspace", "共享课题"'));
});
