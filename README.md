# 海洋声学工作台 / Ocean Acoustics Workbench · v0.7

把知识图谱、资料问答、MATLAB编程、声场仿真和数据分析放在同一个工作台中。

**本项目用于四人小组的海洋声学课程作业与教学展示，无商业用途。**

## 使用与配置

| 使用方式 | 操作入口 |
| --- | --- |
| 直接使用公网网站 | [打开工作台](https://ocean-acoustics-workbench-30682.nguyenanhlan663.chatgpt.site/)，在“模型与环境”选择供应商，填写自己的API Key，测试并保存。 |
| 在自己电脑运行完整Agent和MATLAB | **[Windows本地配置教程](docs/LOCAL_SETUP.md)**：下载、安装、初始化、API/DSH、MATLAB/AT、工程目录、小算例与排障。 |
| 了解API、DSH与Skill | [Agent后端说明](docs/AGENT_BACKENDS.md)。本地支持API、DSH和已安装的Codex，公网使用个人API。 |
| 部署和维护网站 | [部署教程](docs/DEPLOYMENT.md)与[公共工作台和本地节点](docs/PUBLIC_WORKBENCH_SYNC.md)。 |

公网API问答检索云端投喂资料、课程知识卡和公开网页；本地DSH可读取自己的教材与工程。MATLAB节点负责声场计算，网站显示节点的在线状态。

## 可以做什么

- **知识图谱**：6个课程单元、69个知识点、180条关系。点击查看讲解、公式、图片和关联路径，多选知识点后可带入对话。
- **资料问答**：云端已接入5份教材与补充资料、1789页、4101个正文片段，通过BM25、双语术语和课程关联检索；另有30篇NOAA正文和9条项目导读，共67个片段。模型结合检索内容与自身已有知识解释问题。
- **模型与Skill**：DeepSeek、阿里云百炼、Moonshot Kimi、智谱GLM共16个模型预设；12个领域Skill提供环境构造、算例和分析步骤。选择账户已开通且有额度的模型即可使用。
- **MATLAB与代码**：编辑、保存.m脚本与CSV，让AI检查或修改。本地点击“在本机运行MATLAB”，在任务页查看日志、图表与文件。Python作为辅助分析，可在隔离浏览器中运行NumPy和Matplotlib。
- **声场仿真**：公共表单支持KRAKEN、SCOOTER、BELLHOP，以及Munk、Pekeris和WOA18环境。先检查计划，再提交到在线计算节点；支持参数扫描、季节比较和数值稳定性检查。
- **海洋数据**：全球WOA18的17个年/月/季度气候平均温盐、声速剖面，ETOPO1地图选点，以及CSV/JSON导出。[独立数据站](https://ocean-acoustic-data-workbench.huuiihhuuiii.chatgpt.site/)可直接查询。
- **研究与分析**：本地完整Agent可创建独立研究任务、编写并运行Python/MATLAB脚本，保存输入、图表和报告；支持位温/位密度混合层诊断与受控声场差异分析。
- **任务与协作**：持久任务队列、取消、幂等提交、日志和结果包下载；Sites个人空间支持配置与会话，小组课题可邀请成员、保存笔记和来源。

九类模型资料中已有八类创建配方，KRAKEL仍未开放。实时观测API、OCR、向量检索与模型训练尚未接入。Munk为5000m理想深海模板；真实海域研究需提供相应环境数据。

## 本地启动

准备Python 3.12+、Node.js 22.13+和Git，在PowerShell执行：

```powershell
git clone --branch main https://github.com/Weijifen666/ocean-acoustic-workbench.git ocean-acoustic-course
Set-Location .\ocean-acoustic-course\ocean-acoustic-workbench
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd ci
npm.cmd run build
.\.venv\Scripts\python.exe backend/init_local.py
.\.venv\Scripts\python.exe backend/app.py
```

打开 **http://127.0.0.1:8765/**。后续可运行`start.ps1`或“启动工作台.cmd”。

MATLAB、AT、DSH和教材按所需功能另行配置。完整步骤见[本地教程](docs/LOCAL_SETUP.md)。验证MATLAB时，先到“模型与环境”检查路径，再在“MATLAB与代码”载入示例并运行，到任务页确认日志和`profile.png`。

本地Key、会话、教材、索引和运行产物保存在忽略的`.local/`中。源码仓库不包含个人凭据和原始课程资料。

## 运行与验证记录

2026-11-04更新：5份资料的4101个正文片段已导入云端R2，API问答直接检索教材、课程卡与公开资料，结合模型已有知识组织回答；新增发送状态确认与同请求恢复，修正“简正波”的中文及英文术语检索，并精简界面和文档。云端教材入库状态可在[知识库接口](https://ocean-acoustics-workbench-30682.nguyenanhlan663.chatgpt.site/api/knowledge/status)查看，维护者操作见[教材导入](docs/KNOWLEDGE_IMPORT.md)。

**第25版已发布**：DeepSeek研究任务采用64K单轮输出预算，首次截断后自动提高到128K重试；仍被截断时可在原会话点击“继续原研究”。已有工具记录和计算任务保留。长步骤使用连接心跳，短暂断网时先核对云端进度再恢复。272项回归测试通过，包含17次工具调用后的截断恢复；公网流式接口与云端教材索引已实际检查，见[部署回执](docs/validation/2026-11-04/deployment-v25.json)、[公网接口检查](docs/validation/2026-11-04/public-api-v25.json)及[教材检索检查](docs/validation/2026-11-04/cloud-course-rag-v24.json)。

2026-11-03的字体、MATLAB主工作流和图谱图片更新见[第22版回执](docs/validation/2026-11-03/deployment-v22.json)，其中记录MATLAB自检任务`7d129b357c19`及公网101×101声场任务`b091fc34424c`。

真实浏览器Python、保存与下载、DSH技能调用、MATLAB脚本、模型修码和结果读取见[功能验收记录](docs/DUAL_WORKBENCH_ACCEPTANCE.md)。早期执行失败及对应修复保存在各版本记录中。

开发检查：

```powershell
npm.cmd --prefix ocean-acoustic-public test
cd ocean-acoustic-workbench
.\.venv\Scripts\python.exe -m unittest discover -s tests
npm.cmd run build
```

## 文档与源码

| 内容 | 路径 |
| --- | --- |
| 本地安装和使用 | [LOCAL_SETUP](docs/LOCAL_SETUP.md) |
| 教材导入 | [KNOWLEDGE_IMPORT](docs/KNOWLEDGE_IMPORT.md) |
| 公开海洋知识 | [OPEN_OCEAN_KNOWLEDGE](docs/OPEN_OCEAN_KNOWLEDGE.md) |
| 检索与评测 | [KNOWLEDGE_QUALITY](docs/KNOWLEDGE_QUALITY.md) |
| RAG、Skill与模型训练状态 | [KNOWLEDGE_TRAINING_STATUS](docs/KNOWLEDGE_TRAINING_STATUS.md) |
| 数据服务 | [CLOUD_OCEAN_DATA](docs/CLOUD_OCEAN_DATA.md) |
| 科研计算检查 | [RESEARCH_SCIENCE_VALIDATION](docs/RESEARCH_SCIENCE_VALIDATION.md) |

`ocean-acoustic-public/`包含React网页、云端Worker和数据库迁移；`ocean-acoustic-workbench/`包含本地完整应用、FastAPI、MATLAB执行器与测试。公共图谱和Skill快照由本地来源在构建时生成。

原创程序采用MIT许可证，第三方代码和素材按各自许可使用，见[LICENSE](LICENSE)与[NOTICE](NOTICE.md)。界面参考Fuwari与WorkBuddy的交互形式，角色为项目原创插画，动画使用Sakana核心；BM25组件保留Apache-2.0说明。

<details>
<summary>历史版本和验收记录</summary>

[v0.4](docs/VALIDATION_V0_4.md) · [v0.5](docs/VALIDATION_V0_5.md) · [v0.6](docs/VALIDATION_V0_6.md) · [v0.7](docs/VALIDATION_V0_7.md) · [11月3日实际功能验收](docs/FUNCTIONAL_VALIDATION_2026-11-03.md) · [API连接记录](docs/validation/2026-11-03/api-connection-diagnosis.md)

</details>
