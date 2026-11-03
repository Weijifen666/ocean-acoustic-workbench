# 本地完整工作台：安装、配置与使用

本教程面向 Windows 本机使用。完成基础安装后，先选择“模型 API”或“DSH Harness”接入，再按需要配置 MATLAB/AT 和课程教材。公共网站只接模型 API；本地工作台保留两种研究后端，二者使用同一套领域 Skill 和计算工具。

本文对应包含代码工作台与图谱Agent工具的main版本。真实浏览器Python与本机MATLAB使用链路已实测，范围见[功能验收状态](DUAL_WORKBENCH_ACCEPTANCE.md)。

运行数据只保存在你自己的 `.local/`。原始教材、MATLAB、AT 求解器及 DSH 程序不随 GitHub 源码分发。

## 1. 准备环境

| 组件 | 用途 | 何时需要 |
| --- | --- | --- |
| Windows 10/11 x64、Git | 获取源码与运行已接入的Windows求解器 | 本教程的运行环境 |
| Python 3.12+ | 后端、数值计算、GSW/NetCDF和研究脚本 | 必需 |
| Node.js 22.13+、npm | 安装和构建网页 | 首次安装、更新网页时必需 |
| 供应商模型 API Key | 工作台自己的API研究代理和生成问答 | 选择“现有模型接口”时需要 |
| DeepSeek Harness 官方桌面版及其模型配置 | 本机DSH研究代理 | 选择DSH时需要；选择API时可不装 |
| 获授权的 MATLAB、配套 AT | 真实声场计算与MATLAB研究脚本 | 需要仿真时配置 |
| 课程资料包或自己有权使用的教材 | 私有原页、教材全文检索、包内AT | 可选；公开图谱与公开知识不依赖私有PDF |
| WOA18/ETOPO1 数据接口或本地原始数据 | 环境剖面、地图与季节诊断 | 做海洋环境研究时配置 |

本轮实际仿真使用 MATLAB R2024a。不要把某个维护者电脑的版本和路径当作所有机器的要求；其他 MATLAB/AT 组合应先运行检查与小算例。当前求解器发现和配方主要针对Windows `.exe`，本文不宣称Linux/macOS已完成相同验收。

在 PowerShell 检查：

```powershell
python --version
node --version
npm.cmd --version
git --version
```

## 2. 下载源码并安装依赖

在准备存放项目的目录执行：

```powershell
git clone --branch main https://github.com/Weijifen666/ocean-acoustic-workbench.git ocean-acoustic-course
Set-Location .\ocean-acoustic-course\ocean-acoustic-workbench
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd ci
npm.cmd run build
```

后续命令都在 `ocean-acoustic-course/ocean-acoustic-workbench` 执行。直接调用虚拟环境的 Python，不需要激活脚本，也不会替换系统 Python。完整安装 requirements，包含 NumPy、Matplotlib、NetCDF4 和 GSW；仅安装 FastAPI 不能完成研究脚本和海水诊断。

`npm run build` 生成本地 `dist/`。只安装npm依赖而未构建，后端即使启动也没有可展示的完整网页。

## 3. 初始化资料与计算环境

下面两种方式任选一种，之后都可以继续修改环境设置。

### 方式A：有老师提供的课程资料包

将下面路径替换为你自己的资料包：

```powershell
.\.venv\Scripts\python.exe backend/bootstrap.py 'D:/Course/大作业资料包.zip'
.\.venv\Scripts\python.exe backend/install_toolbox.py
```

`bootstrap.py` 读取课程包约定的 `05_知识库起步/` 元数据和 `03_工具与教程/at.zip`，导入原件并准备初始项目。它不是任意ZIP通用导入器。未知结构的ZIP应先整理，不能仅改文件名后当作相同课程包。

第一条命令仅抽取首轮所需程序和Munk输入。第二条将包内**完整AT**安装至当前用户的 `Documents/MATLAB/AcousticsToolbox/at`，并更新工作台的 `toolbox_path`。要使用其他研究配方，需要完整的 `tests/` 原始输入；只有几个exe和Munk文件不够。

安装脚本会备份既有 `startup.m`，登记AT根目录、`bin`、`ReadWrite`、`Plot` 和 `Misc`。这是MATLAB搜索路径配置，不是 `.mltbx` 安装包。

### 方式B：没有课程包，或已自备 MATLAB/AT

先初始化公开元数据和本地配置：

```powershell
.\.venv\Scripts\python.exe backend/init_local.py
```

首次初始化也可直接填写已经存在的程序路径；以下只是路径示例：

```powershell
.\.venv\Scripts\python.exe backend/init_local.py --matlab 'C:/Program Files/MATLAB/R2024a/bin/matlab.exe' --toolbox 'D:/Tools/at'
```

初始化只补缺失文件，不覆盖已有个人配置。若已经初始化过，后续改路径请在网页“模型与环境”中保存，不能期待再次传参覆盖原配置。没有AT的用户可以先浏览图谱、公开资料或配置模型，不能据此认定求解器已可运行。

无课程包时，私有PDF原页和全文索引为空。自备AT时，根目录应同时包含 `bin/`、MATLAB读取/绘图函数和原始 `tests/`。不要把“AT目录”填写为 `bin/` 本身。

### 检查 MATLAB/AT 配套

启动网页后在“模型与环境”设置：

- MATLAB：指向实际 `matlab.exe`。
- AT：指向完整AT根目录。
- 授权项目：指向你允许工作台读取的项目目录，可先用 `.local/project` 初始项目。

保存并运行页面的环境检查。MATLAB重启后，可在命令窗口核对：

```matlab
which('read_shd','-all')
which('read_modes','-all')
which('kraken.exe','-all')
```

输出应属于你选择的那套AT。旧exe与新版 `.mod/.shd` 读取器可能不兼容；不要对混合版本目录直接 `addpath(genpath(...))`，把旧读取器和 `matlab2026` 一起加入。工作台的模型配方会检查所需exe与算例输入，缺失时修路径或补完整发行包，不通过修改“available”字段假装就绪。

KRAKEL目前仍未开放基线创建。九张模型资料卡不代表九种求解器都能创建和运行。

## 4. 配置海洋环境数据

### 按需读取在线数据

在启动后端的**同一个PowerShell窗口**设置：

```powershell
$env:OCEAN_DATA_URL = 'https://ocean-acoustic-data-workbench.huuiihhuuiii.chatgpt.site'
```

这使用已发布的WOA18/ETOPO1数据接口，无需下载原始整包，也不需要模型Key。工作台会检查实际数据目录和激活版本；配置了URL不等于网络一定可达。年度、月度与季度温盐数据属于气候态，不是今天的实测海况。

### 使用自己的本地数据

如果已有原始数据，保留其 `ssp/` 与 `terrain/ETOPO1_Bed_g_gmt4.grd` 结构，改用：

```powershell
Remove-Item Env:OCEAN_DATA_URL -ErrorAction SilentlyContinue
$env:OCEAN_DATA_DIR = 'D:/Course/ocean-data'
```

云数据优先于本地目录；不要同时设置后误以为正在读取本地。切换来源后重启自己启动的后端。读取失败会报告错误，不会静默填补、外推或换另一套环境。详细格式和版本说明见 [云端海洋数据](CLOUD_OCEAN_DATA.md)。

## 5. 配置模型后端

### 使用工作台模型API

1. 启动工作台后打开“模型与环境”。
2. 选择实际供应商、账户已开通的具体模型和对应接口地址，填写自己的API Key。
3. 可先查询账户模型，再测试当前模型，成功后保存。目录预设只表示程序知道该标识，不保证你的账户有额度和工具调用权限。
4. 在“对话工作台 → 研究代理 → 对话后端”选择“现有模型接口”。

当前预设供应商包括 DeepSeek、阿里云百炼、Moonshot Kimi 和智谱GLM。按供应商官方API地域和产品线配置；例如按量模型API、Coding Plan及不同地域的Key不能随意混用。接口测试只证明这一请求被接受，不代替实际工具调用和复杂研究验收。

Key在本机 `.local/config.json` 和 `.local/model-profiles.json` 中保存，前端不读取已保存的完整Key。它们是本机私有配置，不应提交Git。切换同一供应商模型可复用已保存的供应商凭据，但模型原生上下文、工具能力和额度仍由实际服务决定。

### 使用 DSH Harness

1. 从 [DeepSeek官方Harness页面](https://www.deepseek.com/harness/)下载Windows桌面版。当前桥接支持已安装桌面包的ACP入口；仅运行 `npx ... web` 不等于安装了该桌面布局。
2. 先在DSH中配置自己的模型供应商或登录方式，并完成一次真实短对话。DSH凭据由DSH自身管理，不从工作台API设置自动复制。
3. 标准安装位置会被尝试发现；自定义安装时，在启动后端的同一终端指定实际程序：

```powershell
$env:OCEAN_DSH_EXECUTABLE = 'C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe'
```

4. 通常保持DSH默认配置目录。只有自己确实使用了另一份配置时，才另外设置 `OCEAN_DSH_HOME`，指向那份已经配置好的DSH home。新版默认一般为用户的 `.dsh`，旧桌面布局使用自己的应用配置目录；不要把别人的凭据目录复制过来。
5. 重启自己启动的工作台后端，选择“DSH · 完整 Agent”。

可检查桥接：

```powershell
Invoke-RestMethod 'http://127.0.0.1:8765/api/research/dsh/status'
```

`available=true` 表示ACP启动与握手成功，`authenticated=null` 不表示模型已认证。随后发送：“只列出研究技能并加载 at-environment，说明适用范围，不执行计算。”查看真实工具调用记录和最终回答，才能验证模型与MCP链路。

工作台按任务注册临时MCP工具。DSH的模型设置、上下文管理和会话由DSH处理；模型在哪台机器推理，取决于其连接的服务。本项目不随DSH桥接下载大模型权重。

### 已有 Codex 的可选入口

工作台还保留本机Codex接入，可在已安装并完成登录的电脑选择“Codex · 本机 Agent”。它使用Codex自己管理的凭据和工作台注册的工具，不替代上述两种配置。本教程不要求安装它。

## 6. 启动、检查与日常使用

首次配置建议前台运行：

```powershell
.\.venv\Scripts\python.exe backend/app.py
```

打开 **http://127.0.0.1:8765/**。在此终端按Ctrl+C正常关闭服务。修改DSH路径、海洋数据或运行目录等环境变量后，需要关闭自己启动的旧服务，再从配置好的终端启动；启动器复用旧进程时，不会替它换环境。

后续可运行：

```powershell
.\start.ps1
```

“启动工作台.cmd”调用同一启动器。临时 `$env:` 设置仅对当前终端及其子进程生效；从资源管理器双击CMD不会继承另一个终端里的临时设置。自定义路径用户可将必要的环境变量和启动命令保存在自己忽略的 `.local/` 启动脚本中，或每次在同一终端设置后启动。

如果PowerShell不允许运行PS1，仍可用上面的Python前台方式启动，不需要为了本项目修改全局执行策略。查看启动错误时读取 `.local/server.stderr.log` 或前台输出。

另开PowerShell检查：

```powershell
Invoke-RestMethod 'http://127.0.0.1:8765/api/health' | Select-Object version, knowledge_cards, matlab_available, solver_available, model_configured
Invoke-RestMethod 'http://127.0.0.1:8765/api/research/capabilities'
(Invoke-RestMethod 'http://127.0.0.1:8765/api/model-workflows').models | Select-Object id, supported, available, missing_executables, missing_inputs
```

应分别判断：图谱能否载入、当前模型后端能否真实回答、海洋数据能否查询、计算程序和算例能否运行。`model_configured` 检查的是工作台API配置，不能用它否定已经配置的DSH。环境检查通过也不证明某个仿真已经完成。

## 7. 第一次完整试用

### 图谱与问答

打开知识图谱，选择“Munk理想剖面”，查看公式与条件；用“关联路径”查询概念连接，再点击“就此知识提问”。要求模型保留资料出处，区分理想剖面与实测环境。未接入的教材页会提示不可用，不会出现生成的假原页。

### 写一个研究脚本

需要直接编辑时，先打开“代码与分析”。载入Python示例、展开输入CSV并点击“运行Python”，检查标准输出、PNG与JSON下载。代码最多50,000字节，CSV最多100,000字节；超限先取数据子集。点击“让AI检查或修改”，模型可按草稿ID读取当前内容，保存修改仍需匹配修订号，防止覆盖其他窗口的更新。

本轮已实际通过浏览器Python示例（6个样本、JSON与PNG）、10秒超时、初始化/运行中停止，以及本机Python/MATLAB读取CSV和输出CSV/PNG。网页本机任务可从“任务与结果”取消。Python输入CSV是全局变量input_csv/INPUT_CSV中的文本，也可读input.csv，不能当作环境变量或文件路径。

浏览器计算使用WASM/Pyodide，首次需下载并校验约27MB公开运行依赖；随后在禁用网络的隔离线程内执行，只接收明确载入的CSV。支持Python标准库、NumPy与Matplotlib，不提供任意pip安装、MATLAB/AT二进制或本机磁盘访问。它会占用当前设备的浏览器资源，与云端大模型推理是两件事。可选10/20/60秒运行上限，点击停止会终止该计算线程。保存的是浏览器运行回执，不能据此声称服务端复算或物理精度已获证明。

本地完整工作台还有“在本机运行”：先保存草稿，再把该ID和修订交给本机执行器；Python与MATLAB都从独立任务目录读取`input.csv`，并提供`input_csv`和`INPUT_CSV`变量。任务记录保存源修订及代码、CSV的SHA256，结果以“任务与结果”的真实状态、退出日志和产物为准。没有配置MATLAB时明确报错，不把MATLAB源码交给Python执行。运行期间若另一窗口修改了草稿，旧任务仍保留，但不会把旧输出挂到新代码版本。

本机运行具有你的本机权限，不采用浏览器的WASM隔离；只执行自己信任并明确选择的代码。公共网站不会通过这个入口取得本机执行权限。需要Agent自行规划任务和工具调用时，再使用下面的研究代理流程。

在研究代理中明确授权一个独立任务，例如：

> 创建一个独立Python研究任务，生成100–200 Hz的示例数组，计算均值并画图，保存CSV和PNG；实际运行后给出任务ID、文件名和退出状态。数据为自造演示，不称为海洋观测。

看工具轨迹是否真的创建、写入、运行并完成报告，再到“任务与结果”打开CSV/PNG。只在聊天里输出代码不能算已经运行。项目文件页用于只读浏览；研究写入使用独立任务目录，避免把原始教材或AT输入当作临时输出覆盖。

本地研究脚本具有你的本机权限，不是面向陌生人的安全沙箱。公共网站只开放它实际注册的执行能力，本机权限不会因界面相似而自动发布。

### 跑一组小型声场

在“声场仿真”的手动配置中先用小任务：KRAKEN、Pekeris 100 m环境、100 Hz、源深50 m、接收深50 m、0.1–2 km、距离和深度各51点。先检查计划，再提交。

到任务页确认实际状态为SUCCEEDED，核对频率、源深、网格、PNG、CSV和结果包。这个小例只检验计算链，不证明所有新海域的精度。若没有KRAKEN/FIELD或匹配输入，先修环境，不通过改任务状态绕过。

### 数据与结果分析

在海洋数据页用120°E、20°N读取年平均和一个月份，核对实际温盐格点、有效层深度与缺测；CSV/JSON导出后可用于自己的分析。点击“用于声场仿真”后再确认有效水深、频率、源/接收深度和海底参数，单点剖面不等于完整传播环境。

需要混合层研究时，让研究代理加载 `seasonal-layer-diagnostics`，实际调用标准诊断工具，保留温度和位密度判据、数据版本与缺测状态。已有声场做数值比较时保持环境、输出坐标、参考约定和有效掩码一致。数据分析、执行成功、数值稳定和物理精度分别报告，不能相互代替。

### 保留失败和未完成项

停止Agent只停止继续调度；已经提交的计算在任务页分别取消。上游繁忙、预算不足或Agent未完成归档时，先查看原任务和已有文件，再续接；不要为“重试”重复计算同一任务。

[上一轮实际验收](FUNCTIONAL_VALIDATION_2026-11-03.md)中，直接计算的八个模型配方与四季诊断通过；DSH只读技能调用通过，但自主诊断归档两次未通过。它们属于不同验收层，教程不保证每个模型都能在固定时间内自动完成所有研究。

## 8. 教材全文与私有数据

课程包导入原件不等于全文已建立索引。按 [知识入库说明](KNOWLEDGE_IMPORT.md)创建包含所有目标来源的manifest，再运行：

```powershell
.\.venv\Scripts\python.exe backend/ingestion.py --manifest .local/kb/my-manifest.json
```

查看报告中的处理页、已索引页、空白/短文本及需复核页。没有OCR或公式布局核验时，不把文本可提取称为教材完整理解。再次入库是按该manifest重建索引，需保留的来源应写在同一清单中。

`.local/` 包括模型配置、会话、任务、教材原件、正文索引和验证凭据，继续保持私有。S21–S24等新增原课件没有随GitHub分发；仅有来源条目不能提供原件或全文。外部资源权利见 [NOTICE](../NOTICE.md)。

## 9. 更新与检查

更新前完成或取消自己正在执行的任务，并关闭自己启动的后端。保留 `.local/`，不要用别人的数据库或配置整包覆盖自己的数据。数据库备份与恢复需用SQLite的一致性备份方式，步骤见 [部署说明](DEPLOYMENT.md)。

```powershell
git pull --ff-only
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd ci
npm.cmd run build
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
```

软件回归通过不等于已经使用真实Key或MATLAB。升级后再做第7节的小型实际任务；供应商、DSH和AT更新也应重复这一层检查。当前程序和验证协议见 [科研检查说明](RESEARCH_SCIENCE_VALIDATION.md)。

需要自定义运行目录的部署者，可先用 `init_local.py --runtime-dir` 初始化对应目录，再在启动后端前设置同一 `OCEAN_RUNTIME_DIR`。课程包导入与工具箱安装的路径支持应以对应脚本为准；不要只改一处环境变量后假定所有历史缓存都已经迁移。普通用户优先沿用默认 `.local/`。

## 10. 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 打开8765失败 | 看前台输出或启动日志；确认Python来自本项目虚拟环境、网页已经构建，端口由正确工作台占用 |
| 默认DSH报未安装 | 配置官方桌面版与实际exe路径，或先切“现有模型接口”；API后端不要求DSH |
| DSH“就绪”但无法回答 | 就绪只证明ACP握手；在DSH自身检查模型配置、凭据、额度和网络，再做只读技能试用 |
| API返回401/403/429 | 核对官方地域、Key、模型权限和额度；请求失败不等于换个Harness就能绕过服务限制 |
| MATLAB可用但某配方不可用 | 检查完整AT根目录、对应exe、原始tests输入及读取器版本；看 `missing_inputs` 与 `missing_executables` |
| Python研究脚本缺numpy/gsw | 确认后端用安装过完整requirements的虚拟环境启动；不要只给主进程临时加PYTHONPATH代替依赖安装 |
| 海洋数据未连接 | 确认在后端启动前设置OCEAN_DATA_URL或本地目录，检查接口网络与版本；陆地/缺测拒绝不等于网站故障 |
| 原页图片不可用 | 检查对应授权PDF是否导入该运行目录；公开图谱与来源名称不会自动提供原件 |
| 只看到代码没有图表 | 检查是否实际调用运行工具、进程退出码及任务报告；聊天文本不能充当计算结果 |
| 换了DSH模型但工作台API没变 | 两套模型配置分别维护，先确认正在使用的“对话后端” |

公共网站发布、个人空间与专属计算节点连接见 [部署说明](DEPLOYMENT.md)；无需为了本机使用而把本地管理端口暴露到公网。
