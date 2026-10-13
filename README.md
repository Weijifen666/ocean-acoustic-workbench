# 海洋声学工作台 / Ocean Acoustics Workbench · v0.5

用于海洋声学课程的知识图谱、模型问答与 MATLAB 声场仿真工作台。

**本项目仅用于四人小组的海洋声学课程作业与教学展示，无任何商业用途。**

2026-10-13 更新：主问答与原创海洋助手“小航”共享当前访客的对话和模型选择；可直接切换已配置供应商的模型，选择课程依据或模型一般知识。授权资料已扩展为五份 PDF 的全书文本层索引，覆盖 1789 / 1846 页、4092 个片段。详细实现见[知识扩展与开源借鉴](docs/KNOWLEDGE_EXPANSION.md)、[界面设计](docs/DESIGN_AND_REUSE.md)和[仿真与验证](docs/SIMULATION_AND_VALIDATION.md)。

在线演示：[海洋声学工作台](https://ocean-acoustics-workbench-30682.jovial-sun-4182.chatgpt.site/)。图谱和模型问答在云端运行；MATLAB 仿真与私有原文索引需要项目计算节点在线。

## 当前功能

- 6 个课程单元、46 个知识点、126 条有类型的关系；目录、关联查询、学习路径、原理示意图和引用。
- DeepSeek、阿里云百炼、Moonshot Kimi、智谱 GLM 的 16 个具体模型预设；在聊天窗口切换模型，复用当前访客已配置的供应商 Key，记录每条回答的请求模型与供应商返回标识。DeepSeek V4-Pro 当前为路由到 V4.1-Flash 的兼容入口。
- 课程依据与模型一般知识两种回答范围。课程对话未命中资料时明确缺口；一般知识模式保留模型原有能力，补充知识不伪装成课程引用。缺口记录保存在当前访客空间，不自动加入正式知识库。
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

公网部署请阅读 [部署文档](docs/DEPLOYMENT.md)。`.local`、真实 API Key、数据库、求解结果、教材 PDF、原始压缩包以及生产站点身份不提交 Git。

## 验证与边界

已经完成真实公网验证：匿名访问、访客隔离、教材图片、知识检索、MATLAB 作业、结果 PNG 与 ZIP 下载。离线模型测试覆盖请求参数和密钥隔离；真实供应商调用需要有效密钥、额度及模型权限，未使用维护者的付费密钥进行验证。

```powershell
cd ocean-acoustic-workbench
.\.venv\Scripts\python.exe tests/test_models.py
.\.venv\Scripts\python.exe tests/test_knowledge.py
.\.venv\Scripts\python.exe tests/test_local_chat_safety.py
.\.venv\Scripts\python.exe tests/test_science.py
.\.venv\Scripts\python.exe tests/test_plans.py
# 以下检查需要本地服务、教师资料及至少一次成功仿真：
.\.venv\Scripts\python.exe tests/check_local.py
.\.venv\Scripts\python.exe tests/check_references.py
```

云端访客配置、加密隔离、模型快切和回答范围检查：在 `ocean-acoustic-public` 运行 `npm.cmd ci` 与 `npm.cmd test`。v0.5 的实际检查范围与结果见[版本验证记录](docs/VALIDATION_V0_5.md)。

云端供应商请求已修复 workerd 重定向参数兼容问题，明确区分认证、余额、网络和超时错误。原因与认证层验证见[模型连接记录](docs/MODEL_CONNECTION.md)；无效测试 Key 收到 401 只能证明到达认证层，不能代替有效账户的生成质量测试。

知识图谱中的概念关联不等同于因果推导；Munk 示例不代表某一真实海域。文本层入库页覆盖率不是知识正确率。当前未接入向量模型、OCR、自动实体关系抽取、模型训练或自动联网搜索；未实现账号登录、跨设备历史同步、任意 MATLAB 代码执行或自动修改项目。教材原页由有权使用的部署者提供，原文与索引不随源码分发。

![课程目录与科研工作区](docs/assets/course-workbench.png)

私有资料接入步骤见[知识入库说明](docs/KNOWLEDGE_IMPORT.md)。直接复用的 BM25 评分器与方法参考项目分别说明在 [NOTICE](NOTICE.md)；借鉴方法不表示已安装 LightRAG、RAGFlow、LlamaIndex 或 Haystack 完整框架。
