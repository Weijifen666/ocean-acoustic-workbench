# 海洋声学工作台 · v0.5

用于四人小组的海洋声学课程作业与教学展示，无任何商业用途。React 网页、FastAPI 计算节点与云端 Worker 分工运行；实际仿真由获授权的 MATLAB R2024a 调用 AT KRAKEN / FIELD 完成。项目原创代码采用 MIT 许可证，外部教材、AT 与 MATLAB 保留各自权利和许可。

公开网页：[海洋声学工作台](https://ocean-acoustics-workbench-30682.jovial-sun-4182.chatgpt.site/)。云端页面、课程图谱、课程卡检索与模型连接不依赖维护者电脑；MATLAB 仿真和私有原文索引需要计算节点在线。

## 界面与使用

界面参考 JupyterLab / VS Code 的紧凑科研工作区，使用课程目录、图谱画布、知识详情、参数表单和任务结果视图。v0.5 加入共享模型快切、明确知识范围、资料覆盖表与原创海洋助手“小航”。设计来源、直接复用代码及许可见[设计与复用说明](../docs/DESIGN_AND_REUSE.md)和[知识扩展记录](../docs/KNOWLEDGE_EXPANSION.md)。

- **知识图谱**：6 个课程单元、46 个知识点，53 个节点和 126 条有类型的关系。直接点击查看概念、公式、适用条件、图片和引用，无需调用大模型。课程层级、建议阅读顺序与概念关联分别展示，关系连接不等于物理因果。收藏和已读标记只表示浏览器中的操作记录。
- **知识库与对话**：课程卡、术语别名、有类型的一跳关联与来源引用共同提供上下文。节点在线时额外检索五份全文文本层索引。“课程依据”普通对话未命中时明确缺口，不以相关背景冒充直接证据；“模型一般知识”保留模型已有能力，补充知识标记为未经本项目原文核验。未配置 API Key 时只显示检索证据。
- **模型快切与小航**：主问答与原创 SVG 海洋探索员“小航”共用当前访客的对话、模型选择和知识范围。可在聊天中切换已配置供应商的模型，复用该供应商的 Key；每条回答记录请求与响应模型。“小航”支持浮动聊天、拖动、隐藏、复位、来源核查和知识点跳转。
- **资料缺口**：没有匹配资料的问题进入待补资料记录；公网记录绑定当前访客并加密存储，不公开给其他访客，也不自动进入正式课程图谱或训练模型。
- **课程命题与仿真**：12 道命题包含 9 道可填参数预设和 3 道缺参、工具边界或数值解释题。先填入参数、预览组合，再确认运行；完成后查看声场图、接收曲线、实际网格、验证记录与文件哈希，并下载结果包。
- **项目阅读**：本地管理员可浏览授权目录内的文本项目；公共 Agent 只分析课程共享模板。自动修改 MATLAB 代码、自由执行命令和读取访客设备文件尚未实现。
- **模型设置**：提供 DeepSeek 官方、阿里云百炼、Moonshot Kimi、智谱 GLM 的 16 个模型预设，并显示具体供应商、名称、API 标识和端点。DeepSeek V4-Pro 当前是官方路由到 V4.1-Flash 的兼容入口。账户模型列表与短连接测试均需自己的有效 API Key；短生成测试可能产生供应商调用费用。预设与文档登记不代表账户已开通或已经完成真实调用验证。

## 知识入库的实际范围

v0.5 已处理 S01、S07、S15、S17、S18 五份授权 PDF 的全部 1846 页，1789 页生成 4092 个私有片段；57 页提取文字为空或过短，等待原页复核。文本层入库页覆盖率约 96.9%，不代表知识正确率或其他课程来源已入库。46 个人工课程知识点保持为已整理的概念层，新增全文页无需全部挂入图谱。

节点采用 BM25、双语别名、原文词项排序和概念优先权重；分块保留来源、PDF 实际页、字符位置和原文件 SHA-256。未绑定图谱节点的英文原页可通过已登记术语的中文查询命中。检索缓存复用全文分词与 BM25 统计，索引改动后刷新。云端独立检索公开课程卡，节点离线时明确回退到课程卡，不宣称访问了私有原文。

导入器支持 PDF、DOCX、UTF-8 TXT 和 Markdown。省略清单的 `pages` 字段即可逐页处理该来源，原文索引放在 `.local/kb/chunks.sqlite3`，不提交 GitHub。57 页的 `blank_or_short` 不等于已确认扫描页；本次没有执行 OCR，未部署向量模型、自动物理关系抽取、模型训练或自动联网搜索。详见[私有知识入库](../docs/KNOWLEDGE_IMPORT.md)和[扩展与方法借鉴](../docs/KNOWLEDGE_EXPANSION.md)。LightRAG、RAGFlow、LlamaIndex 与 Haystack 用于方法比较，未安装其完整框架；实际直接复用 BM25 评分器的原许可见 `backend/vendor/`。

## 本地启动与环境

在已经配置好本机依赖与资源的电脑上，双击 `启动工作台.cmd` 打开 `http://127.0.0.1:8765/`，或执行 `./start.ps1 -NoBrowser`。启动器会复用正在运行的服务；后台日志为 `.local/server.stderr.log`。

换电脑需要 Python 3.12+、Node.js 22.13+、获授权的 MATLAB、AT 与自己有权使用的课程资料。原始资料和安装包不随公开源码分发。

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm.cmd ci
npm.cmd run build
./.venv/Scripts/python.exe backend/bootstrap.py "你的资料包路径.zip"
./start.ps1
```

在环境设置中填写 MATLAB 可执行文件、AT 与授权项目目录，再检查环境。开发时分别运行 `backend/app.py` 和 `npm.cmd run dev`；本地 API 文档在 `/api/docs`。当前机器的启动器读取 `.local/runtime.json`，不修改系统 Python。

AT 使用 MATLAB 搜索路径方式接入，不是 `.mltbx` 安装包。安装脚本将资源导入当前用户 `Documents/MATLAB/AcousticsToolbox/at`，为 `startup.m` 登记根目录、`bin`、`ReadWrite`、`Plot` 和 `Misc` 并保留备份。既有节点已验证相关函数位置；迁移后须重新检查自己的环境。

## 真实计算与结果边界

网页参数 → 严格 Plan 校验 → 独立任务目录 → 数值 `case.json` → 固定入口 `backend/matlab/run_ocean_case.m` → ENV / FLP → 读取 ENV 核对输入 → KRAKEN / FIELD → SHD 复声压 → TL、曲线与数值验证 → PNG、CSV、JSON 和 `manifest.json`。

当前只支持 5000 m Munk 距离无关模板、10–200 Hz、位于水面与海底之间的源/接收深度、0.1–100 km 距离。公网单批最多 4 组；本地管理端单批最多 12 组。频率和源深扫参去重，未知字段、非有限数值与越界输入被拒绝。接收深度使用最近网格点，并同时记录请求值、实际值和偏差。

TL 使用 FIELD 归一化压力计算 `TL = -20 log10 |p|`，近零声压对应样本被屏蔽；固定 40–110 dB 色标用于展示。结果检查坐标排序、范围、采样点数、矩阵轴顺序、真实频率/源深、接收曲线对应行和有效比例。manifest 记录输入、脚本及产物哈希；未报告的 KRAKEN/FIELD 版本保留为未知。

数值卡来自本次结果，不预测或捏造 TL。相干曲线不要求随距离单调增加；不同取样条件的中位数不能用于“最佳海域”排名。这些检查不证明数值收敛，也不替代真实海域观测、校准或实验验证。仿真只执行固定入口，不执行模型任意生成的代码。任务支持排队、日志、超时和取消；后台重启中断的任务需重新提交。

## 公网部署与密钥存储

运行 `启动公网计算节点.cmd` 或 `start-public.ps1 -NoBrowser`，启动本地服务、回环地址上的受限访客网关与主动发起 HTTPS 请求的云端连接程序。无需开放本机公网入站端口，也不依赖临时隧道；节点必须联网且不休眠。完整网页与云端源码在相邻 `ocean-acoustic-public` 目录，部署配置见[部署说明](../docs/DEPLOYMENT.md)。

公网模型请求由云端 Worker 直接发送至供应商。模型配置、API Key 与对话按访客加密保存于 D1，节点重启不会清除这些云端配置；提供清除全部模型密钥入口。匿名访客空间绑定浏览器 Cookie，清除 Cookie 或更换设备会建立新空间，当前没有账号登录和跨设备历史同步。

图谱、模型目录与课程卡在云端提供；已提供的教材页图片可缓存至 R2。节点离线时 MATLAB 与私有原文索引不可用，云端图谱、课程卡与已配置模型问答仍可使用。

本地管理员的模型密钥仍保存在 `.local/config.json` 与 `.local/model-profiles.json`，并不会自动变成公共访客的密钥。连接密钥在 `.local/public-runtime.json`，同时作为云端运行时 Secret；本地资料、密钥、数据库、原文索引和求解产物均不上传 Git。

## 验证

v0.5 的实际检查范围与验收结果见 [VALIDATION_V0_5.md](../docs/VALIDATION_V0_5.md)。知识检查覆盖真实 PDF 读取、全文与部分页覆盖、未绑定节点的双语检索和大批片段缓存；云端检查覆盖访客隔离、模型快切、知识范围及来源说明。离线模拟响应与无效测试 Key 的认证层探测不能代替有效模型账户的权限、额度与生成质量验证。

```powershell
./.venv/Scripts/python.exe tests/test_knowledge.py
./.venv/Scripts/python.exe tests/test_science.py
./.venv/Scripts/python.exe tests/test_models.py
./.venv/Scripts/python.exe tests/test_plans.py
# 云端逻辑离线测试：在相邻 ocean-acoustic-public 目录运行 npm.cmd test
# 以下检查需要本地服务、课程资料和已有成功计算结果：
./.venv/Scripts/python.exe tests/check_local.py
./.venv/Scripts/python.exe tests/check_references.py
```
