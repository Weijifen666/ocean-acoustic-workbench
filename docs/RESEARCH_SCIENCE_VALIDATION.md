# 科研 Agent 的方法与数值检查

本次增强用于本地完整应用 `ocean-acoustic-workbench/`。它固定常见诊断方法，核对明确范围的数值差异，并区分执行、Agent 自评与程序检查。阴性或证据不足的结果可以正常归档；任务完成不表示物理精度已获证明。

## 标准剖面诊断

`diagnose_ocean_layers(lon, lat, periods, reference_depth_m, density_threshold, temperature_threshold, id?)` 读取已配置海洋数据接口，复用 `skills/seasonal-layer-diagnostics/scripts/analyze_profiles.py` 的唯一数值算法：

- GSW `p_from_z(-depth, latitude)` 计算海水压力；使用位温和位密度。
- 默认采用 10 m 点参考、位温差 0.2℃、位密度差 0.03 kg/m³；实际参数随结果保留，可按研究目的改变并注明。
- 取首次阈值穿越并线性插值；没有穿越、缺少参考层或存在内部缺测时保留相应状态，不填成确定深度。
- 表面声道只报告首个表面连通声速极大候选，不据此宣称实际俘获模态或严格截止频率。

结果包含请求/实际格点、有效深度、缺测、数据来源、输入哈希、方法版本、实现哈希及依赖版本。传入未完成的研究任务 `id`，会保存冻结剖面、结果和程序计算记录；纯诊断可直接归档，绘图再运行读取冻结数据的脚本。

## 声场区域数值比较

`evaluate_acoustic_checks(id, spec)` 当前只支持同配置的两级 `refinement` 比较，不直接检验跨频率或跨模型效应。两个 NPZ 位于任务目录内，文件名不含目录；字段为：

```text
tl_db[depth, range]  二维传播损失
z_m[depth]          严格递增的深度坐标
r_km[range]         严格递增的距离坐标
frequency_hz, source_depth_m, environment_id,
tl_reference, field_type, model  六项标量控制元数据
```

示例 `spec`：

```json
{
  "baseline_file": "base.npz",
  "refined_file": "fine.npz",
  "comparison_kind": "refinement",
  "roi": {"depth_min_m": 0, "depth_max_m": 50, "range_min_km": 2, "range_max_km": 48},
  "threshold_db": 1.0,
  "min_common_valid_ratio": 0.9,
  "min_common_points": 20
}
```

工具要求相同输出坐标，仅用共同有限采样点，报告覆盖率、绝对差中位/P95/P99/最大值、超阈比例、平均 dB 和能量平均对应的 TL。不会隐式插值、平滑或将 NaN 填值。控制元数据不足或覆盖不够时为 `inconclusive`；不一致的控制条件会拒绝比较。元数据来自产物声明，工具不能独立证明这些声明真实。

`stable` 仅表示指定区域满足本次所选两级差异标准。它不是严格收敛、真实误差界或物理准确性证明；若波束和步长同时改变，应称联合数值敏感性检查。跨频率/跨模型效应需另行受控分析。

## 归档与来源核对

`audit_research_task(id)` 只读核对已有执行与文件版本，支持已完成任务，不重跑原仿真。`run_research_script` 可通过 `inputs` / `outputs` 声明实际依赖并记录执行前后的 SHA256；未声明的依赖不在这项检查范围内。原地转换会保留输入、输出两版哈希。

程序检查凭据保存在所选运行目录的 `research-validation.sqlite3`，与 Agent 可写任务文件分开；归档报告包含当时的程序检查。读取任务详情时重新核对绑定输入与实现版本，发生改变则显示 `stale`。历史报告的 `checks` 标为 `authority: agent_self_report`，不能凭模型自填的 `passed` 或报告字段升级为程序验证。执行尚在运行、最后一个未修复步骤失败、或声明文件版本不符时不能提前完成归档。删除任务时同步清除它的凭据。

这是防止误用自评和过时证据的来源机制，不是任意本地脚本的安全沙箱，也不是对所有自然语言结论的自动证明。

## 公共端范围

公共应用共用生成后的 Skill 资料，但仍按当前注册工具执行。`diagnose_seasonal_layers` 是既有的原位温度阈值四季诊断，不等同于本地位温/位密度双判据工具。上述三个本地工具及任意 Python/MATLAB 执行没有因此开放给公共访客。公共结果页显示报告携带的信息时，不把其中的程序身份字段当成当前公共服务独立验证的证据。

更新共享资料后运行 `node scripts/generate-public-research.mjs`；构建也会生成。GitHub main 的源码更新不自动发布网站。

## 验证

在安装 `backend/requirements.txt` 与前端依赖后，在本地应用目录运行：

```powershell
python -m unittest discover -s tests -p "test_*.py"
python tests/check_research_tasks.py
node tests/check_research_ui.mjs
npm.cmd run build
```

新增测试使用隔离文件和合成剖面/声场，不要求下载老师的数据包、启动 MATLAB 或调用付费模型。它们覆盖诊断状态、区域/掩码与统计、控制元数据、凭据失效、自评隔离、旧任务只读及执行收尾守卫。软件测试通过不替代具体研究任务的模型适用性、基准或观测验证。

另在仓库根目录运行 `npm.cmd run test:cloud`、`npm.cmd run build` 与 `git diff --check`，确认公共协议、共享资料和构建兼容。依赖与已有本地安装要求相同；配置、私有任务、凭据数据库和研究结果不提交 Git。
