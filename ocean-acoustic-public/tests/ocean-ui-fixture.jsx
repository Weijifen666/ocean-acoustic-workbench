import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OceanSource, ProfileResult, profileCsv, profileSimulationDraft, OceanPointSummary, scrollToOceanProfile} from '../../ocean-acoustic-workbench/src/OceanData';
import OceanMap, {oceanDataQuery, handleOceanMapWheel, oceanMapPointerAction} from '../../ocean-acoustic-workbench/src/OceanMap';

const source = renderToStaticMarkup(<OceanSource catalog={{available: true, storage: 'cloud', dataset_version: 'teacher-v1', path: 'C:\\private\\teacher-data', bytes: 8e9}}/>);
assert.match(source, /在线数据服务/);
assert.match(source, /teacher-v1/);
assert.doesNotMatch(source, /private|teacher-data|8\.00 GB/);
const unavailable = renderToStaticMarkup(<OceanSource catalog={{available: false, storage: 'cloud'}}/>);
assert.match(unavailable, /尚未准备就绪/);
assert.doesNotMatch(unavailable, /已连接/);

// Reverse insertion order to ensure exported columns are determined by the header.
const row = {sound_speed_m_s: 1500, absolute_salinity_g_kg: 35.2, pressure_dbar: 10, practical_salinity: 35, temperature_c: 20, depth_m: 10};
const profile = {period: '年平均', period_id: 0, requested: {lon: 120, lat: 20}, selected: {lon: 119.5, lat: 19.5}, depth_limit_m: 1000, bottom: {elevation_m: -1500}, grid_bottom: {elevation_m: -2000}, rows: [row], method: 'TEOS-10', warnings: [], temperature_file: 'C:\\private\\temperature.nc', salinity_file: '/private/salinity.nc'};
const online = renderToStaticMarkup(<ProfileResult result={profile} cloud onDownload={() => {}}/>);
assert.match(online, /1500\.00/);
assert.match(online, /temperature\.nc/);
assert.doesNotMatch(online, /private|用于声场仿真/);
assert.doesNotMatch(renderToStaticMarkup(<ProfileResult result={profile} onSimulate={() => {}} onDownload={() => {}}/>), /用于声场仿真/);
const surfaceProfile = {...profile, rows: [0,10,100,200,500,1000].map(depth_m => ({...row,depth_m}))};
assert.match(renderToStaticMarkup(<ProfileResult result={surfaceProfile} onSimulate={() => {}} onDownload={() => {}}/>), /用于声场仿真/);
assert.equal(profileSimulationDraft(surfaceProfile).water_depth_m,1000);
const gapProfile = {...surfaceProfile,missing_depths_m:[250]};
assert.equal(profileSimulationDraft(gapProfile).water_depth_m,200,'Known missing layers must cap the proposed environment at retained data before the gap');
assert.equal(profileSimulationDraft({...surfaceProfile,missing_depths_m:[20]}),null,'Do not offer an unusable <50m environment');
assert.equal(profileSimulationDraft({...surfaceProfile,depth_limit_m:1500,rows:surfaceProfile.rows.slice(0,-1)}).water_depth_m,500,'Never extend a draft below the deepest returned row');
assert.equal(profileCsv(profile).split('\n')[1], '10,20,35,10,35.2,1500');
const versionedProfile = oceanDataQuery({lon: 120, lat: 20, period: 0}, 'teacher-v2');
assert.equal(versionedProfile.get('version'), 'teacher-v2');
assert.equal(versionedProfile.get('period'), '0');
assert.equal(oceanDataQuery({west: 95, east: 145}, 'teacher-v2').get('version'), 'teacher-v2');
assert.equal(oceanDataQuery({lon: 120, lat: 20}, undefined).has('version'), false);

// Visible selection receipts distinguish a request marker from successful data,
// including coastal failures and surface missingness. No coordinates are inferred.
const selected={lon:120.1234,lat:20.5678,period:13};
const loading=renderToStaticMarkup(<OceanPointSummary selection={selected} periodLabel="1—3月" busy/>);
assert.match(loading,/正在读取所选点/);assert.match(loading,/120\.1234/);assert.match(loading,/20\.5678/);assert.match(loading,/1—3月/);assert.doesNotMatch(loading,/查看完整剖面|剖面已读取/);
const coastal='最近的1°温盐网格位于陆地，未自动跨海岸寻找其他剖面。';
const failed=renderToStaticMarkup(<OceanPointSummary selection={selected} periodLabel="1—3月" error={coastal}/>);
assert.match(failed,/role="alert"/);assert(failed.includes(coastal));assert.doesNotMatch(failed,/剖面已读取|查看完整剖面/);
const ready=renderToStaticMarkup(<OceanPointSummary selection={selected} periodLabel="年平均" result={surfaceProfile} onView={()=>{}}/>);
assert.match(ready,/剖面已读取/);assert.match(ready,/有效层/);assert.match(ready,/1500 m/);assert.match(ready,/海表温度/);assert.match(ready,/20\.00/);assert.match(ready,/35\.00/);assert.match(ready,/1500\.00 m\/s/);assert.match(ready,/查看完整剖面与下载/);
const noSurface=renderToStaticMarkup(<OceanPointSummary selection={selected} periodLabel="年平均" result={profile}/>);
assert.match(noSurface,/海表0 m缺测/);assert.match(noSurface,/最浅有效层为 10 m/);assert.doesNotMatch(noSurface,/海表温度/);
const embedded=renderToStaticMarkup(<OceanMap point={selected} pointSummary={<OceanPointSummary selection={selected} periodLabel="年平均" result={surfaceProfile}/>}/>);
assert.match(embedded,/ocean-map-point-preview/);assert.match(embedded,/查看完整剖面与下载/);

// The real view button is the only operation that invokes scroll/focus. Rendering
// a new loading or completed summary never changes the user's map viewport.
let scrolled=0,focused=0;
const target={scrollIntoView(options){scrolled++;assert.equal(options.block,'start')},focus(options){focused++;assert.equal(options.preventScroll,true)}};
const findButton=node=>{if(!node||typeof node!=='object')return null;if(node.type==='button')return node;for(const child of React.Children.toArray(node.props?.children)){const found=findButton(child);if(found)return found}return null};
const summary=OceanPointSummary({selection:selected,periodLabel:'年平均',result:surfaceProfile,onView:()=>scrollToOceanProfile(target)});
assert.equal(scrolled,0);findButton(summary).props.onClick();assert.equal(scrolled,1);assert.equal(focused,1);assert.equal(scrollToOceanProfile(null),false);

// Ordinary wheel and vertical touch gestures stay page scrolls; explicit Ctrl
// zoom, mouse drag and horizontal touch drag still drive the actual map handlers.
let prevented=0,changed=0,nextBounds;
const rect={left:0,top:0,width:500,height:500},bounds={west:95,east:145,south:-5,north:45};
const wheel={ctrlKey:false,clientX:250,clientY:250,deltaY:-100,preventDefault(){prevented++}};
const setBounds=update=>{changed++;nextBounds=update(bounds)};
assert.equal(handleOceanMapWheel(wheel,rect,setBounds),false);assert.equal(prevented,0);assert.equal(changed,0);
assert.equal(handleOceanMapWheel({...wheel,ctrlKey:true},rect,setBounds),true);assert.equal(prevented,1);assert.equal(changed,1);assert.equal(nextBounds.east-nextBounds.west,40);assert.equal((nextBounds.east+nextBounds.west)/2,120);
assert.equal(oceanMapPointerAction({x:0,y:0,pointerType:'touch'},{clientX:4,clientY:40},rect).type,'page-scroll');
assert.deepEqual(oceanMapPointerAction({x:0,y:0,pointerType:'touch'},{clientX:50,clientY:10},rect),{type:'pan',dx:-.1,dy:0});
const mousePan=oceanMapPointerAction({x:0,y:0,pointerType:'mouse'},{clientX:0,clientY:50},rect);assert.equal(mousePan.type,'pan');assert.equal(Math.abs(mousePan.dx),0);assert.equal(mousePan.dy,.1);
assert.equal(oceanMapPointerAction({x:0,y:0,pointerType:'touch'},{clientX:2,clientY:2},rect).type,'pick');
console.log('Ocean UI contracts passed: cloud provenance, unavailable state, real simulation callback, CSV column order.');
