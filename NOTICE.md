# 代码与外部资源 · v0.7

本项目仅用于海洋声学课程作业与教学展示，无任何商业用途；该用途说明不替代各部分原有许可证。

MIT 许可证适用于本仓库原创程序、原创原理示意图及自行撰写的中文导读；项目另提供原创造型的透明海洋研究员插画。第三方代码与素材保留自己的版权和许可。课程作业与无商业用途是项目用途说明，不覆盖原有开源许可，也不改变被引用教材、论文、课件、公共资料或声学工具的权利。

- MATLAB 属于 MathWorks，本仓库不包含 MATLAB 程序或许可证。部署者需自行确认所用许可证适用于预期运行方式。
- Acoustics Toolbox（AT）、KRAKEN/FIELD 由各自维护者提供，本仓库不分发教师资源包中的 AT 安装包或求解器二进制；请按其原始许可获取和使用。
- 教材、实验报告、课堂照片、课程原始 ZIP、规划书和 PDF 原页图片不包含在本仓库。知识点保留资料编号、页码及引用，原始资料需由有权使用的部署者自行导入。五份全书文本层索引为1789 / 1846页、4101个原文片段和57页待复核，保留在部署节点私有 `.local`，不随源码分发；历史验收中的4092是旧入库格式记录。真实 API Key、私有数据库及网页后台快照也不上传 GitHub。
- 公共 JSON 分发 30 篇 NOAA NOS 网页的清洗文字片段，依据 [NOAA NOS 使用与引用 FAQ](https://oceanservice.noaa.gov/about/faq.html)的公有领域说明，保留机构、原 URL、抓取/更新日期、哈希与使用限制。不分发 NOAA 徽标、照片、视频、音频或第三方署名素材，不暗示 NOAA 认可本项目；这些文字不被改称本项目原创版权。
- 另有 9 条项目自写导读与 3 个仅登记的动态入口。TEOS-10、Argo、ONC、UNESCO-IOC 等原站全文或具体数据集并未因登记链接而获得新的再分发许可；导读不是原文复制或官方译文。ONC 数据许可须逐数据集核对，不能把其数据政策当作网站全文许可。具体登记与刷新见 [OPEN_OCEAN_KNOWLEDGE.md](docs/OPEN_OCEAN_KNOWLEDGE.md)。
- npm/Python 依赖保留各自许可证；API 供应商的模型、计费和服务条件由对应供应商规定。
- [Fuwari](https://github.com/saicaca/fuwari)（MIT，Copyright 2024 saicaca）的样式按固定提交 `6d39b0dec41282e7852e23e032998a5789abee28` 改编为项目 CSS，保留版权与完整许可；未搬运其完整站点、默认图片、字体或品牌标识。原许可及改编样式位于 `ocean-acoustic-public/src/vendor/`，同步至本地前端的 `ocean-acoustic-workbench/src/vendor/`。
- [Sakana Widget](https://github.com/dsrkafuu/sakana-widget) 4.0.0 的 MIT 动画核心是实际依赖，通过 `sakana-widget/core` 使用；完整许可保留在依赖与 `src/vendor/sakana-widget-LICENSE.txt`。只注册本项目原创透明插画，未引入其默认动漫角色条目、角色图片或相关 IP 素材。动画引擎的 MIT 许可不被当成其默认角色图片的许可。
- 本轮直接复用了 `dorianbrown/rank_bm25` 的 BM25Okapi 实现，固定 commit `47aa3ddf8dc1ebeb7ef4e65f2b4536af44594099`，采用 Apache-2.0，完整原许可证和出处见 `ocean-acoustic-workbench/backend/vendor/`。
- JupyterLab、VS Code、AntV G6/Graphin、Docling、acoustics-agent、arlpy 等用于界面或技术方案研究；本轮未移植其完整应用、品牌图标、求解器或 AT 示例。界面说明见 `docs/DESIGN_AND_REUSE.md`，仿真取舍见 `docs/SIMULATION_AND_VALIDATION.md`。
- [LightRAG](https://github.com/HKUDS/LightRAG)（MIT）、[RAGFlow](https://github.com/infiniflow/ragflow)（Apache-2.0）、[LlamaIndex](https://github.com/run-llama/llama_index)（MIT）与 [Haystack](https://github.com/deepset-ai/haystack)（Apache-2.0）用于参考原文与图谱检索、文档覆盖报告、引用及一般知识回退方法；[Microsoft GraphRAG](https://github.com/microsoft/graphrag)（MIT）用于比较局部与全局检索。本项目没有安装这些完整框架或声称完成其向量、LLM 抽图、模型训练和 OCR。当前官方清单文档采集/刷新由本项目独立实现，不等于这些框架的完整联网检索流程。具体采用程度见 `docs/KNOWLEDGE_EXPANSION.md`。
- [WorkBuddy 官方模型配置](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)与[任务上下文说明](https://www.codebuddy.cn/docs/workbuddy/Create-Task)用于参考聊天模型切换、配置入口和输入区信息组织；没有复制其应用、品牌角色或私有实现。供应商缓存机制以 [DeepSeek 官方说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)和[阿里云百炼官方说明](https://help.aliyun.com/zh/model-studio/context-cache)为依据；本项目输入预算不代表操作其 KV cache，也未承诺缓存命中。
- “小航”使用项目原创海洋研究员造型与透明插画，结合上述开源动画核心及项目交互代码；未移植其他产品的版权角色或官方 Logo。它与工作台主问答共用本人的模型配置与对话，不获得额外设备访问权限。Sites 个人空间和共享课题不会向成员自动分发模型 Key、私人对话或私有教材。
- 原文 Unicode 保留、人工查询改写/RRF、观测数值门控和60题开发基准由项目独立实现；方法借鉴不表示已训练模型、安装完整框架或认证所有引用。当前功能与验证边界见 [VALIDATION_V0_7.md](docs/VALIDATION_V0_7.md)。
