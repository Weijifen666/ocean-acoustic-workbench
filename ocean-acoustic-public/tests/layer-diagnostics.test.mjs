import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseProfile} from '../server/layer-diagnostics.mjs';
const profile=rows=>({selected:{lon:119.5,lat:19.5},period:13,rows:rows.map(([depth_m,temperature_c,sound_speed_m_s])=>({depth_m,temperature_c,sound_speed_m_s}))});
test('temperature crossing interpolates from 10m reference and duct is separate',()=>{
 const result=diagnoseProfile(profile([[0,20,1500],[10,20,1501],[20,19.9,1502],[30,19.5,1501]]));
 assert.ok(Math.abs(result.temperature_mld.depth_m-22.5)<1e-9);assert.equal(result.surface_duct_candidate.depth_m,20);
 assert.equal(result.density_mld.status,'not_computed');
});
test('truncated increasing profiles do not invent MLD or a duct bottom',()=>{
 const result=diagnoseProfile(profile([[0,20,1500],[10,20,1501],[20,20,1502]]));
 assert.equal(result.temperature_mld.depth_m,null);assert.equal(result.temperature_mld.status,'not_reached_in_observed_profile');
 assert.equal(result.surface_duct_candidate.depth_m,null);assert.equal(result.surface_duct_candidate.status,'increasing_but_boundary_not_observed');
});

test('omitted missing layers cannot be interpolated into an MLD or a continuous surface duct',()=>{
 const data={...profile([[0,20,1500],[10,20,1501],[30,19.5,1503],[40,19,1500]]),missing_depths_m:[20]};
 const result=diagnoseProfile(data);
 assert.equal(result.temperature_mld.depth_m,null);
 assert.equal(result.temperature_mld.status,'missing_data');
 assert.equal(result.surface_duct_candidate.depth_m,null);
 assert.equal(result.surface_duct_candidate.status,'missing_data');
});

test('a reference inside a known missing interval is unavailable, while deeper gaps do not invalidate an earlier crossing',()=>{
 const missingReference=diagnoseProfile({...profile([[0,20,1500],[20,19,1501],[30,18,1500]]),missing_depths_m:[5]});
 assert.equal(missingReference.temperature_mld.status,'missing_data');
 assert.equal(missingReference.temperature_mld.reference_temperature_c,null);
 const belowBoundary=diagnoseProfile({...profile([[0,20,1500],[10,20,1501],[20,19,1500],[40,18,1490]]),missing_depths_m:[30]});
 assert.equal(belowBoundary.temperature_mld.status,'threshold_crossing');
 assert.ok(Math.abs(belowBoundary.temperature_mld.depth_m-12)<1e-9);
 assert.equal(belowBoundary.surface_duct_candidate.depth_m,10);
});
