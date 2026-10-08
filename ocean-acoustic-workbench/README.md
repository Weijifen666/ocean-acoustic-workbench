# 海洋声学工作台 · 本地 v0.2

本初版使用课程资料包中的知识卡、教材、AT 工具包和 Munk 示例。前端为 React，后台为 FastAPI，实际计算由本机 MATLAB R2024a 调用 AT 的 KRAKEN / FIELD 完成。

## 启动与使用

在这台电脑上双击 `启动工作台.cmd`，打开 **http://127.0.0.1:8765/**。也可以在 PowerShell 执行 `./start.ps1 -NoBrowser`。启动器会复用正在运行的服务。后台日志位于 `.local/server.stderr.log`。

1. **知识图谱**：参考智慧树 / 知到公开知识图谱手册的课程总览、章节目录、局部与全局切换、节点详情交互。六个课程单元包含 46 个知识点；全图 53 个节点、126 条关系，其中课程层级 52 条、建议阅读顺序 24 条、概念关联 50 条。点击节点查看讲解、公式、适用条件、易错点、示意图、原始教材页和源文件；支持跨单元跳转、路径查找、三种布局、缩放、全屏、浅色切换、搜索、收藏与已读标记。阅读进度只记录用户操作，不表示掌握程度。学习地图提供入门、实践、进阶三条建议路径。十张原理图均注明示意性质，其中 Munk 剖面曲线来自教师 ENV 的离散输入。
2. **声场仿真**：填写频率、声源深度、接收深度、距离和网格，点击“检查并生成计划”，核对组合后点击“确认并运行 MATLAB”。任务串行执行，完成后在“任务与结果”查看声场图、接收深度曲线、日志和文件，或下载完整结果包。
3. **项目文件**：浏览当前授权目录下的 `.m`、`.env`、`.flp` 等文本文件。环境配置可切换项目目录；读取限制在该目录内。
4. **对话工作台**：未配置密钥时显示人工整理的课程知识卡；配置密钥后通过云端模型 API 生成回答。检索明确知识点时，优先提供该节点及直接关联节点，并把带类型的图谱三元组加入模型上下文。当前使用关键词与别名检索，未接入向量检索。节点“就此知识提问”会把问题带入对话输入框。Agent 模式提供列出项目文件和读取文件的工具。
5. **环境配置**：登记 DeepSeek 官方、阿里云百炼北京、月之暗面 Kimi 官方、智谱 BigModel 官方四家供应商的 16 项具体模型预设。显示开发方、供应商、模型名称、API 标识、端点、官方文档和核对日期。可查询账户 /models、手动测试当前模型、填写其他模型标识。文档核对不代表账户已开通；连接测试会发起一次短请求，可能消耗少量 Token。按供应商保存连接配置，切换时不混用密钥。密钥保存在 `.local/config.json` 与 `.local/model-profiles.json`，配置读取接口只返回是否已保存，不返回完整密钥。

## AT 已导入的位置

完整 AT 工具包已解压到 `<当前用户 Documents>/MATLAB/AcousticsToolbox/at`。`Documents/MATLAB/startup.m` 中增加了独立标记的路径注册块，保留原有内容。MATLAB 启动时注册根目录、`bin`、`ReadWrite`、`Plot` 和 `Misc`，并优先使用该版本。这是 MATLAB 搜索路径方式的安装，可直接调用函数；AT 并非 `.mltbx` 安装包。

已在新 MATLAB 进程中验证 `which kraken`、`which bellhop`、`which read_shd`、`which kraken.exe` 均指向该目录。工具包所有文件已保留，其他子目录可在具体使用时单独加到路径。

## 真实计算流程与范围

网页参数 → 后台校验和任务目录 → `case.json` → 固定 MATLAB 入口 `backend/matlab/run_ocean_case.m` → 生成成对 ENV / FLP → 读取 ENV 检查频率和源深 → KRAKEN / FIELD → 本次 SHD 复声压 → TL 和曲线 → PNG、CSV、JSON。

首版支持 Munk 距离无关深海模板，水深 5000 m；频率 10–200 Hz，源深和接收深度严格位于水面与海底之间，距离 0.1–100 km，每批最多 12 组。接收深度采用最近网格点，结果保留请求值与实际值。海面近零声压不纳入有效 TL 统计。TL 按 AT FIELD 归一化声压计算，`TL = -20 log10 |p|`；图中使用固定 40–110 dB 色标，便于比较。

这是教师示例环境的数值计算，不代表指定真实海域；尚未加入实际观测校准。仿真只运行固定入口，不执行大模型任意生成的代码。每次计算使用独立目录，后台重启时未结束任务会标记为失败，需重新提交。暂停领取不终止当前运行任务；取消会终止该任务的 MATLAB 子进程树。

## 首版边界

- 46 个知识点为人工整理，出处定位到教材 PDF 页或本项目 / AT 代码。20 份资料已登记，尚未宣称所有资料均已全文 OCR 与入库。全文 OCR、向量检索和自动图谱抽取仍待接入。
- 模型配置和工具调用接口已写好，但没有用户 API Key，未验证真实云端模型回复。
- Agent 当前提供项目读取。自动修改代码、差异审阅、自动修复和自由仿真编排尚未实现。
- MATLAB 在这台电脑运行，需要已有许可。当前服务仅监听回环地址；跨电脑在线访问、云端 MATLAB 和公网部署尚未开展。

## 开发与迁移

当前机器使用已安装的 Node.js，以及独立目录中的 Python 依赖。启动器读取 `.local/runtime.json`，不修改系统 Python。换电脑时请安装 Python、Node.js、获授权的 MATLAB，并在项目中建立环境：

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd ci
npm.cmd run build
./.venv/Scripts/python.exe backend/bootstrap.py "资料包路径/大作业资料包.zip"
```

在环境配置中更新 MATLAB 和 AT 路径。开发时分别运行 `backend/app.py` 和 `npm.cmd run dev`。API 文档在 `/api/docs`。本机私有资源、数据库、运行结果与密钥位于 `.local`，不应作为公开源代码上传。

本地集成检查：`python tests/check_local.py`，需要服务已经启动及至少一组成功计算结果，结果维度按本次计划校验。`python tests/check_references.py` 检查全部教材页、代码来源和示意图；`python tests/test_models.py` 使用离线模拟响应检查供应商密钥隔离、参数与错误提示，不产生模型调用费用。实际核验记录见 `VALIDATION.md`，界面与模型来源见 `REFERENCE_DESIGN.md`。

## 公网计算节点（v0.3）

公开网站已发布到 https://ocean-acoustics-workbench-30682.jovial-sun-4182.chatgpt.site 。运行 `启动公网计算节点.cmd` 或 `start-public.ps1 -NoBrowser` 会同时启动本机服务、仅接收受限请求的访客网关，以及主动连接云端的 HTTPS 程序。访客无需安装 MATLAB；计算节点需要联网且不休眠。此启动器不会改变系统电源设置。

图谱、关联查询、模型目录和 38 张教材原页片段由云端直接提供。模型问答和 MATLAB 仿真使用计算节点；用户模型密钥、对话及任务按访客 Cookie 隔离。模型密钥仅保留在节点内存中，重启后需重新填写。网站不会读取访客设备上的 MATLAB 项目，公共 Agent 只阅读课程共享模板。完整公网源代码在相邻 `ocean-acoustic-public` 目录。

公网连接密钥保存在未入库的 `.local/public-runtime.json`，并作为云端运行时 secret 管理；源码包不包含该密钥。已有机器可直接使用上述启动器，迁移计算节点时需由网站维护者重新配置连接密钥和 MATLAB 授权环境。
