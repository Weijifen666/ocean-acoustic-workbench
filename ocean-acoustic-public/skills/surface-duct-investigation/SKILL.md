---
name: surface-duct-investigation
description: 研究季节性表面声道候选结构与声学俘获，从近表层声速诊断到AT环境构造和传播验证，区分混合层、声道结构与有效波导。
---

> 公共资料适用范围：本文件是只读知识与可复核的构造配方。执行、写文件和本机工具调用仅适用于已授权且在线的计算节点；先查询本次能力与模型可用性。历史执行记录不证明当前节点可用，也不证明任意新环境的数值收敛或物理精度。节点未连接时完成资料检索、条件核对与输入计划，并明确指出待执行项。

> 公网工具路由（先于下文本地流程适用）：只调用当前请求实际注册的工具。下文 diagnose_ocean_layers、prepare_model_research_task、create_research_task、write_research_file、run_research_script、evaluate_acoustic_checks、audit_research_task、finish_research_task、list_at_examples 和 read_at_file 的步骤仅在这些工具已注册且有相应权限时执行；节点在线也不会自动授予这些权限。当前公网可用 diagnose_seasonal_layers 做单点四季的原位温度阈值和声速候选结构诊断，不能冒充本地位温/位密度双判据；density_mld=not_computed 必须保留。它不归档研究任务或生成任务文件，不接受研究 id；标准工具、脚本执行或归档工具缺失时，交付已返回的诊断子集、方法差异和未完成项，不自行重写算法、编造任务或声称检查已通过。传播仅按当前注册的受限 preview_simulation/submit_simulation 流程进行；不适配时如实说明。本文脚本与 NPZ 协议可供阅读和规划，不代表公网已执行。

# 表面声道与传播研究

先区分用户要的是结构诊断、频率效应还是已有结果解释，并选可测量量：候选层深度/声速差，或指定源深、ROI 内的能量分布、TL 及泄漏变化。只问结构时完成诊断即可；只有需要传播证据时才构造求解任务。

载入 `seasonal-layer-diagnostics`，优先用 `diagnose_ocean_layers` 取得实际温盐声速及标准诊断。从海面连续正声速梯度到首个局部极大值定义候选结构；使用工具原始状态区分无连续正梯度、数据截断、缺测与未计算。若另取更深处极大值或海面声速回交深度，单独命名并说明其与标准候选的区别。MLD 和候选声道深度分别报告，不能据剖面形状证明某频率的有效俘获。

研究频率效应或比较 TL 时，读取 `at-environment` 的 `references/scientific-evidence.md`。固定环境、源深/接收几何、ROI、归一化、相干方式与统计定义，再改变频率；源深内外、底质与理想声道对照另列实验。缺少关键传播条件时先交付已有诊断并列缺项。海底参数、剖面外推、理想层厚度均记录为假设或敏感性构造，不能回写成 WOA18 实测。

需要新运行链时载入 `at-environment`，读取 tests/sduct/runtests.m 及对应 K/S/B 输入并先复现原例，再替换成研究剖面、保存改动。该算例描述泄漏表面声道，不能预设完全俘获。SCOOTER 的 RP 是远场变换；近场研究须核对 FLP/fieldsco。KRAKEN/KRAKENC 结合实际模态形状、衰减与边界判断；BELLHOP 提供声线/波束近似结果，不能仅凭尺度公式宣称实际模态个数或严格截止频率。公式估计只作待核验的量级解释。

数值稳定性用 `evaluate_acoustic_checks(id, spec)` 核验共同掩码与 ROI；当前仅支持同频、同模型、同源/环境/归一化的 `refinement` NPZ，固定轴与必要元数据见共同协议。跨频效应与跨模型差异由研究脚本另存受控分析，不能直接送此工具，也不能借其 `stable` 认证。dB 算术平均与能量平均分开命名，平滑/排除零点说明规则和物理窗口。若浅层 ROI 尚不稳定或跨模型不一致，就限制该 ROI 的定量结论；全域或深层一致不能替代近表层验证。两级网格差异不等于真实误差界。

保存与问题相关的 ENV/FLP、脚本、PRT、数值和图；执行时声明实际 `inputs` / `outputs`，提交前只读 `audit_research_task(id)`。将 Agent 的 `authority: agent_self_report` 检查与程序 `scientific_validation` 单列。允许报告“本次设置未观察到稳健频率效应”或“现有证据不能判定”，不为得到预期正结果不断改变环境或把候选结构写成已证实波导。参考AT说明：https://oalib-acoustics.org/website_resources/AcousticsToolbox/manual/node63.html 。
