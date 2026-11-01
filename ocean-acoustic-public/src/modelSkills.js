import workflows from '../skills/at-environment/references/creation-workflows.json';
export const modelWorkflows=workflows.models;
export function modelSkillPrompt(model,baseline=false){
 const r=modelWorkflows.find(r=>r.id===model.toLowerCase());
 if(!r)return '';
 const load=`请载入 ${r.skill} 技能，并通过 read_skill_resource 读取该技能的 references/workflow.md。`;
 if(!r.supported)return load+'请核对当前节点能力与可用算例，说明当前缺少什么以及完成接入的条件。尚未具备可运行基线时如实说明。';
 return load+'请以当前已开放的工具与节点能力为准，不存在的工具不可假装调用；没有执行器时给出输入计划与待执行检查，明确尚未计算。'+(baseline?`请规划并在当前能力允许时实际复现 ${r.name} 的 ${r.case} 经典算例：用 list_model_workflows 检查可用性，有独立执行器时再创建任务并运行；无执行器时列出输入与调用步骤。核对日志、坐标、维度和 model_metrics.json，保存输入、脚本、图表与数据，最后提交研究报告。执行成功与收敛、物理精度分别说明。`:`请按该模型的使用条件、环境配置、执行与验证流程帮助我构造研究。先明确关键参数，随后形成经典基线与自定义输入计划，执行条件满足后再运行。我的研究目标是：`);
}
