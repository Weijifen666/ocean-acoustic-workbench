import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {OceanSource, ProfileResult, profileCsv, profileSimulationDraft} from '../../ocean-acoustic-workbench/src/OceanData';
import {oceanDataQuery} from '../../ocean-acoustic-workbench/src/OceanMap';

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
console.log('Ocean UI contracts passed: cloud provenance, unavailable state, real simulation callback, CSV column order.');
