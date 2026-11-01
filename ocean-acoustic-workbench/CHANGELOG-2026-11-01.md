# 变更记录 · 2026-11-01

本文件记录自上次推送（`42319ce`，2026-10-26 00:03「README：更新简介与界面列表到研究 Agent 开发分支」）以来，`feature-research-agent` 分支上的 11 个提交。

---

## 一、稳定性

### 修复运行日志混合编码（`e4426b9`）

AT 的 `.prt` 与 stdout 中 UTF-8 / GBK 混排，原先整段解码会出现乱码。改为**按行容错解码**：先尝试 UTF-8，失败的行再退回 GBK。

- 新增 `backend/task_files.py::read_log(path, tail=None)`
- `backend/app.py`、`backend/research_api.py`、`backend/research_tasks.py` 统一走该函数

---

## 二、数值验证

验证结果全部追加进 `skills/at-environment/references/validation-latest.json`。

| 提交 | 算例 | 结果 |
|---|---|---|
| `93c0ee6` | 楔形基准 SimplePE vs RAM | 中位差 **0.54 dB**，p95 4.47 dB |
| `84a2949` | BELLHOP3D 自由场 | **−0.009 dB**（中位 0.001） |
| `84a2949` | SPARC 头部波到达时间 | **0.112 s vs 0.111 s** |

---

## 三、知识图谱扩充（`346d117`）

新增 23 个节点，引用 S21–S24 课件（波动方程 / 波数积分 / 简正波 / 抛物方程）。

新增节点：波数积分方法、深度分离方程、谱积分与 FFT、传播函数矩阵、SCOOTER、波动方程、积分变换、镜面法、Pekeris 波导、模态正交与完备、复围线/留数、WKB、Sturm–Liouville、微扰理论、近轴近似、Pade/广角 PE、初始场、分裂步进、吸收层、KRAKENC、SPARC、BELLHOP3D、KRAKEL。

| 指标 | 之前 | 之后 |
|---|---|---|
| 节点 | 53 | **76** |
| 边 | 126 | **180** |
| 知识点 | 46 | **69** |

`tests/check_local.py` 的断言同步更新。

---

## 四、交接文档（`876b009`）

新增 `HANDOVER.md`：仓库结构、启动方式、验证状态、已知限制。

---

## 五、对话工作台：独立会话

对应需求：「像 DSH 一样可以建立单独对话、分隔对话」。

| 提交 | 内容 |
|---|---|
| `671e3a6` | 新增会话列表：新建 / 切换 / 改名 / 删除。后端新增 `session_titles` 表与 `GET/PATCH/DELETE /api/research/sessions` |
| `e1a684b` | **修复改名/删除失效**：`api()` 原先按「有无 body」决定 POST/GET，PATCH/DELETE 被发成 POST → 405。改为显式传入 HTTP 方法 |
| `eaff985` | 会话列表从左侧独立栏移到右侧上下文框，恢复两栏布局 |
| `4ae1026` | 会话列表上移到「当前工作上下文」之上，成为右栏第一块 |

---

## 六、知识图谱页布局修复（`23b3ecf`）

| 问题 | 原因 | 修法 |
|---|---|---|
| 底部单元卡片被裁切 | `.course-overview` 位于 `overflow:hidden` 的 `.graph-stage` 内 | 给 `.course-overview` 加 `height:100%; overflow-y:auto` |
| 内容区底边比左栏高一截 | `.course-body` 高度为 `calc(100dvh - 386px)`，顶部实际只占 278px，多留 108px | 改为 `calc(100dvh - 300px)`，底部留 22px 边距 |

验证：1366×768 与 1920×1080 下左右两栏底边齐平；1920 下总览不需要滚动条（内容恰好放下）。

---

## 七、AT 版本一致性（`207ad69`）

**问题**：`E:\at\bin` 是 2018 版 exe，而 `E:\at\matlab2026` 是 2026 版 MATLAB 代码（`.moA` / 新 `.mod` 格式）。`addpath(genpath('E:/at'))` 会把两者一起加入，导致 2018 的 `.mod` 被 2026 读取器误读或报错。

**修法**：生成脚本时显式剔除 `matlab2026`，并把 `ReadWrite` 置顶：

```matlab
at_root='E:/at';
parts=strsplit(genpath(at_root),pathsep);
parts=parts(~contains(parts,'matlab2026'));
addpath(strjoin(parts,pathsep),'-begin');
addpath(fullfile(at_root,'ReadWrite'),'-begin');
```

技能文档同步要求加载后核对 `which('read_modes')` 与 `which('kraken.exe')`。

**验证**：85 个子目录剔除 15 个 `matlab2026`；`read_modes`/`read_shd` 指向 `E:\at\ReadWrite`；KRAKEN/Pekeris 端到端跑通（`.shd` 501 点，`finite_ratio=1`）。

---

## 八、改动统计

```
14 个文件改动，+2243 / −622
```

| 文件 | 变化 |
|---|---|
| `backend/data/course_graph.json` | +1947 / −609 |
| `HANDOVER.md` | +128（新增） |
| `backend/research_api.py` | +39 / −4 |
| `src/DialogueWorkbench.jsx` | +16 / −8 |
| `src/dialogue-workbench.css` | +26 |
| `backend/model_workflows.py` | +11 / −1 |
| `skills/at-environment/SKILL.md` | +9 / −1 |
| `src/graph.css` | +11 |
| `src/ocean-theme.css` | +4 / −2 |
| `skills/.../validation-latest.json` | +44 |
| `backend/task_files.py` | +17 |
| `tests/check_local.py` | +14 / −7 |
| `backend/app.py` / `research_tasks.py` | 各 +2 / −1 |

---

## 九、未纳入仓库的内容

`.gitignore` 已排除，确认未被跟踪：

```
.local/         数据库 workbench.sqlite3、任务运行目录 runs/、知识库注册表
dist/           构建产物
node_modules/  .venv/  *.log  *.key  .env
```

会话记录、研究任务产物、WOA18 数据索引均只在本地。

---

## 十、已知限制

1. **`.mod` 只含源深/接收深**：KRAKEN 按设计只在「源深 ∪ 接收深」处存模态（`kraken.f90` 的 `MergeVectors(Pos%Sz, Pos%Rz)`）。要画模态形状，需在 ENV 中把 `NRD` 设为密集网格。这不是读取器不兼容。
2. **2018 exe 与 2026 读取器不可混用**：需要 `.moA` 或新格式时，必须同时换用 2026 编译的 exe。
3. **长任务可能无报告收尾**：Agent 若在提交 `finish_research_task` 前结束一轮，任务会被标记为「未完成研究报告」，但产物仍保留，可继续整理。
