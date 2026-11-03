# 海洋声学本地完整工作台

用于四人小组的海洋声学课程作业与教学展示，无任何商业用途。本地应用把知识图谱、资料问答、模型 Skill、海洋数据、Python/MATLAB 编程、声场仿真和结果分析放在同一个工作台中。

**第一次使用请按 [本地安装与配置教程](../docs/LOCAL_SETUP.md) 操作。** 教程包含没有课程资料包的启动方式、MATLAB/AT、DSH、模型 API、海洋数据、实际试跑和故障排查。

## 选择入口

| 入口 | 模型接入 | 适用范围 |
| --- | --- | --- |
| [公共网站](https://ocean-acoustics-workbench-30682.nguyenanhlan663.chatgpt.site/) | 用户自己的模型 API | 免本地安装；实际开放工具与计算节点状态以网站为准 |
| 本地完整工作台 | DSH Harness、工作台模型 API，另保留已安装 Codex 的接入 | 使用自己的教材、项目、MATLAB/AT 和研究任务目录；可写研究脚本、运行并核对结果 |

本地界面默认选择 DSH，可在“对话工作台 → 研究代理 → 对话后端”切换。DSH 使用自己的模型与凭据；工作台里保存的 API Key 不会自动配置 DSH，切换工作台 API 模型也不会自动切换 DSH 的模型。接入结构与取舍见 [Agent 后端说明](../docs/AGENT_BACKENDS.md)。

## 首次启动

以下命令在 Windows PowerShell 中执行；安装 Python 3.12+、Node.js 22.13+ 和 Git。DSH、MATLAB 和课程资料分别配置，不随源码下载。

```powershell
git clone https://github.com/Weijifen666/ocean-acoustic-workbench.git ocean-acoustic-course
Set-Location .\ocean-acoustic-course\ocean-acoustic-workbench
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd ci
npm.cmd run build
.\.venv\Scripts\python.exe backend/init_local.py
$env:OCEAN_DATA_URL = 'https://ocean-acoustic-data-workbench.huuiihhuuiii.chatgpt.site'
.\.venv\Scripts\python.exe backend/app.py
```

打开 **http://127.0.0.1:8765/**。首次建议前台运行，终端保留错误信息，按 Ctrl+C 可正常关闭。后续可在相同配置环境下运行 `./start.ps1` 或双击“启动工作台.cmd”。环境变量需在启动后端之前设置；已有服务运行时，启动器会复用它。

`init_local.py` 非覆盖地创建本地配置、公开资料登记和项目目录。没有私有教材仍可浏览图谱与公开知识；没有模型 Key 不等于模型已经能生成回答；没有 MATLAB/AT 不能完成真实声场计算。已有课程资料包时，继续按教程导入并配置完整 AT，不会因初始化而得到教材或求解器。

## 实际功能

- **知识图谱**：6 个课程单元、69 个知识点、76 个总节点、180 条有类型的关系；选取知识点、查看公式/示意图/来源、查询关联路径、转入提问或仿真配置。原始教材页是否可读，取决于本机是否接入相应授权文件。
- **问答与检索**：课程知识卡、人工术语映射、关联信息、已导入教材原文和公开海洋资料共同提供引用候选。入库是 RAG，不训练或修改供应商模型权重。
- **研究编程**：12 个领域 Skill，可读取授权项目、创建独立任务、写 Python/MATLAB 脚本、实际运行、保留日志和产物，再提交报告。项目文件页本身是只读浏览；研究脚本在你授权的本机环境运行，不是安全沙箱。
- **MATLAB 与代码**：默认编辑MATLAB脚本，Python作为可选辅助；可保存代码草稿与CSV，让AI读取并修改；Python可在浏览器的WASM隔离线程运行 NumPy/Matplotlib、下载真实图表。本地入口还可把已保存修订交给本机Python或已配置MATLAB执行，在任务页核对日志、源文件与CSV。浏览器运行占用当前设备资源，不能执行MATLAB/AT或任意安装Python包；回传结果标为浏览器报告，不冒充服务端复算。
- **声场仿真**：固定表单接入 KRAKEN、SCOOTER、BELLHOP；模型经验包括九类，八类具有固化研究配方。KRAKEL 目前未开放基线创建，不能把模型资料卡数量当成可运行数量。
- **环境与分析**：WOA18 全部17个时期的温盐/声速、ETOPO1地图选点和CSV/JSON；本地标准工具支持温度/位密度混合层诊断、候选表面声道结构、受控声场数值比较和证据审计。气候态不等于实时观测，候选声道不等于已证明声学俘获。
- **任务与结果**：固定仿真与研究任务统一查看；图表、输入、输出文件、日志和下载保留在各自任务目录。停止 Agent 与取消已提交计算分别操作。

## 配置顺序

1. **模型**：在 DSH 桌面应用配置模型并完成一次实际对话，或在工作台“模型与环境”配置自己的 API，测试后保存，再选对应后端。
2. **计算环境**：在“模型与环境”填写 MATLAB 可执行文件、完整 AT 根目录和自己的授权项目目录；检查 `bin/`、MATLAB读取器和原始 `tests/` 输入是否配套。
3. **海洋数据**：优先使用上面 `OCEAN_DATA_URL` 按需读取；有原始数据时可按教程切换本地目录，二者不自动混用。
4. **课程资料**：原始课程 ZIP 用 `backend/bootstrap.py` 导入；全文按 [知识入库说明](../docs/KNOWLEDGE_IMPORT.md)建立私有索引。没有接入的 PDF 不会生成假原页。
5. **先试小任务**：先读取一个 Skill，再跑教程中的小型 Pekeris 表单；看到实际任务成功、图像和数据文件后，再进行更复杂的开放研究。

## 验收与限制

当前main已包含正式网站第22版对应功能。本机MATLAB R2024a启动、脚本执行、CSV和PNG输出已实测；浏览器Python的实际运行、停止、超时、保存、刷新恢复与下载也已通过。公网表单新任务b091fc34424c完成101×101真实声场。准确部署范围与复测结果见[第22版回执](../docs/validation/2026-11-03/deployment-v22.json)。

[2026-11-03 实际验收记录](../docs/FUNCTIONAL_VALIDATION_2026-11-03.md)记录了三模型固定任务、八种本地配方、真实四季诊断，以及 DSH 只读 Skill 工具闭环。上一轮 DSH 自主“诊断并归档”任务分别遇到上游繁忙与180秒停止，尚不能把执行器成功当成模型自主研究全程成功。后续真实DSH已跑通Skill驱动的Munk提交与结果读取，以及模型按失败日志修码、再读取真实运行结果的链路，见[最新功能验收](../docs/DUAL_WORKBENCH_ACCEPTANCE.md)。上述早轮失败记录继续保留；真实模型服务、额度和复杂任务完成率仍需在自己的环境复验。

开发回归可运行：

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
.\.venv\Scripts\python.exe backend/evaluate_knowledge.py
npm.cmd run build
```

回归测试与离线检索基准不等于真实付费模型、MATLAB 或物理精度验收。运行依赖与参数协议见 [科研检查说明](../docs/RESEARCH_SCIENCE_VALIDATION.md)。公开网站与本机执行的范围分别验证，不能仅凭相同界面判断能力相同。

本地配置、Key、会话、教材、原文索引、任务产物和凭据保存在忽略的 `.local/`，不应上传 GitHub。原创程序采用 MIT，外部教材、AT、MATLAB 和第三方依赖保持自己的许可；见 [NOTICE](../NOTICE.md)。发布自己的网页或连接公共计算节点另见 [部署说明](../docs/DEPLOYMENT.md)。
