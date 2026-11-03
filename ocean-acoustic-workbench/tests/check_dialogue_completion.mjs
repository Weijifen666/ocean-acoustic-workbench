// Exercise both real workbench components with React effects and controlled HTTP.
// No provider, database, MATLAB or browser connection is used.
import {build} from 'esbuild';
import {existsSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..'),repository=resolve(root,'..');
const renderer=[resolve(root,'node_modules/react-test-renderer'),resolve(root,'.local/validation/chat-lifecycle/node_modules/react-test-renderer')].find(path=>existsSync(resolve(path,'package.json')));
if(!renderer)throw Error('Install this package devDependencies; react-test-renderer must match the installed React version.');
const requested=process.argv.slice(2);
if(requested.some(value=>!['--local','--public'].includes(value)))throw Error('Supported options: --local, --public (default: both).');
const variants=[['local',root],['public',resolve(repository,'ocean-acoustic-public')]].filter(([name])=>!requested.length||requested.includes('--'+name));
const output=resolve(root,'.local/validation');mkdirSync(output,{recursive:true});
let failed=false;
for(const [name,app] of variants){
 const out=resolve(output,'dialogue-completion-'+name+'.cjs');
 await build({entryPoints:[resolve(import.meta.dirname,'fixtures/dialogue_completion.jsx')],bundle:true,platform:'node',format:'cjs',outfile:out,
  define:{__PUBLIC_WORKBENCH__:JSON.stringify(name==='public')},
  alias:{react:resolve(root,'node_modules/react'),'react-test-renderer':renderer,
   '@workbench-under-test':resolve(app,'src/DialogueWorkbench.jsx'),
   '@knowledge-selection-under-test':resolve(app,'src/knowledgeSelection.js')},
  loader:{'.css':'empty'},logLevel:'error'});
 const result=spawnSync(process.execPath,[out],{encoding:'utf8',timeout:20000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 if(result.error)console.error(result.error.message);
 if(result.status!==0)failed=true;
}
process.exitCode=failed?1:0;
