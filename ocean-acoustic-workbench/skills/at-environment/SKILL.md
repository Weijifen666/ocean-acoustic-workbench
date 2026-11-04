---
name: at-environment
description: 根据本机 Acoustic Toolbox 的 tests 和 MATLAB 源码构造 ENV、FLP 及运行链，复现、扩展和核验声场算例。用于实际 AT 研究与输入格式核对。
---

# AT 环境构造与算例复现

教材和Skill提供方法与引用，模型可结合通用声学知识补充定义、推导、例子和相关理论。基础理论问题直接清楚回答，按需查资料；具体海况、实验数值和仿真结果使用实际数据或任务记录。引用保留实际出处，资料与通用解释自然整合。

先把问题落到可测量量：指定海域或理想环境、时段、频率/几何、要比较的变量，以及用什么指标回答。只问用法时解释条件与输入；只需混合层或声速结构时转入 `seasonal-layer-diagnostics` / `surface-duct-investigation`，优先用 `diagnose_ocean_layers` 取得标准诊断，无需为此启动声场求解器。

创建指定模型任务时，先载入对应 `at-kraken`、`at-krakenc`、`at-scooter`、`at-bellhop`、`at-ram`、`at-simplepe`、`at-sparc`、`at-bellhop3d` 或 `at-krakel` 技能及其 `references/workflow.md`。使用 list_model_workflows 查创建配方和程序可用性；prepare_model_research_task 在独立目录冻结原例输入并生成脚本，创建后仍须实际运行和验证。其他算例或开放研究按源码构造，不能用默认算例替代用户研究环境。

按模型查用法时先读取 references/models.json，其中分列KRAKEN、KRAKENC、SCOOTER和BELLHOP的适用条件、输入配置、调用流程与验证范围。

研究RAM或PE时读取 references/ram-and-pe.md；查算例目的与入口时先读取 references/casebook-summary.json，再按需读取 references/casebook.json 中的调用行证据。实际运行覆盖见 references/validation-latest.json，包含未收敛观察和读取器问题；跨模型与解析验证的通用规则见 references/validation.md。RAM、SimplePE、SPARC、BELLHOP3D和KRAKEL均单独列在模型经验中，不能把PE、时域、3D输出套入二维单频声场。

先明确物理问题、所需观测量、环境是否随距离变化和数据来源，再选择求解器。选型时先按水深（浅海/深海）× 频段（<500 Hz / >500 Hz）× 距离无关/变化（RI/RD）查 references/applicability.md 的适用性矩阵，再落到具体程序；矩阵是定性经验，收敛仍按专项 workflow 检查。用 list_at_examples 和 read_at_file 查最接近的本机算例，并按需读取 references/input-and-functions.md。索引中的签名只用于发现；使用某函数前读取其源码和测试调用。

在 create_research_task 返回的独立目录复制算例及依赖，保存原始路径、SHA256 与改动清单。用 write_research_file 写脚本，再用 `run_research_script` 实际运行；建议在其可选 `inputs` / `outputs` 普通文件名数组中声明实际依赖和产物，保存执行前后 SHA。原地变换可将同一文件同时列为输入/输出，保留前后版本。保持工作目录为任务目录。MATLAB 路径必须固定为与 `bin`（2018 版 exe）配套的旧代码：`genpath(AT路径)` 会连带加入 `AT/matlab2026`（2026 版读取器，`.moA`/新 `.mod` 格式，读不了 2018 版 `.mod`），务必排除它并把 `AT/ReadWrite` 提到最前：

```matlab
parts = strsplit(genpath(AT), pathsep); parts = parts(~contains(parts,'matlab2026'));
addpath(strjoin(parts,pathsep),'-begin'); addpath(fullfile(AT,'ReadWrite'),'-begin');
```

加载后先核对 `which('read_modes')` 指向 `AT/ReadWrite/read_modes.m`，`which('kraken.exe')` 指向 `AT/bin`。若要 `.moA`/新格式，必须同时换用 2026 编译的 exe 与 2026 读取器，不能混搭。源文件保持只读。

已有可复用的运行链时沿用其验证记录；接入新模型或新调用链时先复现相应原例，再改变研究变量。当前表单无法表达多层、距离相关或特殊声道时，按本次工具权限写独立 ENV/FLP 和脚本，不为适应表单改换研究问题。ENV 选项不能跨求解器直接照搬，读取该求解器的 tests 及 read_env/write_env 分支。

比较频率效应、模型或数值设置，或准备声场研究报告时，先读 [科学证据与比较协议](references/scientific-evidence.md)。`evaluate_acoustic_checks(id, spec)` 当前只接受同频、同模型、同源/环境/归一化的 `refinement` NPZ，按引用中的固定轴与元数据准备，再指定 ROI、共同掩码和阈值；跨频或跨模型效应由研究脚本另作受控分析，不能直接送此工具。一次改变一个数值控制量用于单变量稳定性检查；同时改变波束与步长属于联合敏感性实验。两级差异只报告为观察到的数值差异，不称真实误差界。

完成实际计算后检查exe/PRT、输入与输出坐标、叠加方式、源归一化和有效覆盖，保存研究所需的输入、脚本、数值和图表。提交前用`audit_research_task(id)`核对执行、版本与产物；修改数据或脚本后重跑受影响的步骤。`finish_research_task`分别保存Agent分析与程序的scientific_validation检查，记录实际结果、未收敛现象和后续建议。

WOA18、混合层与表面声道技能可按问题选用。按实际工具返回的状态交付方法、计算结果与下一步建议，回答重点放在研究问题本身。
