import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import DialogueWorkbench, {advanceResearchRun} from '../src/DialogueWorkbench';
import Simulation from '../src/SimulationStudio';
import Jobs from '../src/StudioResults';
import {publicCapabilities, researchRounds} from '../src/cloudWorkbench';
import {projectCategory, projectCategories} from '../src/projectFiles';
import ChatMessage from '../src/ChatMessage';

globalThis.localStorage = {getItem: () => null, setItem() {}, removeItem() {}};
const noOp = () => {};
const dialogue = renderToStaticMarkup(<DialogueWorkbench openSettings={noOp}/>);
assert.match(dialogue, /对话工作台/);
assert.match(dialogue, /<option value="api" selected="">/);
assert.match(dialogue, /<option value="dsh" disabled="">/);
assert.match(dialogue, /<option value="codex" disabled="">/);
assert.match(dialogue, /aria-label="Agent工具轮数"[^>]*value="40"/);
assert.match(dialogue, /导出聊天/);
assert.match(dialogue, /不执行任意 Python \/ MATLAB 脚本/);
assert.equal(researchRounds('', 1000), 40);
assert.equal(researchRounds(1001, 1000), 40);
assert.equal(researchRounds(0, 1000), 0);
const math = renderToStaticMarkup(<ChatMessage text={'\\[TL=-20\\log_{10}|p|\\]'} />);
assert.match(math, /class="katex/);
assert.doesNotMatch(math, /katex-error/);

const simulation = renderToStaticMarkup(<Simulation onAsk={noOp} capabilities={publicCapabilities}/>);
assert.match(simulation, /模型与使用经验/);
for (const model of ['KRAKEN', 'KRAKENC', 'SCOOTER', 'BELLHOP', 'RAM', 'SimplePE', 'SPARC', 'BELLHOP3D', 'KRAKEL']) assert(simulation.includes(model), model);
assert.match(simulation, /计算节点未连接/);
assert.match(simulation, /<button[^>]*disabled=""[^>]*>[^]*?检查并生成计划/);
assert.doesNotMatch(simulation, /MatlabPanel/);
const task = {id:'abcdef123456',state:'SUCCEEDED',created:'2026-11-01T00:00:00Z',plan:{kind:'research',title:'温盐诊断',objective:'读取实际数据'},summary:null,log:'done',artifacts:[]};
const jobs = renderToStaticMarkup(<Jobs initialJobs={[task]} initialDetail={task} capabilities={publicCapabilities} notify={noOp} onResearch={noOp} onImportChat={noOp}/>);
assert.match(jobs, /删除任务文件/);
assert.match(jobs, /导入对话工作台/);
assert.doesNotMatch(jobs, /打开文件所在位置|暂停领取|继续队列/);
assert.match(jobs, /<button[^>]*disabled=""[^>]*>[^]*?删除任务文件/);
assert.equal(projectCategories.length, 5);
assert.equal(projectCategory({path:'@project/at/tests/pekeris.env'}),'inputs');
assert.equal(projectCategory({path:'@workbench/tests/check.py'}),'tests');

async function verifySteps(){
const requests=[];
globalThis.fetch = async (url,options={}) => {requests.push([url,options.method||'GET']);return Response.json({id:'run-1',state:'running'});};
await advanceResearchRun('run-1','poll_steps');
assert.deepEqual(requests,[['/api/research/runs/run-1/step','POST'],['/api/research/runs/run-1','GET']]);
requests.length=0;
await advanceResearchRun('run-1','background');
assert.deepEqual(requests,[['/api/research/runs/run-1','GET']]);
console.log('Unified public workbench UI contracts passed.');
}
verifySteps().catch(error=>{console.error(error);process.exitCode=1});
