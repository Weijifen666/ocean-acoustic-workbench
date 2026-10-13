# 仿真与智能体开源方案调研

核查日期：2026-10-13。前半部分记录开源方案的研究与取舍，末尾记录 v0.4 已完成的项目实现与验证。此次完成了新的公网 MATLAB 任务；真实模型供应商付费调用仍未测试。

## 结论

保留当前已验证的 MATLAB / KRAKEN / FIELD 路径，借鉴开源项目的场景结构、工具输入输出、分层验证和评测记录。立即换成一个“全能声学智能体”会引入求解器、许可证和部署问题，未必改善课程作业的可靠性。最有价值的短期改进是让一次任务具有可核验的参数、来源、计算过程和结果证据，而不只生成图片。

## 读过的项目和真实许可证

| 项目 | 核查到的做法 | 对本项目的选择 | 许可证证据 |
| --- | --- | --- | --- |
| [weifengsd/acoustics-agent](https://github.com/weifengsd/acoustics-agent) | Environment / Geometry / Solver 分离；原生与外部 AT 比较；独立 benchmark 与 agent-oriented skills | 借鉴结构与验证策略。暂不换数值求解器，不复制 AT fixtures | [LICENSE：MIT](https://github.com/weifengsd/acoustics-agent/blob/main/LICENSE)；[THIRD_PARTY_NOTICES](https://github.com/weifengsd/acoustics-agent/blob/main/THIRD_PARTY_NOTICES.md) 单独指出所含 AT 示例受 GPL-3.0 覆盖 |
| [org-arl/arlpy](https://github.com/org-arl/arlpy) | `check_env2d` 在调用 BELLHOP 前检查海底、声速剖面、深度/距离覆盖范围及单调性 | 若将来开放自定义环境，可采用同样的数值约束；当前固定 Munk 无需新增依赖 | [真实 LICENSE：BSD 3-Clause](https://github.com/org-arl/arlpy/blob/master/LICENSE) |
| [TritonOA/TritonOA](https://github.com/TritonOA/TritonOA) | 新组织版定位海洋声学数据建模分析，但 README 明确 API 处于早期、不稳定 | 当前不接入，不因仓库名称相同就混用旧版 | [真实 LICENSE：BSD 3-Clause](https://github.com/TritonOA/TritonOA/blob/main/LICENSE) |
| [NeptuneProjects/TritonOA](https://github.com/NeptuneProjects/TritonOA) | 旧版本包含 AT / KRAKEN Python 交互，README 将 BELLHOP 写为未来功能 | 可读设计，不直接复制到现有 MIT 项目 | [真实 LICENSE：GPL-3.0](https://github.com/NeptuneProjects/TritonOA/blob/main/LICENSE)；与新组织版许可证不同 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 显式状态、checkpoint、恢复；节点重跑带来的幂等性要求 | 学习状态/事件结构；单机队列保持原实现。存在多阶段恢复需求时才加运行时 | [真实 LICENSE：MIT](https://github.com/langchain-ai/langgraph/blob/main/LICENSE) |
| [OpenHands Software Agent SDK](https://github.com/OpenHands/software-agent-sdk) | Action → Observation；工具 schema 与执行器分离；本地/远端 workspace | 借鉴工具契约，不将通用终端执行工具直接暴露给匿名访客 | [真实 LICENSE：MIT](https://github.com/OpenHands/software-agent-sdk/blob/main/LICENSE) |

所有代码复用应保留对应版权及许可证；“仅用于课程作业、无商业用途”是本项目用途说明，不会替代第三方许可证，也不会把 MIT 自动变成禁止商业使用的许可证。

## 具体源码核查：哪些好，哪些不能直接照搬

### acoustics-agent

读过 [schema.py](https://github.com/weifengsd/acoustics-agent/blob/main/pyacoustics/schema.py)、[config.py](https://github.com/weifengsd/acoustics-agent/blob/main/pyacoustics/config.py)、[architecture.md](https://github.com/weifengsd/acoustics-agent/blob/main/docs/architecture.md)、[validation.md](https://github.com/weifengsd/acoustics-agent/blob/main/docs/validation.md)、[benchmark runner](https://github.com/weifengsd/acoustics-agent/blob/main/pyacoustics/benchmarks/runner.py) 和三个 `skills` 入口。

可取的是把环境、源/接收几何和求解器分开，输出比较使用明确阈值，记录通过、失败、跳过，且把数值回归产物作为构建结果而非反复提交源仓库。其公布的 benchmark 数量是作者的参考证据，本研究没有重跑，不能写成我们的通过结果。

需要保留判断：`config.py` 的 `from_dict` 忽略未知字段，dataclass 类型注释不能替代 Pydantic 数值验证；`skills/make_env.py` 会补默认声速、海底声速、密度等参数；`skills/run_sim.py` 给出的简单 success 不代表所有物理和结果有效性均已校验。当前项目的固定模板、数值 JSON 和 ENV roundtrip 已经更严格，不应因为对方功能多就原样替换。

### arlpy

[uwapm.py / check_env2d](https://github.com/org-arl/arlpy/blob/master/arlpy/uwapm.py) 的范围覆盖、数组单调性、源与接收深度检查值得学习。其 BELLHOP 包装依赖外部求解器，安装 Python 库本身并不能获得所有运行能力。当前不用增加 BELLHOP 来假装已实现多模型；先把“只支持 Munk / KRAKEN”显示清楚。

### LangGraph 和 OpenHands

OpenHands 的[工具架构](https://docs.openhands.dev/sdk/arch/tool-system)将输入与观察结果用 Pydantic 明确定义。可在本项目中独立实现同样的接口：`preview_simulation(plan) -> validation + cases`、`get_simulation_result(job_id) -> measured data + provenance`，既可被网页调用，也可将来暴露给模型。

LangGraph [恢复/interrupt 文档](https://docs.langchain.com/oss/python/langgraph/interrupts)强调节点重跑时副作用要幂等。这说明“模型重试一下”不能等于重新提交一份 MATLAB 任务；未来自然语言 Agent 应在提交时使用稳定 request_id，返回已有任务而不是生成重复计算。

## 当前项目已有能力

已实际读取 `backend/app.py` 与 `backend/matlab/run_ocean_case.m`，其中已包含：

- Pydantic Plan，频率 10–200 Hz、源深 0–5000 m 以内、距离/网格上限、频率和源深去重。
- 固定 `munk_5000m`，不允许自由指定模型与任意 MATLAB 代码。
- 独立任务目录、队列、超时与取消、日志、MATLAB 返回码及结果文件检查。
- 修改 ENV 后重新 `read_env` 检查频率和源深，再运行 KRAKEN / FIELD。
- 读取 SHD，检查压力有限/非零、频率匹配，输出实际接收深度和网格偏差；近零压力产生的 TL 无效值被标记。
- 后端检查 TL 维度与有效值，保存 PNG / CSV / summary，并允许下载结果包。
- Agent 只提供授权文件列表和读取工具；没有自动修改项目或自然语言自动提交仿真的闭环。界面和文档应继续如实表述。

## 本轮可以立即落地的优先改进

### P0：严格任务与问题模板

将 `Plan` 提取到 `backend/simulation_schema.py`，使用 `ConfigDict(extra='forbid', allow_inf_nan=False)`，模板用 Literal；跨字段校验放在模型 validator，不依赖调用方额外记得 `checked()`。前端和模型工具从同一个 JSON schema 获取字段。保留现有 API 字段，避免重写全部界面。

可加“命题示例”而不宣称 LLM 已解析：50/100 Hz × 500/1000 m 源深比较；1000 m 接收深度、1–50 km 距离。每条示例具有目的、参数、需要读取的知识点和预期产物。用户点击后只填参数，仍预览再计算。

自然语言解析若本轮接入，应输出 `{plan, missing_fields, assumptions, unsupported_requests}`。明确单位换算；缺少关键参数或要求当前不支持的浅海/射线/自定义海底，不能默默用 Munk 替代，也不允许让模型提供原始脚本。可先实现单位清楚、模式有限的确定性解析；模型版本以后再接。

### P0：运行证据 manifest 和数值结果检查

每次任务写 `manifest.json`，记录 schema_version、job_id、template、solver='KRAKEN/FIELD'、提交/开始/结束时间、标准化参数、代码与 case.env/case.flp/result.json 的 SHA-256、MATLAB 版本、已执行的验证项及结果。路径只用相对文件名，不保存密钥、用户名或绝对本机配置路径。

结果验证新增：range/depth 严格递增、维度与请求点数相符、实际频率/源深与请求一致、接收点是最近网格点、curve 长度/数值与 TL 对应行一致、valid_ratio 与有效样本统计一致。可以先用已有 `result.json` 验证器补 manifest，不一定为它重新运行 MATLAB。

`valid_ratio` 低时应提供明确警告/拒绝阈值；阈值是本应用的工程门槛，不是普适海洋声学定律。不要断言相干 TL 曲线必须随距离单调增长，干涉会使这种验收误判。

### P1：结果解读基于真实数据

给问答加入只读 `get_simulation_result`：拿到该用户拥有的 job_id，提供 manifest、统计量和曲线抽样。回答应把实测数值、模型假设、课程解释分开，引用任务编号；任务失败或未完成时不能编造结论。LLM 不需要获得所有二维矩阵，更无需获得主机本地路径。

可先实现确定性的分析卡：实际/请求接收深度差、有效样本比例、TL 中位数/范围、该接收深度曲线最低 TL 对应距离；标注这是当前曲线的数值特点，不等于声道轴、最佳通信距离或测得的海域事实。

### P1：错误修复边界

把失败原因结构化为 `INPUT_INVALID` / `ENVIRONMENT_MISSING` / `SOLVER_FAILED` / `TIMEOUT` / `RESULT_INVALID`，保留日志和最近 OCEAN_STAGE。参数错误在提交前返回；缺 MATLAB/AT 提供安装检查；求解器失败展示真实日志。不能自动修改海底、频率、网格以“修到成功”。

模型可以解释失败并建议下一步，用户调整参数后才产生新的任务。已有取消和超时机制应保留，不需要为了模拟 Agent 自动修复而开放任意终端执行。

## 可立即加入仓库的评测题目

以下为新编的课程场景，不是复制受版权保护的教材题目。每题应有 id、输入、预期规则和通过证据。

| 类别 | 输入/场景 | 验收 |
| --- | --- | --- |
| 单位 | 1–50 km 与 1000–50000 m 两种表达 | 标准化 plan 相同 |
| 扫参 | 50、100 Hz；源深 500、1000 m | 正好 4 个 case，无重复 |
| 缺参 | “分析某海域传播损失”，无环境资料 | 返回缺失条件，不能说使用了真实海域 |
| 越界 | 源深 5000 m、频率 1 kHz | 422 / 明确当前模板范围 |
| 未支持 | 请求 BELLHOP 射线、浅海 100 m 环境 | 拒绝或明确尚未支持，不能套 Munk |
| 非有限 | NaN、Infinity、字符串数值意外类型 | schema 明确校验，不能进入求解器 |
| 输出轴 | TL 转置但坐标数组不变 | 结果验证失败 |
| 输出来源 | frequency_hz 与任务不同 | 结果验证失败 |
| 网格取点 | 请求 1001 m，网格为 20 m 间隔 | 实际 1000 m，误差 1 m，明确显示 |
| 无结果 | FAILED / TIMEOUT 任务要求总结“成功结果” | 如实解释失败，不能报告仿真结论 |
| 工具隔离 | 用户 A 请求用户 B 的结果 | 404 / 禁止读取 |
| 重试 | 同一 request_id 重交（未来 Agent） | 只创建一次任务 |

CI 可以运行 schema、数值结果 fixture 和权限测试；真实 MATLAB 计算应单独作为可选集成检查，不把没有计算节点的 GitHub Actions `skipped` 说成通过。模型答案评测需要真实 API Key 才能运行，离线检索或 mock tests 不能替代真实模型评测。

## v0.4 已完成的实现

`app.py` 已接入严格 Plan 校验、`backend/science.py` 的结果检查与分析、课程命题 API，以及新任务的 `manifest.json`。前端读取对应参数预设、结果数值卡与验证记录；这些功能已经进入实际计算链路，不只是设计建议。

- Plan 拒绝未知字段、非有限值、布尔和不合类型的字符串输入；频率/源深去重，保留固定模板及范围约束。
- `verify_result(result, plan)` / `validate_result` 检查轴、范围、网格、TL 尺寸、实际频率/源深、最近接收深度、曲线对应行和有效比例。
- `analyze_result(result, plan)` 从本次实际产物计算 UI 数值卡，并保留归一化、采样和相干场解释限制。
- `compare_results(a, b, plan_a, plan_b)` 检查完整网格、归一化、实际接收深度和有限样本集合。频率/源深可作为明确控制变量；不会产生海域排名。
- `build_manifest` / `write_manifest` 计算输入、脚本和产物 SHA-256，记录测得参数及实际版本字段，不复制密钥或绝对主机配置路径；未知外部求解器版本写 `null`。
- `backend/data/exercises.json` 提供 12 道课程命题：9 道可填仿真参数，3 道用于缺参、未支持工具和近零压力解释。预设不包含预先编造的 TL 结果，点击填入后仍需预览和确认计算。

`tests/test_science.py` 的 22 项离线测试通过，覆盖转置、错误坐标、曲线脱离 TL 行、虚假频率、无效样本、不同采样条件、manifest 哈希、密钥排除与未知版本明确标识。另对 8 份历史 `result.json` / `case.json` 做过只读一致性检查，没有为该历史检查重跑 MATLAB；历史通过不代替新的集成执行。

2026-10-13 公网新任务 `b57314c86c32` 已实际完成 MATLAB R2024a / KRAKEN / FIELD 计算。频率 50 Hz、源深与接收深度 1000 m、距离 1–10 km、网格 `[101,101]`；18 项产物检查通过，有效样本 10100 / 10201，manifest 文件及 ZIP 下载成功。其统计取自真实 `result.json`，详细数值与本次全部 51 项离线检查见 [v0.4 验证记录](VALIDATION_V0_4.md)。

这些结果证明本次计算链路和产物一致性已经接通，不证明求解器数值收敛、真实海域校准或模型回答质量；真实供应商付费模型调用未测试。

## 仍未实现的后续范围

自然语言到 Plan 的模型闭环、模型工具提交幂等、多环境/多求解器、MATLAB 迁移至独立常驻计算主机、自动修改访客本机 MATLAB 项目仍需单独实现和实际验证。通用 OpenHands / LangGraph 运行时没有因本次界面改版而安装或成为现有依赖。
