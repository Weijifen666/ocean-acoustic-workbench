# 本地增强与公共工作台同步

本说明记录当前源码的同步方式和边界，不代替部署回执或真实求解验收。GitHub 合并、构建成功、站点发布和计算节点在线是四件分别验证的事。部署版本及最终线上结果由维护者另记，不能从历史算例记录推定。

站点原有 `GATEWAY_SECRET` 同时用于已有用户记录的加密，升级时应保留。新的计算节点可另设服务端秘密 `COMPUTE_BRIDGE_SECRET`，仅用于桥接认证与 RPC 加密；节点私有 `public-runtime.json` 的 `gateway_secret` 与它匹配。未设置独立桥接密钥时兼容旧 `GATEWAY_SECRET`。两者都不得放入前端、GitHub、安装示例或运行日志。启动公共计算节点会允许经网关限额和任务归属校验的网页请求使用节点算力，应由节点维护者明确启用；网页发布不要求节点同时在线。

## 两个应用和一个资料来源

`ocean-acoustic-workbench/` 是有本机权限的完整应用，`ocean-acoustic-public/` 是云端适配应用。公共版采用对话工作台、模型经验、三模型参数页、任务结果、分类文件和图谱的增强布局；保留已有云端账户、模型配置/Key、会话与共享课题协议。公共设置不编辑访客或维护者的 MATLAB、本机目录；DSH/Codex 选项不可选择，任意 Python/MATLAB 执行、全局队列管理和打开本机目录也不向公共访客开放。

图谱和研究资料以本地应用的源码为维护来源：

```text
本地 backend/data/course_graph.json + skills/
                  ↓ scripts/generate-public-research.mjs
公共 data/graph.json + research-*.json + skills/ + 共享文件快照
                  ↓ public/build-worker.mjs
前端静态资产 + Worker 内嵌资料包
```

生成器采用明确的资源清单，处理本机绝对路径、加入历史/公共适用范围说明，并保存来源哈希。当前图谱为 69 个知识点、180 条关系；12 个 Skill、9 类模型经验、8 个支持的经典配方分别展示。KRAKEL 仍是未开放基线创建的条目；八个配方也不表示当前节点已经可运行八种模型。历史运行、当前程序可用、数值收敛与物理精度需要不同证据。

生产构建会先调用生成器，再构建前端和 Worker。**不要手工维护两份生成图谱或 Skill**：在本地来源修改后重建，审查生成差异。公共 UI 是协议适配版，不直接覆盖 `account`、`chat-session`、`ModelPanel` 等云端组件；新增本地功能时要同步检查公共能力限制、所有权与接口。海洋数据组件保留仓库内的共享引用，因此部署时需要完整仓库结构，不能只上传 public 子目录。

## 更新和验证

在仓库根目录执行：

```powershell
npm.cmd --prefix ocean-acoustic-public ci
node scripts/generate-public-research.mjs
npm.cmd --prefix ocean-acoustic-public test
npm.cmd run build
git diff --check
```

`npm run build` 本身也会重新生成资料。显式生成命令用于开发时预览变更，特别是准备启动前端开发服务器之前。构建入口为 `scripts/build-cloud-site.mjs`，最终产物为根目录 `dist/server/index.js`，D1 迁移也由该入口准备；部署步骤继续见 [DEPLOYMENT.md](DEPLOYMENT.md)。源码合并不会自动覆盖已发布站点。

审查生成结果时至少检查知识点/关系数量、12 个技能标识、历史范围标记、来源哈希及公开路径；不应混入 `.local`、对话数据库、原始教材、完整海洋数据包或站点凭据。UI 回归 `unified-ui.test.mjs` 检查默认 API Agent、40 轮默认值、禁用 DSH/Codex、离线执行限制、任务按钮和分步请求顺序。构建与模拟测试不能代替有效模型账户、节点或真实求解器运行。

## 公共研究请求怎样执行

公共版默认使用用户自己的模型 API。`POST /api/research/chat` 以请求标识创建研究请求；`POST /api/research/runs/ID/step` 在服务端租约保护下推进一次模型决策及其允许的工具调用；`GET /api/research/runs/ID`、history、active 和 sessions 只读取状态。

前端按 capabilities 的 `execution_mode=poll_steps` 工作：先 POST step，再 GET 状态，上一轮未完成时不并发推进。网络断开后继续同一个 run，不自动重新 POST chat。请求标识、step 租约与任务幂等机制共同避免误重放。默认 40 轮，当前可设置 0–1000；0 为不限，重复调用防护、停止与服务资源限制仍有效。停止 Agent 回答与取消已经提交的声场任务分别操作。

### 对话中的任务产物导出

研究 Agent 可通过 `list_job_artifacts` 列出本人任务的真实文件，通过 `export_job_results` 提供结果包与单文件下载入口。工具先沿既有访客归属链读取实际任务详情，不把模型给出的任务号直接当成访问授权；回答下方的下载卡片与会话历史一起保存。下载链接仍由当前登录或访客身份鉴权，没有公开对象地址或密钥。导出不提交新的计算，也不把 ZIP、图片或其他二进制塞进模型上下文。

结果包沿用任务页的同源接口，在用户点击时即时打包；Agent 取得入口不等于文件已下载、永久 ZIP 已生成或内容已校验。运行中的文件只是部分快照，失败任务也能导出已有日志。单文件只为网关支持的实际文件名提供链接。未归档的诊断 JSON 仍不能冒充任务文件；开放研究生成 PNG/CSV/报告的完整脚本执行链，需要对应执行工具支持，不能由 Skill 文字替代。

### 上下文预算与失败请求恢复

研究页默认把空间留给回答：研究设置、聊天管理、模型技能与问题库按需展开；“会话与资料”可打开右栏，窄屏以抽屉显示。输入、运行状态、停止、错误及预算恢复入口保持可见。设置区域有独立滚动范围，展开辅助内容不会要求整页向下寻找输入框。

研究页的“上下文预算”默认自动 32K，支持 4K、8K、16K、32K、64K、128K 与“不限应用预算”；选择值作为 `context_budget` 实际发送到研究接口，不限对应字符串 `unlimited`。工具轮数的 0 只表示不限轮次，与上下文预算分别设置。有限预算采用 UTF-8 字节的保守估算，并计入系统说明、资料、工具定义及保留的工具历史；不是供应商的精确 token 计数、模型原生窗口或 KV cache 设置。浏览器的可见文字估算尚未包含这些服务端内容，应结合运行记录中的完整估算判断。

`unlimited` 取消应用按累计输入估算触发的裁减和拒绝，不再为了该预算省略旧历史或初始检索资料。源码分页、目录分页、任务字段投影和数值摘要仍会执行，片段与完整文件的边界也保持明确。模型服务自身的上下文窗口、请求大小和输出限制仍然有效；不限应用预算不保证供应商接受任意长度请求。默认 `auto` 仍是 32K。Python 的 `backend/context_budget.py` 同步支持该值，当前本地 UI 和 Chat 配置选项不因此扩展。

长研究通过源码分页、工具结果的字段投影/数值摘要，以及按完整工具调用轮整理历史来控制输入。省略旧历史时保留调用与结果的配对关系；数值摘要只代表所列指标，不能当作完整剖面、全网格或全部源码，必要时重新读取对应文件或数据。这里没有额外付费调用另一个模型来压缩内容，也不把省略的历史伪装成已完整提供给模型。

运行记录的 `context` 返回所选预算、整理前后输入估算，以及 `compacted_tool_messages`、`dropped_tool_messages`、`dropped_history_messages` 和 `notes` 等说明。不限时输出 `budget_tokens: null`、`budget_limited: false`，有限预算输出对应数值与 `budget_limited: true`；内部比较使用的无限值不会序列化为 JSON `Infinity`。前端展示服务端估算及已记录的整理/省略信息；实际供应商用量与估算仍需区分。

若已有请求因 `CONTEXT_BUDGET_EXCEEDED` 失败且标为 `recoverable=true`，页面停止自动推进，允许修改预算并点击“调整预算并继续”。可以选择较大预设或 `unlimited`；后者仅解除应用阈值。该操作只向原请求 `POST /api/research/runs/ID/resume`，携带新的 `context_budget`，恢复同一个 run；随后再按正常 step 流程继续。恢复接口本身不调用模型，不重新提交用户问题或已提交的声场任务。旧失败请求也按这一方式恢复；不能用新建同参数任务来替代预算调整。若仍达到模型服务限制，应缩小读取范围或采用分页，不能宣称研究已经完成。

以上是当前源码的策略与交互说明，具体部署版本和生产恢复结果须另行验收记录。

Skill 提供流程、文件格式和验证指导；工具执行以本次已注册能力为准。公共研究可以查询真实 WOA18 剖面、读取共享资料，并用专用诊断工具处理单点四季温度阈值混合层与候选表面声道。当前诊断不计算密度 MLD，不将气候态称为实时实测，也不将一点替代整个区域。任意脚本、完整 DSH/Codex 和所有模型的自由环境创建没有因此上线。

## 三模型仿真与结果操作

`/api/workbench/capabilities` 决定实时节点状态；公共设置保留个人 Key 隔离，研究/任务请求按当前用户归属处理。

- KRAKEN、SCOOTER、BELLHOP 使用 `/api/simulation/plans/preview` 和 `/api/simulation/jobs`，由已授权的专属节点执行。节点不可达时页面禁用检查/提交，返回错误不能伪装成计算完成。
- 公开场景还受每批数量、模型组合、参数范围及环境有效性限制，实际检查结果为准。WOA18 水深、有效层和缺测不允许外推；海底介质参数仍是显式假设。
- 任务页保留本人任务的日志、图表、下载和导入对话；节点允许时删除本人任务文件，活跃任务不可直接删除。公共站没有全局暂停队列按钮。
- “打开文件所在位置”属于本地管理动作；公共站改为在线文件列表和下载，不能让服务器打开资源管理器来冒充访问者的本机目录。

## 专属本地节点的独立运行目录

维护者需要自备获授权的 MATLAB/AT、Python 依赖和节点连接配置。以下只是自定义端口/运行目录的启动方式，不包含个人路径或凭据。在 `ocean-acoustic-workbench/` 执行前，先在选定的私有运行目录准备自己的 `config.json`、`kb/source_registry.json` 和 `public-runtime.json`；连接文件包含的凭据须与该站点配置匹配，不能提交到 Git。

```powershell
New-Item -ItemType Directory -Force .local/public-node | Out-Null
$env:OCEAN_RUNTIME_DIR = (Resolve-Path .local/public-node).Path
$env:OCEAN_PRIVATE_URL = 'http://127.0.0.1:8767'
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8767
```

保持该后端运行，在另两个终端设置相同的 `OCEAN_RUNTIME_DIR` 和 `OCEAN_PRIVATE_URL` 后分别启动：

```powershell
.\.venv\Scripts\python.exe backend/public_gateway.py
```

```powershell
.\.venv\Scripts\python.exe backend/cloud_bridge.py
```

默认受限访客网关监听 `127.0.0.1:8780`，应避免重复启动同端口。桥接主动连接云端，不需要把本地管理 API 直接暴露到互联网。`init_public_runtime.py` 默认在应用 `.local` 初始化私有连接文件；使用自定义运行目录时要由维护者将自己的连接文件放入所选目录，不可假定该初始化工具已支持环境变量。

`start-public.ps1` 支持上述运行目录和自定义后端端口：后端地址依次读取 `OCEAN_PRIVATE_URL`、私有连接配置中的 `private_url`，缺省为 `http://127.0.0.1:8765`。它会复用通过研究接口检查的既有后端，验证网关密钥，避免重复启动本应用桥接进程，并等待线上心跳。`-CheckOnly -NoBrowser` 只做配置与本机健康检查，不启动进程。`-VerifySimulation` 在连接后调用 `scripts/check-public-node.py --simulate`，用小型 KRAKEN 算例检查提交、实际计算、数值与下载链；没有连接时不把离线检查当作真实计算成功。

在 Windows 中，可双击应用目录下的 `启动并验证线上计算节点.cmd`。私有连接配置和 Python 路径需事先准备；本脚本不会为缺失凭据自动生成替代值，也不修改站点加密密钥。检查报告与验收访客 Cookie 保存在私有运行目录，不提交到 Git。日常只需连接时使用原 `启动公网计算节点.cmd`，不会因此每次启动新的算例。

`OCEAN_RUNTIME_DIR` 控制应用任务/连接状态等运行数据，不代表所有历史模块的缓存路径都已完全隔离。授权资料、模型配置档和既有知识索引仍需按各模块实际路径核查；不要整体复制另一个人的 `.local` 或聊天数据库。

## 复用已经发布的海洋数据

如果部署公共站时不希望重新上传相同数据，可以在**云端 Worker 运行环境**设置：

```text
OCEAN_DATA_REMOTE_URL=https://your-data-site.example.chatgpt.site
```

以上为示例地址，使用时替换为自己已发布的数据站点。当前处理器仅接受不同于本站的 HTTPS `*.chatgpt.site` 站点源地址，不带路径、端口、查询或凭据。它将 `/api/ocean-data` 请求转交该服务，保留查询、版本及错误诊断，不转发访客 Cookie 或模型 Key。这个变量属于服务端部署配置，不是浏览器需要填写的模型 Key，也不是本地原始数据目录；修改配置后仍要按部署流程使之生效。

本地 Python Agent 的云数据读取使用另一个变量 `OCEAN_DATA_URL`，见 [CLOUD_OCEAN_DATA.md](CLOUD_OCEAN_DATA.md)。两者分别服务于公共 Worker 和 Python 读取器，不能混用。已发布数据能否查询以在线 `available/version` 与剖面响应为准；数据可用不证明 MATLAB 节点在线，也不证明声场已经执行。

## 发布后应补充的证据

由维护者另行记录真实部署版本、站点地址、个人空间/Key 隔离、Skill 读取和实际数据工具调用、节点离线降级、连接后声场输入与产物验证。若没有有效付费 Key、没有运行某个求解器或没有连接节点，应逐项写明未验证，不能用前端截图、历史算例或测试夹具代替。
