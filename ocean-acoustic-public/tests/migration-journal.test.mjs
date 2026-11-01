import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup} from './test-support.mjs';
test('production migration journal covers every SQL file and creates the research tables',()=>{
 const root=new URL('../drizzle/',import.meta.url),journal=JSON.parse(fs.readFileSync(new URL('meta/_journal.json',root),'utf8'));
 const actual=fs.readdirSync(root).filter(name=>name.endsWith('.sql')).sort();
 assert.deepEqual(journal.entries.map(e=>e.tag+'.sql').sort(),actual);
 const state=setup();try{assert(state.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='cloud_research_runs'").get());assert(state.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='research_owner_active'").get());}finally{state.sqlite.close();}
});
