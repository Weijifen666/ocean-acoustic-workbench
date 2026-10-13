# 海洋声学工作台 / Ocean Acoustics Workbench · v0.6

用于海洋声学课程的知识图谱、模型问答与 MATLAB 声场仿真工作台。

**本项目仅用于四人小组的海洋声学课程作业与教学展示，无任何商业用途。**

2026-10-13 更新：公共聊天默认使用“资料 + 模型知识”，主问答与原创海洋助手“小航”共享访客对话和模型。输入框底部集中放置模型、上下文、更多与发送控件。公开知识已实际接入 30 篇 NOAA 正文和 9 条项目自写导读，共 39 个可检索来源、67 个片段；42 项登记来源中的 3 个动态数据入口尚未接通实时数值。五份授权 PDF 的私有文本层索引仍为 1789 / 1846 页、4092 个片段。见[公开知识来源与刷新](docs/OPEN_OCEAN_KNOWLEDGE.md)、[知识扩展](docs/KNOWLEDGE_EXPANSION.md)和[v0.6 验收](docs/VALIDATION_V0_6.md)。

在线演示：[海洋声学工作台](https://ocean-acoustics-workbench-30682.jovial-sun-4182.chatgpt.site/)。图谱和模型问答在云端运行；MATLAB 仿真与私有原文索引需要项目计算节点在线。

## 当前功能

- 6 个课程单元、46 个知识点、126 条有类型的关系；目录、关联查询、学习路径、原理示意图和引用。
- DeepSeek、阿里云百炼、Moonshot Kimi、智谱 GLM 的 16 个具体模型预设；在聊天窗口切换模型，复用当前访客已配置的供应商 Key，记录每条回答的请求模型与供应商返回标识。DeepSeek V4-Pro 当前为路由到 V4.1-Flash 的兼容入口。
- 公共聊天默认“资料 + 模型知识”（`general`）；可在“更多”切换“仅依据资料”（`course`）。资料范围包括课程证据和公开网页快照；模型一般知识单独标注，未命中资料的问题进入访客私有缺口记录，不自动成为正式知识或触发训练。
- 主问答与“小航”共用输入框控件。4K、8K、16K、32K、64K、128K 控制实际发送的输入预算，自动为 32K；服务端按保守估算裁剪历史和资料。它不调整模型原生窗口或 KV cache；实际输入及缓存命中以供应商返回为准。
- 公开正文覆盖酸化、珊瑚、海平面、海流、漂流浮标、海啸、质控等扩展主题。中文标题、关键词和导读均为项目整理；点击知识图谱的“学习资源”即可查看来源、时间与许可，无需 API Key。
- 计算节点启动与状态查询按 168 小时 TTL 检查 30 篇 NOAA 正文并调度后台刷新，失败保留上次成功快照，只更新独立私有网页快照；9 条项目导读与 3 个数据入口由维护者更新登记。云端内置公开索引离线可检索，更新该静态包需导出、构建和重新发布。
- 原创 SVG 海洋探索员“小航”：浮动聊天、拖动、隐藏和复位；与主问答共用状态，提供模型选择、来源核查和知识点跳转。
- Munk 深海模板，MATLAB R2024a + AT KRAKEN/FIELD 真实计算；队列、日志、传播损失图片、CSV 和结果包。
- 公网访客的模型配置、对话和任务隔离；公共 Agent 只分析课程共享代码，不操纵访客设备。
- 模型密钥与对话按访客加密保存到 D1；支持清除全部模型密钥。更换浏览器或清除 Cookie 会建立新访客空间。
- 授权 PDF / DOCX / TXT / Markdown 私有分块入库、SHA256 版本与原页引用。S01 / S07 / S15 / S17 / S18 已逐页处理 1846 页，1789 页形成 4092 个片段，57 页提取文字为空或过短、等待复核；这不表示已做 OCR 或教材内容已人工核实。
- 12 道课程命题（9 道参数预设、3 道条件与工具边界题）；输入输出一致性校验、结果数值分析和 manifest 文件哈希。
- 云端图谱与页面、D1 请求队列、R2 响应/图片存储，以及计算节点主动发起的加密 HTTPS 连接。

## 仓库结构

```text
ocean-acoustic-public/       React 网页、云端 Worker、D1 迁移与构建脚本
ocean-acoustic-workbench/    本地完整工作台、FastAPI 网关、MATLAB 执行器和测试
docs/DEPLOYMENT.md           部署步骤、环境变量与验证
docs/OPEN_OCEAN_KNOWLEDGE.md  公开知识来源、许可、独立索引与刷新
LICENSE                     本项目原创程序的 MIT 许可证
NOTICE.md                   外部教材、MATLAB 和 AT 的权利说明
```

## 本地启动

需要 Python 3.12+、Node.js 22.13+、获授权的 MATLAB，以及课程资源包或自己准备的 AT 环境。原始课程资料不随本仓库分发。

```powershell
cd ocean-acoustic-workbench
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd ci
npm.cmd run build
.\.venv\Scripts\python.exe backend/bootstrap.py "你的资料包路径.zip"
.\start.ps1
```

本地默认网址 `http://127.0.0.1:8765/`。在环境设置中填写 MATLAB 可执行文件、AT 及项目目录，再检查运行环境。AT 安装脚本默认使用当前用户的 Documents/MATLAB 目录。

公网部署请阅读 [部署文档](docs/DEPLOYMENT.md)。`.local`、真实 API Key、私有数据库、求解结果、教材 PDF、原始压缩包以及生产站点身份不提交 Git。经审核的 NOAA 公有领域文字片段与项目自写导读放在公共 JSON 中，保留上游来源与许可说明。

## 验证与边界

已经完成真实公网验证：匿名访问、访客隔离、教材图片、知识检索、MATLAB 作业、结果 PNG 与 ZIP 下载。离线模型测试覆盖请求参数和密钥隔离；真实供应商调用需要有效密钥、额度及模型权限，未使用维护者的付费密钥进行验证。

```powershell
cd ocean-acoustic-workbench
.\.venv\Scripts\python.exe tests/test_models.py
.\.venv\Scripts\python.exe tests/test_knowledge.py
.\.venv\Scripts\python.exe tests/test_public_ocean.py
.\.venv\Scripts\python.exe tests/test_context_budget.py
.\.venv\Scripts\python.exe tests/test_local_chat_safety.py
.\.venv\Scripts\python.exe tests/test_science.py
.\.venv\Scripts\python.exe tests/test_plans.py
# 以下检查需要本地服务、教师资料及至少一次成功仿真：
.\.venv\Scripts\python.exe tests/check_local.py
.\.venv\Scripts\python.exe tests/check_references.py
```

云端访客配置、加密隔离、模型快切、公开知识与上下文预算检查：在 `ocean-acoustic-public` 运行 `npm.cmd ci` 与 `npm.cmd test`。实际检查范围见[v0.6 验收](docs/VALIDATION_V0_6.md)；此前全文资料与共享模型验证保留在 [v0.5 记录](docs/VALIDATION_V0_5.md)。

云端供应商请求已修复 workerd 重定向参数兼容问题，明确区分认证、余额、网络和超时错误。原因与认证层验证见[模型连接记录](docs/MODEL_CONNECTION.md)；无效测试 Key 收到 401 只能证明到达认证层，不能代替有效账户的生成质量测试。

知识图谱中的关联不等同于因果推导；Munk 示例不代表某一真实海域。入库页覆盖率不是知识正确率。已实现官方来源清单的文档刷新，尚未接入实时观测 API、通用实时全网搜索、向量模型、OCR、自动实体关系抽取或模型训练；知识不会被永久写进供应商模型。账号登录、跨设备历史同步、任意 MATLAB 代码执行与自动修改项目也尚未实现。教材原页由有权使用的部署者提供，私有原文与索引不随源码分发。

![简洁问答界面](docs/assets/course-workbench.png)

私有资料接入步骤见[知识入库说明](docs/KNOWLEDGE_IMPORT.md)。直接复用的 BM25 评分器与方法参考项目分别说明在 [NOTICE](NOTICE.md)；借鉴方法不表示已安装 LightRAG、RAGFlow、LlamaIndex 或 Haystack 完整框架。

公共聊天的模型选择与配置入口参考 [WorkBuddy 官方模型配置文档](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)，没有移植其产品、角色或 Agent 实现。供应商缓存是另一层机制，参见 [DeepSeek 缓存说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)与[阿里云百炼缓存说明](https://help.aliyun.com/zh/model-studio/context-cache)；本项目仅读取实际返回的缓存用量，不承诺命中率或控制供应商 KV cache。
