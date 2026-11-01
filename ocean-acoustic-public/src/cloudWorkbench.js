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

export function researchRounds(value, maximum = 1000, fallback = 0) {
  const max = Number.isInteger(maximum) && maximum > 0 ? maximum : 1000;
  const requested = Number(value);
  return value !== '' && Number.isInteger(requested) && requested >= 0 && requested <= max ? requested : Math.min(max, fallback);
}

export const researchContextBudgets = Object.freeze([4096,8192,16384,32768,65536,131072]);

export function contextBudgetChoices(advertised) {
  const values = Array.isArray(advertised) ? advertised.map(value => (value?.value ?? value)==='unlimited'?'unlimited':Number(value?.value ?? value)) : [...researchContextBudgets,'unlimited'];
  return ['auto', ...researchContextBudgets.filter(value => values.includes(value)), ...(values.includes('unlimited')?['unlimited']:[])];
}

export function normalizeResearchBudget(value, advertised) {
  const choices = contextBudgetChoices(advertised);
  const fallback = choices.includes('unlimited') ? 'unlimited' : 'auto';
  if (value === 'auto') return 'auto';
  if (value === 'unlimited') return choices.includes(value) ? value : 'auto';
  const number = Number(value);
  return choices.includes(number) ? number : fallback;
}

// Only visible message text is available in the browser. The server accounts
// for system instructions, evidence, tool schemas and retained tool results.
export function estimateVisibleResearchInput(messages = [], question = '') {
  const encoder = new TextEncoder();
  const texts = messages.map(row => String(row.text ?? row.content ?? ''));
  if (question) texts.push(question);
  return 32 + texts.reduce((sum,text) => sum + 32 + encoder.encode(text).length, 0);
}

export function researchContextNotes(context = {}) {
  const notes = [];
  const counts = [
    [context.compacted_tool_messages ?? context.compressed_tool_messages, '条工具历史已压缩'],
    [context.dropped_tool_messages ?? context.omitted_tool_messages, '条工具历史已省略'],
    [context.dropped_history_messages, '条较早对话未发送'],
    [context.dropped_evidence_count, '条候选资料未发送'],
  ];
  for (const [count,label] of counts) if (Number.isFinite(count) && count > 0) notes.push(`${count} ${label}`);
  if (context.evidence_truncated) notes.push('资料摘录已缩短');
  for (const source of [context.notes,context.warnings]) {
    for (const note of Array.isArray(source) ? source : typeof source === 'string' ? [source] : []) {
      if (typeof note === 'string' && note.trim()) notes.push(note);
    }
  }
  return [...new Set(notes)];
}

export function simulationNodeMessage(capabilities) {
  return capabilities.node_online
    ? '计算节点已连接；参数检查后提交，实际结果以任务记录为准。'
    : '计算节点未连接。模型说明、Skill 与参数可以浏览；检查计划和声场计算需节点在线。';
}
