---
name: seasonal-layer-diagnostics
description: 研究某点或区域混合层的季节变化，优先调用标准温度/位密度阈值诊断，解释缺测、判据差异与空间尺度。
---

# 混合层季节诊断

明确研究点或经纬范围、季节/月、要回答的量（例如双判据 MLD 及季节差值）。用户只说“某区域”且无范围时先澄清，方法说明可以继续；不以任意一点替代区域。四季用 WOA18 原始季节场13–16；月场1–12与季节场深度范围不同。结果称为气候态诊断，不称全年逐月实测。

优先调用 `diagnose_ocean_layers(lon, lat, periods, reference_depth_m, density_threshold, temperature_threshold)`，四季通常指定 periods 为13、14、15、16，参考10 m、位密度增量0.03 kg/m³、位温绝对偏差0.2°C。保留工具返回的实际参数、方法版本、来源及状态；用 `get_ocean_profile` 查看 requested/selected、数据版本和缺测。标准诊断可直接回答单点季节问题，无需 AT 仿真。

标准方法是10 m参考值、首次阈值穿越的线性定位，温度用位温，密度用 TEOS-10 sigma0；不能替换成0–10 m平均、首个离散深度层或原位温度后仍称同一方法。判据依据 de Boyer Montégut et al. 2004，https://doi.org/10.1029/2004JC002378 。标准工具缺失时读取并复用 `scripts/analyze_profiles.py`，在可执行的研究目录运行其 `--profiles` 冻结剖面输入；不自行重写温密阈值算法。该 CLI 使用默认判据；非默认参数可复用已读取的 `diagnose` 函数明确传参，不臆造 CLI 选项。自定义判据作为明确命名的方法变体，保留参数与标准结果的区别。

逐项保留无阈值交点、参考深度不足、内部缺测与未计算的原始状态及有效深度界限；无交点给出范围限制，不拿最深层当作 MLD。比较0.02/0.03/0.05 kg/m³等阈值属于敏感性实验，不当作三套真值。

区域研究按实际1°格点去重，报告海岸遮罩、有效点数、共同季节覆盖及面积权重；先逐点诊断后汇总，平均剖面诊断不等于 MLD 空间平均。季节比较使用相同格点集合，另报被排除格点；覆盖不足时缩小结论范围。做方法对比或区域统计前，用 `read_skill_resource(id="at-environment", path="references/scientific-evidence.md")` 读取共同掩码与证据规则。

按用户需要交付数值表、季节图与温盐声速图。需要任务记录时创建普通研究任务，将其 `id` 传给 `diagnose_ocean_layers`；工具可直接保存冻结剖面、诊断结果与程序执行记录，纯 MLD 任务无需另造求解脚本即可 `finish_research_task`。需要图时再写整理/绘图脚本，用 `run_research_script` 的 `inputs` / `outputs` 声明工具实际返回的文件名及图表，保留前后 SHA；提交前用只读 `audit_research_task(id)` 核对。Agent 自评使用 `authority: agent_self_report`，与程序 `scientific_validation` 分列。回答“无明确季节差异”或“覆盖不足无法判定”同样有效，结论限于实际剖面、判据和时空范围。
