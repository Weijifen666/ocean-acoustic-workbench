# 海洋声学课程工作台 UI 调研与本轮实现

## v0.7 海洋动漫界面（2026-10-15）

实际改编 [Fuwari](https://github.com/saicaca/fuwari) 固定提交的 card-base、btn-regular、float-panel 与主题色变量，保留完整 MIT 许可。侧边栏、图谱横幅和问答欢迎区使用项目原创透明海洋研究员图；配色、波浪、卡片和留白围绕课程工作台重新组织。

互动角色实际使用 [Sakana Widget](https://github.com/dsrkafuu/sakana-widget) 4.0.0 的 core 入口，只注册项目原创图。桌面保留弹性动作和拖动；手机使用紧凑圆头像，自动避让输入框、引用与课题控件。许可保留在 `src/vendor/`。没有采用默认版权角色或西工大官方形象素材。

输入框底部集中放模型、上下文和发送；主问答与浮动窗口共用同一会话和请求状态。新增独立会话选择、Markdown/公式/代码/表格、资料抽屉、参数草案和共享课题。说明文字前景在白底达到至少 5.30:1 的对比度；390 × 844 手机界面检查无页面横向溢出。

桌面、手机、短视口与旧拖动坐标均有停车回归；手动检查代码复制、模型/预算切换、中止部分回答、共享笔记与浮动助手。最终发布与科学验证见 [v0.7 验收](VALIDATION_V0_7.md)。下面保留先前调研记录，其“本轮”指当时版本。

调研日期：2026-10-13。项目路径：`outputs/ocean-acoustic-github/ocean-acoustic-public`。

## 实际参考及许可证

| 项目／官方文档 | 实际学习的交互 | 当前核对的许可证与处理 |
| --- | --- | --- |
| [JupyterLab 官方界面](https://jupyterlab.readthedocs.io/en/stable/user/interface.html)、[源码](https://github.com/jupyterlab/jupyterlab)、[许可证](https://github.com/jupyterlab/jupyterlab/blob/main/LICENSE) | 工作区、课程／文件目录、紧凑标签栏、浅色细边框、内容与属性面板分区 | BSD-3-Clause；本轮参考交互结构，自行编写 JSX/CSS，没有导入其组件源码、商标或图片 |
| [VS Code 官方界面](https://code.visualstudio.com/docs/getstarted/userinterface)、[源码](https://github.com/microsoft/vscode)、[许可证](https://github.com/microsoft/vscode/blob/main/LICENSE.txt) | 左侧功能导航、路径面包屑、中央内容区、右侧详情、底部状态栏，键盘导航 | MIT；参考信息布局，本轮没有复制其产品图标、Logo 或样式源码 |
| [AntV Graphin](https://github.com/antvis/Graphin)、[许可证](https://github.com/antvis/Graphin/blob/master/LICENSE)、[G6 官方入门](https://github.com/antvis/G6/blob/v5/packages/site/docs/manual/getting-started/quick-start.en.md) | 图分析画布、节点选择、关联节点、路径高亮、拖动缩放、控制面板 | MIT；学习图分析模式，保留已安装 Cytoscape，避免为 53 个节点更换一整套引擎 |
| [Neo4j Browser](https://github.com/neo4j/neo4j-browser)、[许可证](https://github.com/neo4j/neo4j-browser/blob/master/LICENSE) | 关系图与属性、来源详情并列查看 | GPL-3.0；只研究界面行为，没有复制或链接其实现 |
| [LobeHub／LobeChat 许可证](https://github.com/lobehub/lobehub/blob/main/LICENSE) | 供应商／具体模型配置、连接信息与账号能力的区别 | 当前许可证含 Apache-2.0 之外的附加商用条款；本轮没有直接移植其组件源码 |

本轮直接使用的已有开源组件仍是 React、Lucide 和 Cytoscape。Cytoscape 为 MIT；Lucide 为 ISC，部分 Feather 图标版权遵循 MIT。安装包内 LICENSE 保留，项目的第三方说明应继续注明这些实际依赖。界面不是上述任何产品的完整复制，也没有复制网上未经授权的截图作为页面资产。

## 为什么适合当前课程

课程主要动作是“查看概念与公式→核对原始资料→检查仿真参数→运行与分析”。旧界面的星球导航、蓝色渐变大横幅、反复出现的英文营销式标题和大量圆角卡片挤压了这些内容。科研工具的布局让目录、图与证据占据主要空间，视觉层次由工具栏、表格、选中状态和细边框承担。

本轮实际改动：

1. 白色／浅灰工作区，单一低饱和蓝色主色；导航 190 px，顶部 52 px，底部 27 px。手机改为菜单抽屉；`Alt + 1–6` 切换功能。
2. 课程总览变为单元目录列表：每个单元显示主题、知识点数量和阅读数，每个知识点都能直接点击。不再使用星球、光晕或巨幅装饰。
3. 图谱仍保留全部关系、单元关系、三种布局、三类关系开关、关联路径、已读／收藏。节点变为有文字的小矩形，单元图选中节点后知识详情在右侧停靠；空间较小时收起重复目录；手机详情覆盖画布，可关闭返回。
4. 知识详情继续显示解释、公式、条件、易错点、项目示例、示意图、教材原页、语义关联和仿真入口。节点色彩仅表达所属单元，节点数据与来源未改变。
5. 模型目录改为紧凑行列表，保留具体供应商、显示名称、API 模型 ID、官方文档、账户模型查询和实际连接测试。模型密钥加密保存文案与本轮云端实现对齐，新增清除我的全部密钥操作。
6. 问答支持展开检索依据：匹配 `evidence_id/id/citation_id`，显示摘要与来源页；可打开教材原页或跳回知识节点。学习资源页展示真实索引数量、OCR 缺口与维护者导入方式，不宣称已训练大模型或已启用向量数据库。
7. 仿真页新增课程命题选择，明确点击“填入参数”后才修改配置；随后仍须检查与提交。对照题支持分别填入两份计划；缺条件或未支持题显示为分析题。
8. 结果页支持确定性数值分析与解释边界，不把求解成功视为实验验证，也不按一次 Munk 结果给真实海域排名。重跑参数只发送后端允许的 Plan 字段。
9. JSX/CSS 使用 Prettier 展开原压缩源码，便于四人小组审阅与继续协作。图谱交互继续使用已有 Cytoscape；后端入库与云端部署的改动见对应技术记录。

## 本轮验证

- Vite 构建通过；未添加新的生产依赖。
- CUA 实际检查默认桌面视口的课程目录、单元图与停靠知识详情。
- CUA 390 × 844 手机断点检查：页面无横向溢出；单元目录可直接点击；SSP 详情、示意图、公式、页码链接及滚动区域正常。检查后恢复默认视口。
- 截图：`outputs/工作台_v0.4_课程目录.png`、`outputs/工作台_v0.4_知识关系与详情.png`、`outputs/工作台_v0.4_手机知识详情.png`。
- 未替用户发起付费模型测试；实际模型调用是否可用仍由供应商 API Key 与测试响应决定。
- 后端整合后已验证 `/exercises`、`/knowledge/status`、访客密钥清除与 `summary.analysis`；真实公网 MATLAB 作业成功，记录见 `VALIDATION_V0_4.md`。

## 继续维护的重点

`main.jsx` 负责功能切换、问答、仿真、任务与文件；`GraphExplorer.jsx` 负责目录、图谱与证据详情；`ModelPanel.jsx` 负责访客模型连接；`workbench.css` 是本轮工作台视觉与响应式规则。现有 `style.css/graph.css/models.css` 保留结构性基础规则，通过最后导入的 `workbench.css` 覆盖旧表现，后续可在功能稳定后逐步合并冗余选择器。

课程用途声明显示于导航底部及仓库 README。它说明本项目的实际使用目的，不改变第三方许可证或 MIT 许可证允许的权利。
