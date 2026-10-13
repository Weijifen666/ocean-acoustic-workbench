# 海洋与西工大课程主题设计 · v0.6

本项目是四人小组课程作业，无任何商业用途。界面中的校名、校训和三航文字说明课程背景；项目不是学校官方平台，原创探测员“小航”也不是官方吉祥物“航小天”。

## 官方主源与使用边界

- [西北工业大学章程](https://xxgk.nwpu.edu.cn/info/1051/1951.htm)：学校英文简称为 **NPU**，办学特色包括航空、航天、航海，校训为“公诚勇毅”。章程给出标准色为 CMYK C100 M70；本项目的网页蓝色是自行选择的课程配色，不声称是官方色彩转换结果。
- [2017 年航小天正式发布](https://news.nwpu.edu.cn/info/1002/48666.htm)：这是西工大航天学院学生设计的中国航天日活动吉祥物。官方图像表达青春、亲和、科学探索的气质。
- [航天学院 2022 年原创形象设计活动](https://hangtian.nwpu.edu.cn/info/1804/17512.htm)：包含官方形象范例，活动投稿版权归学院。该页面没有向本项目授予任意复制、开源再分发官方角色的许可。本轮借鉴探索者气质，自行绘制海洋探测员，不复制官方图片或人物路径。
- [学校新 VI 及使用示例](https://news.nwpu.edu.cn/info/1210/74474.htm)、[文化建设管理办法](https://news.nwpu.edu.cn/info/1212/80139.htm)：校标、标准字体、标准色及组合有使用规范。本项目采用校名文字及原创航空器、火箭、潜航器线稿，没有使用或改造官方校徽。

## 视觉系统

深海藏蓝侧栏与浅色科研纸面并列，湖蓝用于操作选中态，砂金仅用于小尺度装饰。课程主题 Banner 只在知识图谱页面显示；聊天保留消息、输入框与必要控件的空间。原创海面、海底层次与三航线稿只表达课程主题，不作为仿真数据或已经执行的声场结果。

`ocean-theme.css` 在既有样式后导入，统一配色与信息层次，正文与表单使用约 14 px。知识图谱仍可切换浅／深色；选中状态、公式、图文来源和关系语义保留。手机收起侧栏，减少装饰图的对比度，知识详情采用可关闭的覆盖面板。

## 原创探测员与快捷问答

`MascotFigure.jsx` 是手工编写的 SVG：白蓝海洋探测服、独立绘制的眼镜、探测头盔、波纹胸牌、不同的轮廓与脸部结构。原始 SVG、CSS 及组件随本项目源码开源，没有下载或转存官方人物图片。名字“小航”表示课程探索伙伴，不将角色标记为官方“航小天”。

- 空闲轻浮与眨眼、悬停／收到回复时挥手、请求处理中轻摆与设备灯动画；所有动作与真实共享对话状态绑定，没有声音，也不声称模型已有实体能力。
- Pointer Events 兼容鼠标与触屏；移动超过 6 px 才视为拖动，松手不会误发送或误开聊。位置被限制在当前视口内，窗口变化后重新约束。
- 方向键可移动，Enter／Space 打开或收起，Escape 关闭快捷问答；显示菜单可恢复默认位置或收起人物。位置偏好只保存坐标，不保存 API Key、对话或访客凭据。
- 挂载或切换工作区域时若默认人物位置遮住仿真确认、发送等主要按钮，会尝试避让；用户也可拖动或收起人物。
- 快捷面板与完整“知识问答”页面都从 `ChatProvider/useChatSession` 读取同一份消息、草稿、供应商、具体模型、知识范围和 busy 状态。浮窗没有第二个历史请求循环或独立聊天 API。
- 快捷窗口与主问答共用 `ChatComposerControls`：输入框底部为模型、上下文、更多、发送；“更多”收纳知识范围、Agent、来源/缺口与连接设置，避免占用消息空间。默认“资料 + 模型知识”，可改为“仅依据资料”。来源链接只允许课程 API 相对地址或 HTTPS。
- 上下文为 4K–128K 的实际发送输入预算，自动 32K，后端裁剪并记录用量；不是模型原生窗口或 KV cache 的大小。供应商未返回缓存用量时显示“未提供”，不凭选择档位宣称缓存已命中。
- 知识图谱“学习资源”增加公开海洋来源区，展示中文标题、自写导读、机构、URL、许可与时间。30 篇 NOAA 正文和 9 条导读可直接查看，无需 Key；3 个动态入口不被描写成已接通实时数据。
- 手机面板宽度留出视口边距，高度不超过 70dvh；较矮视口减少非交互说明，保留模型选择、知识范围和发送动作。
- `prefers-reduced-motion` 下停止人物动作，避免让必要操作依赖动画。

## 集成

App 根部使用 `ChatProvider`；`<OceanBanner/>` 仅在 `page === "graph"` 时显示，聊天没有课程 Banner。公共网页与本地管理前端共用这一布局。`<MascotDock onOpenChat={...} onOpenSettings={...} onKnowledge={...}/>` 位于主页面结构之外、Provider 之内，回调进入完整问答、模型设置和指定节点，浮窗不读取或控制访问设备本机 MATLAB。

主题与人物由 `OceanBanner.jsx`、`MascotFigure.jsx`、`MascotDock.jsx`、`mascot.css`、`ocean-theme.css` 提供，v0.6 的共同输入控件为 `ChatComposerControls.jsx` 与 `chat-controls.css`。SVG 路径、轮廓、眼镜、波纹胸牌和三航线稿均为项目原创，未使用官方图像文件。共享会话、移动端、拖动与公网请求以 [VALIDATION_V0_6.md](VALIDATION_V0_6.md) 为准。

聊天中的模型选择与配置入口参考 [WorkBuddy 官方模型配置](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)和[任务上下文说明](https://www.codebuddy.cn/docs/workbuddy/Create-Task)，没有复制其品牌资产或完整 Agent。上下文预算与供应商缓存的区别依据 [DeepSeek 官方说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)及[百炼官方说明](https://help.aliyun.com/zh/model-studio/context-cache)，技术实现见 [KNOWLEDGE_EXPANSION.md](KNOWLEDGE_EXPANSION.md)。
