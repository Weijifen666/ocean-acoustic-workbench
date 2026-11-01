// Deterministic diagnostics of actual profiles; no density approximation and no
// claim that a candidate sound-speed structure proves acoustic trapping.
const finite = Number.isFinite;
function interpolate(rows, depth, key) {
  const exact=rows.find(r=>r.depth_m===depth);
  if(exact)return exact[key];
  for(let i=1;i<rows.length;i++) {
    const a=rows[i-1],b=rows[i];
    if(a.depth_m<depth&&b.depth_m>depth&&finite(a[key])&&finite(b[key]))return a[key]+(b[key]-a[key])*(depth-a.depth_m)/(b.depth_m-a.depth_m);
  }
  return null;
}
export function diagnoseProfile(profile,{reference_depth_m=10,temperature_threshold_c=0.2}={}) {
  if(!finite(reference_depth_m)||reference_depth_m<0||!finite(temperature_threshold_c)||temperature_threshold_c<=0||temperature_threshold_c>5)throw new Error('混合层判据无效');
  const rows=profile.rows;
  if(!Array.isArray(rows)||rows.length<2||rows.some((r,i)=>!finite(r.depth_m)||(i&&r.depth_m<=rows[i-1].depth_m)))throw new Error('剖面深度坐标无效');
  const reference=interpolate(rows,reference_depth_m,'temperature_c');
  let mld={depth_m:null,status:'reference_unavailable'};
  if(finite(reference)) {
    mld={depth_m:null,status:'not_reached_in_observed_profile'};
    let prior={depth_m:reference_depth_m,temperature_c:reference};
    for(const row of rows.filter(r=>r.depth_m>reference_depth_m)) {
      if(!finite(row.temperature_c)){mld={depth_m:null,status:'missing_data'};break;}
      const difference=Math.abs(row.temperature_c-reference),previous=Math.abs(prior.temperature_c-reference);
      if(difference>=temperature_threshold_c) {
        mld={depth_m:prior.depth_m+(row.depth_m-prior.depth_m)*(temperature_threshold_c-previous)/(difference-previous),status:'threshold_crossing'};break;
      }
      prior=row;
    }
  }
  let duct={depth_m:null,status:'no_continuous_positive_surface_gradient'};
  if(rows[0].depth_m===0&&finite(rows[0].sound_speed_m_s)) {
    let rising=false;
    for(let i=1;i<rows.length;i++) {
      const a=rows[i-1],b=rows[i];
      if(!finite(a.sound_speed_m_s)||!finite(b.sound_speed_m_s)){duct={depth_m:null,status:'missing_data'};break;}
      if(b.sound_speed_m_s>a.sound_speed_m_s){rising=true;duct={depth_m:null,status:'increasing_but_boundary_not_observed'};continue;}
      if(rising&&b.sound_speed_m_s<a.sound_speed_m_s)duct={depth_m:a.depth_m,status:'candidate_local_maximum'};
      else if(rising)duct={depth_m:null,status:'plateau_boundary_unresolved'};
      break;
    }
  }else duct={depth_m:null,status:'surface_unavailable'};
  return {selected:profile.selected,period:profile.period,dataset_version:profile.dataset_version||null,
    temperature_mld:{...mld,reference_depth_m,reference_temperature_c:reference,threshold_c:temperature_threshold_c,criterion:'absolute_temperature_difference'},
    density_mld:{depth_m:null,status:'not_computed',reason:'当前云端诊断没有计算 TEOS-10 位密度，不以近似密度替代。'},
    surface_duct_candidate:duct,
    limitations:['单点气候态诊断，不代表区域统计或特定日期观测。','温度混合层与声学声道分别判断；密度判据可能不同。','声速候选结构不能证明某频率存在有效俘获；需明确传播条件并实际求解。','缺测或未出现阈值/局部极大值时不把最深层当作边界。']};
}
