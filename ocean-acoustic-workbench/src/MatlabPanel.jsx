import React, { useState, useEffect } from 'react';
import { Terminal, Check, CheckCircle2, AlertCircle, RefreshCw, Save, Loader2, FolderCode, ShieldCheck } from 'lucide-react';
import './matlab.css';

const request = async (path, body) => {
  const r = await fetch('/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await r.json();
  if (!r.ok) throw Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
  return data;
};

export default function MatlabPanel({ cfg, setCfg, onSave, busy, notify }) {
  const [checking, setChecking] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [detected, setDetected] = useState(null);

  useEffect(() => {
    fetchDetect();
    runCheck();
  }, []);

  async function fetchDetect() {
    setDetecting(true);
    try {
      const data = await request('/matlab/detect');
      setDetected(data);
    } catch (e) {
      // Non-critical, ignore
    } finally {
      setDetecting(false);
    }
  }

  async function runCheck() {
    setChecking(true);
    setCheckResult(null);
    try {
      const data = await request('/matlab/check', {
        matlab_path: cfg.matlab_path,
        toolbox_path: cfg.toolbox_path
      });
      setCheckResult(data);
    } catch (e) {
      setCheckResult({ ok: false, summary: e.message, components: [] });
    } finally {
      setChecking(false);
    }
  }

  const setField = (key) => (e) => setCfg((c) => ({ ...c, [key]: e.target.value }));

  const isReady = checkResult?.ok;

  return (
    <section className="matlab-panel">
      <div className="matlab-panel-heading">
        <div>
          <span className="matlab-eyebrow">COMPUTING ENGINE & TOOLBOX</span>
          <h2>
            <Terminal size={20} />
            MATLAB 与声学计算工具箱
          </h2>
          <p>配置本机 MATLAB 内核与 Acoustics Toolbox (AT) 路径，支持一键自检与候选路径自动探测。</p>
        </div>
        <span className={'matlab-status-badge ' + (isReady ? 'ready' : 'pending')}>
          {isReady ? <ShieldCheck size={14} /> : <AlertCircle size={14} />}
          {isReady ? '计算环境已就绪' : '等待检测或配置'}
        </span>
      </div>

      {/* 快捷候选探测栏 */}
      <div className="matlab-detect-bar">
        <div className="matlab-detect-title">
          <span>🔍 本机路径探测与推荐预设</span>
          <button className="preset-chip" disabled={detecting} onClick={fetchDetect}>
            {detecting ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
            重新探测
          </button>
        </div>
        <div className="matlab-presets">
          {detected?.detected_matlab && detected.detected_matlab.length > 0 ? (
            detected.detected_matlab.map((p) => (
              <button
                key={p}
                className={'preset-chip ' + (cfg.matlab_path === p ? 'active' : '')}
                onClick={() => {
                  setCfg((c) => ({ ...c, matlab_path: p }));
                  notify('已选用 MATLAB 路径: ' + p);
                }}
              >
                <Terminal size={12} />
                {p.includes('R2024b') ? 'MATLAB R2024b (已探测)' : p.includes('R2024a') ? 'MATLAB R2024a (已探测)' : p}
                {cfg.matlab_path === p && <Check size={12} />}
              </button>
            ))
          ) : (
            <span style={{ fontSize: 11, color: '#889ea8' }}>未探测到常见目录下的 MATLAB，请在下方直接输入完整路径</span>
          )}

          {detected?.detected_toolbox && detected.detected_toolbox.length > 0 ? (
            detected.detected_toolbox.map((p) => (
              <button
                key={p}
                className={'preset-chip ' + (cfg.toolbox_path === p ? 'active' : '')}
                onClick={() => {
                  setCfg((c) => ({ ...c, toolbox_path: p }));
                  notify('已选用 AT 工具箱路径: ' + p);
                }}
              >
                <FolderCode size={12} />
                {p.includes('at-matlab') ? 'Acoustics Toolbox (D盘已探测)' : p}
                {cfg.toolbox_path === p && <Check size={12} />}
              </button>
            ))
          ) : null}
        </div>
      </div>

      {/* 参数输入网格 */}
      <div className="matlab-form-grid">
        <label className="matlab-field">
          <span>MATLAB 可执行文件路径 (matlab.exe)</span>
          <input
            value={cfg.matlab_path || ''}
            onChange={setField('matlab_path')}
            placeholder="例如: D:\Program Files\MATLAB\R2024b\bin\matlab.exe"
          />
          <small>系统将以无图形静默模式调度此程序执行声场仿真。</small>
        </label>

        <label className="matlab-field">
          <span>Acoustics Toolbox 根目录 (AT)</span>
          <input
            value={cfg.toolbox_path || ''}
            onChange={setField('toolbox_path')}
            placeholder="例如: D:\matlab-project&tool\at-matlab\at"
          />
          <small>声学工具箱主目录，必须包含 bin (含 kraken.exe/bellhop.exe) 及 ReadWrite 目录。</small>
        </label>

        <label className="matlab-field">
          <span>授权工程/数据工作区路径</span>
          <input
            value={cfg.project_path || ''}
            onChange={setField('project_path')}
            placeholder="例如: C:\Users\...\Desktop\现代海洋声学大作业\ocean-acoustic-workbench\.local\project"
          />
          <small>智能体可安全读取该目录下的环境算例与实验数据。</small>
        </label>

        <label className="matlab-field">
          <span>单任务计算超时限制 (秒)</span>
          <input
            type="number"
            min="30"
            max="600"
            value={cfg.timeout_seconds || 240}
            onChange={setField('timeout_seconds')}
          />
          <small>防止由于网格过密或死循环导致计算占用系统资源（范围：30 ~ 600 秒）。</small>
        </label>
      </div>

      {/* 交互按钮栏 */}
      <div className="matlab-actions-row">
        <button className="matlab-test-btn" disabled={checking} onClick={runCheck}>
          {checking ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
          {checking ? '正在检测计算环境…' : '一键检测计算环境'}
        </button>

        <button
          className="matlab-save-btn"
          disabled={busy || checking}
          onClick={async () => {
            await onSave();
            await runCheck();
          }}
        >
          <Save size={14} />
          {busy ? '正在保存…' : '保存并应用环境配置'}
        </button>
      </div>

      {/* 检测结果诊断与报告 */}
      {checkResult && (
        <div className={'matlab-test-result ' + (checkResult.ok ? 'success' : 'error')}>
          {checkResult.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <div>
            <strong>{checkResult.ok ? '环境自检全部通过' : '环境检测发现异常'}</strong>
            <p style={{ margin: '4px 0 0', fontSize: 11 }}>{checkResult.summary}</p>
          </div>
        </div>
      )}

      {/* 各组件状态细项网格 */}
      {checkResult?.components && (
        <div className="matlab-components-grid">
          {checkResult.components.map((c) => (
            <div key={c.id} className={'comp-card ' + (c.ok ? 'ok' : 'missing')}>
              <div className="comp-icon">
                {c.ok ? <Check size={14} /> : <AlertCircle size={14} />}
              </div>
              <div className="comp-info">
                <strong>{c.name}</strong>
                <small title={c.path || c.desc}>{c.ok ? c.desc : `未找到: ${c.path || '请检查路径'}`}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
