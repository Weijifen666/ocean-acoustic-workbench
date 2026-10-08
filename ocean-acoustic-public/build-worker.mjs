import fs from 'node:fs';import path from 'node:path';import {build} from 'vite';
await build();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon'};
const files={};function walk(dir){for(const name of fs.readdirSync(dir)){const full=path.join(dir,name);if(fs.statSync(full).isDirectory())walk(full);else{files['/'+path.relative('dist',full).replaceAll('\\','/')]={type:mime[path.extname(full)]||'application/octet-stream',data:fs.readFileSync(full).toString('base64')}}}}walk('dist');
const graph=JSON.parse(fs.readFileSync('data/graph.json','utf8')),models=JSON.parse(fs.readFileSync('data/models.json','utf8')),sources=JSON.parse(fs.readFileSync('data/sources.json','utf8'));
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('dist/server/index.js',fs.readFileSync('worker.mjs','utf8').replace("import {FILES,GRAPH,MODELS,SOURCES} from './generated-assets.mjs';",`const FILES=${JSON.stringify(files)};const GRAPH=${JSON.stringify(graph)};const MODELS=${JSON.stringify(models)};const SOURCES=${JSON.stringify(sources)};`));
console.log('Cloud worker built:',Object.keys(files).length,'assets,',fs.statSync('dist/server/index.js').size,'bytes');
