import React, {useEffect, useRef, useState} from 'react';
import {Download, Loader2, MapPin} from 'lucide-react';
import OceanMap, {oceanDataQuery} from './OceanMap';
import './ocean-data.css';

async function get(path, signal) {
  const response = await fetch('/api/ocean-data' + path, {signal});
  const data = await response.json();
  if (!response.ok) throw Error(response.status === 409 ? '环境数据版本已更新，请刷新页面后重试。' : data.detail || '数据读取失败');
  return data;
}

const csvColumns = ['depth_m', 'temperature_c', 'practical_salinity', 'pressure_dbar', 'absolute_salinity_g_kg', 'sound_speed_m_s'];
export function profileCsv(profile) {
  return csvColumns.join(',') + '\n' + profile.rows.map(row => csvColumns.map(key => row[key] ?? '').join(',')).join('\n');
}

export function profileSimulationDraft(profile) {
  const rows = Array.isArray(profile.rows) ? profile.rows : [];
  if (!rows.length || rows[0].depth_m !== 0) return null;
  const gaps = (Array.isArray(profile.missing_depths_m) ? profile.missing_depths_m : []).filter(Number.isFinite);
  const firstGap = gaps.length ? Math.min(...gaps) : Infinity;
  const continuous = rows.filter(row => row.depth_m < firstGap);
  const limits = [profile.depth_limit_m, rows.at(-1).depth_m,
    continuous.at(-1)?.depth_m, -profile.bottom?.elevation_m, -profile.grid_bottom?.elevation_m];
  if (!limits.every(Number.isFinite)) return null;
  const waterDepth = Math.floor(Math.min(...limits) / 50) * 50;
  if (waterDepth < 50) return null;
  return {template: 'woa18', longitude: profile.requested.lon, latitude: profile.requested.lat,
    period: profile.period_id, water_depth_m: waterDepth,
    source_depths_m: String(Math.min(500, waterDepth / 2)), receiver_depth_m: Math.min(1000, waterDepth / 2)};
}

function Curve({rows}) {
  if (!rows.length) return <p className="ocean-hint">该点没有有效剖面。</p>;
  const min = Math.floor(Math.min(...rows.map(row => row.sound_speed_m_s)) / 10) * 10;
  const max = Math.ceil(Math.max(...rows.map(row => row.sound_speed_m_s)) / 10) * 10;
  const zmax = rows.at(-1).depth_m;
  const x = c => 70 + (c - min) / (max - min || 1) * 430;
  const y = z => 45 + z / (zmax || 1) * 340;
  return <svg className="ocean-curve" viewBox="0 0 570 440" role="img" aria-label="声速随深度变化曲线，深度向下增加">
    <text x="285" y="20" textAnchor="middle">声速（m/s）</text>
    {[0, 1, 2, 3, 4].map(i => <g key={i}>
      <line x1={70 + i * 107.5} x2={70 + i * 107.5} y1="45" y2="385" stroke="#dce7e8"/>
      <text x={70 + i * 107.5} y="410" textAnchor="middle">{Math.round(min + (max - min) * i / 4)}</text>
      <line x1="70" x2="500" y1={45 + i * 85} y2={45 + i * 85} stroke="#dce7e8"/>
      <text x="60" y={49 + i * 85} textAnchor="end">{Math.round(zmax * i / 4)}</text>
    </g>)}
    <text x="18" y="220" transform="rotate(-90 18 220)" textAnchor="middle">深度（m）</text>
    <polyline points={rows.map(row => `${x(row.sound_speed_m_s)},${y(row.depth_m)}`).join(' ')} fill="none" stroke="#137b80" strokeWidth="3"/>
    {rows.map(row => <circle key={row.depth_m} cx={x(row.sound_speed_m_s)} cy={y(row.depth_m)} r="2" fill="#137b80"><title>{row.depth_m + ' m：' + row.sound_speed_m_s.toFixed(2) + ' m/s'}</title></circle>)}
  </svg>;
}

export function OceanSource({catalog}) {
  const cloud = catalog?.storage === 'cloud';
  return <>
    <div className="panel-heading">{cloud ? '在线数据服务' : '环境数据来源'} <span>{!catalog ? '检查中' : catalog.available ? (cloud ? '已连接 · 按需读取' : `已连接 · ${catalog.count ?? 0}个数据文件`) : '数据暂不可用'}</span></div>
    {catalog && <p className="ocean-data-path">{cloud
      ? <>无需下载完整数据包{catalog.dataset_version && <> · 数据版本 {catalog.dataset_version}</>}</>
      : <>{catalog.path || catalog.name || 'WOA18 / ETOPO1'}{Number.isFinite(catalog.bytes) && <> · {(catalog.bytes / 1e9).toFixed(2)} GB</>}</>}</p>}
    {catalog && !catalog.available && <p className="ocean-error" role="status">{cloud ? '在线环境数据尚未准备就绪，请稍后重试。' : '环境数据未就绪，请检查数据配置。'}</p>}
  </>;
}

export function ProfileResult({result, onSimulate, onDownload, cloud}) {
  const basename = value => String(value || '').split(/[\\/]/).at(-1);
  const simulationDraft = profileSimulationDraft(result);
  return <section className="panel ocean-result">
    <div className="panel-heading"><span>{result.period} · {result.rows.length}个有效层</span><div>
      {onSimulate && simulationDraft && <button className="button primary" onClick={() => onSimulate(simulationDraft)}>用于声场仿真</button>}
      <button className="button" onClick={() => onDownload('csv')}><Download size={14}/>CSV</button>
      <button className="button" onClick={() => onDownload('json')}><Download size={14}/>JSON</button>
    </div></div>
    <div className="ocean-summary"><span>实际温盐格点：{result.selected.lon}°，{result.selected.lat}°</span><span>所选坐标水深：{Number.isFinite(result.bottom?.elevation_m) ? `${-result.bottom.elevation_m} m` : '暂无数据'}</span><span>有效剖面至：{result.rows.at(-1)?.depth_m ?? '—'} m</span></div>
    <div className="ocean-results-grid"><Curve rows={result.rows}/><div className="ocean-table"><table><thead><tr><th>深度 m</th><th>温度 °C</th><th>实用盐度</th><th>声速 m/s</th></tr></thead><tbody>{result.rows.map(row => <tr key={row.depth_m}><td>{row.depth_m}</td><td>{row.temperature_c.toFixed(3)}</td><td>{row.practical_salinity.toFixed(3)}</td><td>{row.sound_speed_m_s.toFixed(2)}</td></tr>)}</tbody></table></div></div>
    <div className="ocean-notes"><strong>{result.method}</strong>{onSimulate && <p>{simulationDraft ? `仿真草案采用连续有效剖面内的 ${simulationDraft.water_depth_m} m 截断水深；海底参数仍需在仿真页确认。` : '海面起连续有效剖面不足50 m，当前不生成声场仿真草案。'}</p>}{(result.warnings || []).map(warning => <p key={warning}>{warning}</p>)}{(result.temperature_file || result.salinity_file) && <small>温度文件：{cloud ? basename(result.temperature_file) : result.temperature_file}<br/>盐度文件：{cloud ? basename(result.salinity_file) : result.salinity_file}</small>}</div>
  </section>;
}

export function scrollToOceanProfile(target) {
  if (!target) return false;
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({behavior: reduced ? 'auto' : 'smooth', block: 'start'});
  target.focus?.({preventScroll: true});
  return true;
}

export function OceanPointSummary({selection, periodLabel, busy, error, result, onView}) {
  const number = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
  const surface = result?.rows?.find(row => row.depth_m === 0);
  const state = busy ? 'loading' : error ? 'error' : result ? 'success' : 'idle';
  return <div className={'ocean-point-summary ' + state} role={error && !busy ? 'alert' : 'status'} aria-live="polite">
    <div className="ocean-point-heading"><strong>{busy ? '正在读取所选点…' : error ? '该点暂未取得剖面' : result ? '剖面已读取' : '请选择海洋位置'}</strong>{busy && <Loader2 size={15} className="spin"/>}</div>
    {selection && <p className="ocean-point-coordinate">请求坐标 {number(selection.lon, 4)}°，{number(selection.lat, 4)}° · {periodLabel}</p>}
    {error && !busy && <p className="ocean-point-error">{error}</p>}
    {busy && <p>正在查询当前位置的温盐、地形与声速…</p>}
    {result && !busy && !error && <>
      <p className="ocean-point-grid">实际温盐格点 {number(result.selected?.lon, 2)}°，{number(result.selected?.lat, 2)}°</p>
      <dl className="ocean-point-values"><div><dt>有效层</dt><dd>{result.rows.length}</dd></div><div><dt>坐标水深</dt><dd>{number(Number.isFinite(result.bottom?.elevation_m) ? -result.bottom.elevation_m : undefined, 0)} m</dd></div><div><dt>有效剖面至</dt><dd>{number(result.rows.at(-1)?.depth_m, 0)} m</dd></div></dl>
      {surface ? <dl className="ocean-point-values"><div><dt>海表温度</dt><dd>{number(surface.temperature_c)} °C</dd></div><div><dt>海表实用盐度</dt><dd>{number(surface.practical_salinity)}</dd></div><div><dt>海表声速</dt><dd>{number(surface.sound_speed_m_s)} m/s</dd></div></dl> : <p>海表0 m缺测；最浅有效层为 {number(result.rows[0]?.depth_m, 0)} m，未把它当作海表。</p>}
      <button className="button primary ocean-view-profile" onClick={onView}>查看完整剖面与下载</button>
    </>}
    {!selection && !busy && !error && <p>点击地图后可在这里查看状态与数据概要。</p>}
    {error && !busy && <p>请查看提示后另选海洋位置，或修改坐标后重新提取。沿岸的1°温盐格点可能为陆地或缺测。</p>}
  </div>;
}

export default function OceanData({notify, onSimulate}) {
  const [catalog, setCatalog] = useState(null);
  const [lon, setLon] = useState('120'), [lat, setLat] = useState('20'), [period, setPeriod] = useState('0');
  const [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selection, setSelection] = useState(null);
  const request = useRef(null), resultTarget = useRef(null), inputsEdited = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    get('', controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setCatalog(data);
      if (data.available && !inputsEdited.current) loadPoint(120, 20, '0', data.dataset_version);
    }).catch(error => {if (!controller.signal.aborted) setError(error.message);});
    return () => {controller.abort(); request.current?.abort();};
  }, []);

  async function loadPoint(x, y, selectedPeriod = period, dataVersion = catalog?.dataset_version) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSelection({lon: Number(x), lat: Number(y), period: Number(selectedPeriod)});
    setLon(String(x)); setLat(String(y)); setBusy(true); setResult(null); setError('');
    try {
      const query = oceanDataQuery({lon: x, lat: y, period: selectedPeriod}, dataVersion);
      const data = await get('/profile?' + query, controller.signal);
      if (!controller.signal.aborted) setResult(data);
    } catch (error) {
      if (!controller.signal.aborted) setError(error.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function download(format) {
    const blob = new Blob([format === 'json' ? JSON.stringify(result, null, 2) : profileCsv(result)], {type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `WOA18_${result.selected.lon}_${result.selected.lat}_${result.period_id}.${format}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify?.('环境剖面已导出。');
  }

  const periodLabel = result?.period || catalog?.periods?.find(item => Number(item.id) === selection?.period)?.label || (selection?.period === 0 ? '年平均' : '所选时段');
  const summaryProps = {selection, periodLabel, busy, error, result, onView: () => scrollToOceanProfile(resultTarget.current)};

  return <div className="ocean-data-page">
    <div className="page-title"><div><div className="eyebrow">OCEAN ENVIRONMENT</div><h1>海洋环境数据</h1><p className="description">WOA18 温盐气候平均场 · ETOPO1 海底地形 · 声速剖面</p></div></div>
    <section className="panel ocean-input"><OceanSource catalog={catalog}/>
      <form onSubmit={event => {event.preventDefault(); loadPoint(lon, lat);}}>
        <label>经度（东经为正）<input required type="number" min="-180" max="180" step="any" value={lon} onChange={event => {inputsEdited.current = true; setLon(event.target.value);}}/></label>
        <label>纬度（北纬为正）<input required type="number" min="-90" max="90" step="any" value={lat} onChange={event => {inputsEdited.current = true; setLat(event.target.value);}}/></label>
        <label>平均时段<select value={period} disabled={!catalog?.available} onChange={event => {setPeriod(event.target.value); if (catalog?.available) loadPoint(lon, lat, event.target.value);}}>{(catalog?.periods || [{id: 0, label: '年平均'}]).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <button className="button primary" disabled={busy || !catalog?.available} type="submit">{busy ? <Loader2 className="spin" size={15}/> : <MapPin size={15}/>}提取环境剖面</button>
      </form>
      <p className="ocean-hint">年平均、季节最深5500 m；月平均最深1500 m。遇到陆地或缺测会提示，不自动填补或外推。</p>
      {error && <p role="alert" className="ocean-error">{error}</p>}
    </section>
    {catalog?.available && <div className="ocean-explorer-layout"><OceanMap point={selection} selected={result?.selected} onPick={loadPoint} dataVersion={catalog.dataset_version} pointSummary={<OceanPointSummary {...summaryProps}/>}/><aside className="ocean-selection-aside" aria-label="当前选点数据"><OceanPointSummary {...summaryProps}/></aside></div>}
    {result && <div ref={resultTarget} id="ocean-profile-result" className="ocean-profile-target" tabIndex={-1}><ProfileResult result={result} onSimulate={onSimulate} onDownload={download} cloud={catalog?.storage === 'cloud'}/></div>}
  </div>;
}
