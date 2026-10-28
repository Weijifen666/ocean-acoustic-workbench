# 交接说明 · 海洋声学工作台（研究 Agent 分支）

交接日期：2026-10-28。本文记录当前实现状态、运行方式、已验证与未验证事项，便于接手人继续开发。所有数字均来自本机实际运行，未做云端模型调用的性能评测。

## 一、项目概况

海洋声学工作台是一个把「课程知识 → 海洋环境数据 → 声场仿真 → 结果核对 → 研究报告」串起来的研究型 Web 平台。它从最早固定表单的声场计算，演进为可由 Agent 自主规划、执行 MATLAB/AT 脚本的研究工作台。

- 代码目录：`work/ocean-acoustic-workbench-latest/ocean-acoustic-workbench`
- 远程仓库：`https://github.com/Weijifen666/ocean-acoustic-workbench.git`
- 当前分支：`feature-research-agent`（本地领先远端 4 个提交，**尚未推送**）
- 运行方式：本机网页，后端 `127.0.0.1:8766`，前端 `127.0.0.1:5173`

## 二、当前状态

### 2.1 功能模块

| 模块 | 状态 | 说明 |
|---|---|---|
| 知识图谱 | 可用 | 6 章 76 节点 180 边，69 个知识点 |
| 课程知识检索 | 可用 | BM25 + 图谱上下文 + 公开海洋资料 |
| 对话工作台 | 可用 | DSH / 本机 Codex / 模型 API 三种后端 |
| 海洋环境数据 | 可用 | WOA18 温盐声速 + ETOPO1 地形 |
| 声场仿真 | 可用 | 9 类模型经验 + 手动表单 + 12 个研究技能 |
| 任务与结果 | 可用 | 仿真任务与研究任务统一列表 |
| 项目文件 | 可用 | 按用途浏览 |
| 模型与环境设置 | 可用 | 含 API Key 配置（不回显明文） |
| 运行日志 | 可用 | 已修复 MATLAB(GBK)+Python(UTF-8) 混合编码 |

### 2.2 模型接入（9 个，8 个有可用基线）

| 模型 | 配方 | 独立验证 |
|---|---|---|
| KRAKEN | 可用 | 自由场 + Pekeris 跨模型（0.000 dB） |
| KRAKENC | 可用 | Pekeris 跨模型（与 KRAKEN 0.000 dB） |
| SCOOTER | 可用 | 自由场 vs 解析解（0.000 dB） |
| BELLHOP | 可用 | 自由场 vs 解析解（0.000 dB） |
| BELLHOP3D | 可用 | 自由场 3D vs 解析解（中位 -0.009 dB） |
| RAM | 可用 | 楔形 vs SimplePE（中位 0.54 dB） |
| SimplePE | 可用 | 楔形 vs RAM（中位 0.54 dB） |
| SPARC | 可用 | 头部波到达时间（0.112 s vs 理论 0.111 s） |
| KRAKEL | **无基线** | 弹性走 MATLAB `krakelM.m`（Ahmad 算例），Fortran `krakel.exe` 仅流体冒烟通过 |

### 2.3 知识图谱

- 结构：6 章（声学基础 / 海洋环境 / 声传播方法 / AT 仿真流程 / 结果分析 / 观测与应用），76 节点、180 条有类型关系（hierarchy 75 / related 75 / prerequisite 30）。
- 本轮新增 23 个节点：波数积分链（波数积分、深度分离、谱积分与 FFT、传播函数矩阵、SCOOTER）、理论层（波动方程、积分变换、镜面法、Pekeris 波导、模态正交、复围线留数、WKB、Sturm-Liouville、微扰、近轴、Pade、初始场、分裂步进、吸收层）、工具层（KRAKENC、SPARC、BELLHOP3D、KRAKEL）。
- 来源：S01–S20 原有资料 + **S21–S24 四份课件**（波动方程 / 波数积分 / 简正波 / 抛物方程，共 182 页入库）。

### 2.4 算例与验证

- 算例族：31 个，全部至少执行 1 例（审计 8 + P0 5 + P1 18）。
- 验证记录：`skills/at-environment/references/validation-latest.json`，含 `p0_2026_10_25`、`p1_2026_10_25`、`p2_2026_10_25_elastic`、`p3_2026_10_26_validation`。
- 关键结论：自由场 BELLHOP/SCOOTER 与解析解中位 0.000 dB；Pekeris KRAKEN/KRAKENC 0.000 dB；楔形 SimplePE/RAM 中位 0.54 dB；弹性 5 例通过。

## 三、怎么跑起来

```powershell
cd work/ocean-acoustic-workbench-latest/ocean-acoustic-workbench
.\.venv\Scripts\python.exe .local\launch_workbench.py
```

- 后端：`uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8766`
- 前端：`node node_modules/vite/bin/vite.js --config .local/vite-shortcut.config.mjs`（5173，代理 `/api` 到 8766）
- 依赖：Python 3.11（`.venv`）、Node（`E:\Node`）、MATLAB R2025b、AT 工具箱 `E:\at`
- 启动器会复用已在运行的实例，不会重复拉起。

## 四、关键文件与路径

| 用途 | 路径 |
|---|---|
| 知识图谱数据 | `backend/data/course_graph.json` |
| 知识检索 | `backend/knowledge.py`、`backend/retrieval.py` |
| 研究 Agent 任务 | `backend/research_tasks.py`、`backend/research_api.py` |
| 模型配方 | `skills/at-environment/references/creation-workflows.json` |
| 模型说明 | `skills/at-environment/references/models.json` |
| 验证记录 | `skills/at-environment/references/validation-latest.json` |
| AT 工具箱 | `E:\at`（12 个 exe；`E:\at\matlab2026` 含 277 个 .m） |
| 课件来源 | `C:\Users\ASUS\Desktop\chores\课程\专业课\现代海洋声学` |
| 运行数据 | `.local/`（已被 gitignore，含 `kb/` 页索引、`runs/` 任务目录） |

## 五、已完成

1. 9 个模型接入并各有独立验证证据；31 个算例族全部执行。
2. 运行日志混合编码修复（UTF-8/GBK 按行容错解码）。
3. 知识图谱从 53 节点扩到 76 节点，新增波数积分链与理论层，并补「理论→工具」映射边。
4. 四份课件注册为 S21–S24 并入库（182 页）。
5. 弹性模型改走 MATLAB `krakelM.m` 路径跑通（Ahmad 算例）。

## 六、未完成 / 待办

| 优先级 | 事项 | 说明 |
|---|---|---|
| 高 | 推送 4 个提交 | 直连 GitHub 被阻断，需用 GitHub Desktop 推 `feature-research-agent` |
| 高 | KRAKEL 技能回填 | 模型卡仍写「无基线」，需把 MATLAB 路径写入技能 |
| 中 | 楔形三方对照 | 补 KRAKENC 耦合模态解，做 SimplePE/RAM vs 耦合模态 |
| 中 | 图谱 ID 截断修复 | `spherical_spreadin` 等旧 ID 被截到 18 字符 |
| 低 | 课件来源提交 | `.local/kb` 被 gitignore，换机器需重新入库 |
| 低 | 报告「三层结论」字段化 | 执行/数值/物理三层结论尚未固化为字段 |

## 七、已知问题与坑

1. **工具链版本必须成对**：新版 `field.exe` 配旧 `kraken.exe` 会报 SHDFIL 版本错误；`E:\at\bin` 保留旧 `field.exe`，新 `field.exe` 只给 KRAKEL/MATLAB 路径。
2. **MATLAB 输出是 GBK**：中文 Windows 下 `toc` 输出「历时 X 秒」为 GBK，Python 脚本是 UTF-8，日志会混合编码；已用按行容错解码，但根因未改。
3. **SCOOTER 的 `RAMtoSHD.m` 有硬编码旧路径**（`F:\MATLAB\...\tl.grid`），不要直接调用；RAM 输出用 `read_ram_tlgrid()` 读 `tl.grid`。
4. **穿透楔形没有闭式解析解**：文献里的参考解是**耦合模态**（Evans 1983；Jensen & Ferla 1990），AT 的 `tests/wedge` 就是用 KRAKENC 耦合模态做参考。
5. **`krakelM.m` 要求 V/R 边界**：弹性场后处理需匹配新 `read_shd`（`E:\at\matlab2026`），旧 `read_shd` 不认 `.mod.mat`。
6. **`.local/kb` 不入库**：课件注册和页索引是本地运行时数据，clone 后需要重新入库。

## 八、如何验证（接手人自检）

1. 启动后访问 `http://127.0.0.1:5173/`，确认知识图谱显示 76 节点。
2. 检索「波数积分」「SCOOTER」，应命中新增节点。
3. 打开「任务与结果」，确认运行日志中文正常、无 `�`。
4. 跑一次 Munk 仿真，核对 TL 图与日志。
5. 检查 `validation-latest.json` 的 p3 记录与本文数字一致。

## 九、交接清单

- [ ] 确认本机 `E:\at`、MATLAB R2025b、`.venv`、`E:\Node` 均可用
- [ ] 用 GitHub Desktop 推送 `feature-research-agent` 的 4 个提交
- [ ] 决定是否把 `S21–S24` 课件随仓库分发（涉及课件版权）
- [ ] 确认 KRAKEL 是否补基线，还是保持「MATLAB 路径」说明
- [ ] 决定是否补楔形三方对照（KRAKENC 耦合模态）

## 十、一句话总结

平台功能与验证链条已完整：9 个模型有配方、31 个算例族有执行、9 个模型有独立验证证据；剩余工作集中在**推送代码、回填 KRAKEL 技能、补楔形耦合模态对照**三件事上。
