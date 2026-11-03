# API、Harness 与本项目的领域 Skill

核对基线：GitHub main `4b788c176b4de727af5a307acf9eb94a73758bdd`；本次功能验收日期：2026-11-03。以下区分源码事实、实际运行与架构建议，没有把单次成功当成模型排名或 A/B 试验。

## 当前接入的是哪一种

两种都已接入，但属于不同入口：

| 入口 | 调度方式 | 模型配置 | 执行范围 |
| --- | --- | --- | --- |
| 本地完整应用的研究代理 | 默认 DSH；可切换本地 API 循环或 Codex | DSH 用自己的模型和凭据；API 用工作台配置 | 授权本机的教材、环境数据、研究目录、Python/MATLAB、模型配方与程序检查 |
| 公共网站的研究代理 | 用户 API + 云端研究循环 | 本人的供应商、模型及 Key | 公开资料、在线海洋数据、限定诊断及在线节点的三模型表单 |

11 月 1 日的 `2e32b32` 合入了 `backend/dsh_bridge.py`、启动补丁和桥接测试。仓库提供的是接入代码；DSH 运行时、模型权重、凭据与 MATLAB 安装不随 GitHub 分发。

本地 DSH 路径经 ACP 驱动外部进程，通过一次请求期间的 loopback MCP 挂载工作台工具。工作台模型设置不会自动修改 DSH 的模型选择。原生 shell、文件系统、subagent 和 workflow 入口在启动补丁中关闭，研究执行走工作台已注册工具。

## Skill 的实际价值与适用范围

仓库中的 12 个 Skill 包含 AT 环境构造、季节层结诊断、表面声道研究和九类求解器资料。它们提供适用条件、ENV/FLP 输入协议、经典配方、程序脚本及结果检查规则，不是新的模型权重，也不是 DSH 专有格式。

本地研究服务将同一份工具注册给 DSH、本地 API Agent 和 Codex。`list_research_skills`、`load_research_skill`、`read_skill_resource` 将资料按需交给模型，并非仅在某一个 Harness 中自动生效。完整研究还需要真实可执行工具：`prepare_model_research_task`、`run_research_script`、`diagnose_ocean_layers`、`evaluate_acoustic_checks` 和 `audit_research_task`。没有工具权限时，仅有 Skill 文字不能完成相同任务。

11 月 2 日新增的科学工具可复用标准位温/位密度诊断、冻结输入与实现哈希、区域共同有效掩码和任务审计，并将 Agent 自评与程序检查分开。本地 API 也能调用这些工具；公网尚未开放这些完整本机权限，不能把公网 API 与本地 DSH 的功能差异直接称为模型性能差异。

本次发现并修复了实际接入问题：DSH 新版桌面包布局不兼容旧启动器；已有运行目录的教材索引未被部分研究工具读取；`.m` 技能资源不能读取；大份 casebook 无分页会超过本地 API 输入预算。资源现按 UTF-8 字节分页，片段带完整文件哈希和下一字符位置，可按需续读。

## 如何理解“性能更高”

API 是调用模型的接口，Harness 管理会话、模型调用与工具执行。DSH 本机运行不等于 DeepSeek 权重在本机推理。官方模型配置文档明确支持 DeepSeek API Key、第三方模型供应商和自托管模型接口；同一 Harness 可以使用不同模型。

同模型、同推理设置下，Harness 不会自动改变模型权重；但工具接口、上下文整理、失败反馈、重试和停止策略会改变任务完成率、耗时和 token 成本。本项目 API 路径也有工具循环，不能把它等同于普通单次聊天。

本次用现有 DSH 配置做了一次受限只读实测：实际路由 `deepseek-v4-flash`，真实完成列出并加载 `at-environment` 技能，约 11.94 秒后返回中文回答，未执行仿真脚本。这证明当前接入可用，不证明它胜过相同模型的 API 调度。没有有效且可比的直接 API 实测前，不发布两者的性能排名。

另做了实际模型驱动的“加载季节诊断 Skill → 创建任务 → 单点年平均诊断 → 归档 → 审计”验收，限定工具与时限，未注册任意脚本或声场执行器。第一次约22.52秒后由上游返回服务繁忙；同模型重试实际完成列出、加载技能后未继续创建任务，180.16秒按上限停止。两次均无任务与归档，监督程序没有替模型完成任何步骤。这条自主闭环本轮未通过，不能用直接执行器的成功替代 Agent 端到端成功。两次失败也不构成模型性能排名。

本地 API 已补完整工具轮历史、文件分页和明确的失败终态，但没有本轮有效付费 Key 的真实对照结果。公共应用的不限预算仍受模型窗口及每条运行/累计会话的900000 UTF-8字节载荷上限约束；达到容量后保留既有会话与检查点，报告失败，不宣称无限记忆。

公平比较应固定模型版本、推理设置、Skill/工具、教材、海洋数据、MATLAB、任务输入和成本/时间上限。至少覆盖资料引用、四季层结、基线声场、错误修正、缺测拒绝与中断后不重复计算，按真实文件和数值检查评分，而不是按回答长度评分。

## 对四人课程项目的建议

这是依据当前实现与验收结果作出的工程建议：完整仿真研究优先保留并跑通本地 DSH 路径；多人浏览、个人 Key 和受限公开工具继续使用云端 API 路径。两者复用领域工具和证据格式，避免为不同入口维护两套物理算法。若将来要让多人从网页运行完整研究，应另做受信任的研究节点、身份/任务隔离、队列和用量控制，而不是直接公开某个人的 DSH 桌面服务。

“Skill 适合本地研究”有现实依据：文件、求解器和完整验证工具当前在本机。“Skill 只能由本地 Harness 使用”则不符合本仓库实现。优先验证这套领域流程是否真的完成研究，再依据同条件实测选择调度器。

## 查证来源

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)：插件架构及 developer preview 的兼容性边界。
- [DSH 官方模型配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)：供应商、Key、自定义接口与模型选择。
- [DSH 官方 ACP 协议](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md)：持久会话、MCP 与自动化接口。
- [DeepSeek 官方 Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)：工具调用中的供应商协议字段要求。
- [Anthropic：Building effective agents](https://www.anthropic.com/research/building-effective-agents)：工作流、Agent 与复杂度取舍；该文有历史发布时间，不能替代当前产品规格。
- [Finding the Right Fit: Model-Harness Interactions across Agent Tasks](https://arxiv.org/abs/2610.00917)：公开预印本的组合评测，不是海洋声学验证，也不能代替本项目同条件对照。
