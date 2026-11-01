import {useEffect, useState} from 'react';

export const publicCapabilities = Object.freeze({public_mode: true, node_online: false, script_execution: false, open_folder: false, queue_admin: false});

export function useWorkbenchCapabilities(initial) {
  const [state, setState] = useState({capabilities: {...publicCapabilities, ...initial}, loading: !initial, error: ''});
  useEffect(() => {
    if (initial) {setState({capabilities: {...publicCapabilities, ...initial}, loading: false, error: ''}); return;}
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const response = await fetch('/api/workbench/capabilities', {signal: controller.signal});
        const data = await response.json();
        if (!response.ok) throw Error(data.detail || '工作台能力检查失败');
        if (!controller.signal.aborted) setState({capabilities: {...publicCapabilities, ...data}, loading: false, error: ''});
      } catch (error) {
        if (!controller.signal.aborted) setState({capabilities: {...publicCapabilities}, loading: false, error: error.message});
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 15000);
    }
    refresh();
    return () => {controller.abort(); clearTimeout(timer);};
  }, [initial]);
  return state;
}

export function researchRounds(value, maximum = 1000, fallback = 40) {
  const max = Number.isInteger(maximum) && maximum > 0 ? maximum : 40;
  const requested = Number(value);
  return value !== '' && Number.isInteger(requested) && requested >= 0 && requested <= max ? requested : Math.min(max, fallback);
}

export function simulationNodeMessage(capabilities) {
  return capabilities.node_online
    ? '计算节点已连接；参数检查后提交，实际结果以任务记录为准。'
    : '计算节点未连接。模型说明、Skill 与参数可以浏览；检查计划和声场计算需节点在线。';
}
