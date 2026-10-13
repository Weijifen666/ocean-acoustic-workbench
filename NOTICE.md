# 代码与外部资源 · v0.6

本项目仅用于海洋声学课程作业与教学展示，无任何商业用途；该用途说明不替代各部分原有许可证。

MIT 许可证适用于本仓库原创程序、原创原理示意图、原创 SVG 海洋探索员“小航”及自行撰写的中文导读，不改变被引用教材、论文、课件、公共资料、第三方依赖和声学工具的许可条件。课程作业与无商业用途是本项目用途说明，不另行覆盖原有开源许可。

- MATLAB 属于 MathWorks，本仓库不包含 MATLAB 程序或许可证。部署者需自行确认所用许可证适用于预期运行方式。
- Acoustics Toolbox（AT）、KRAKEN/FIELD 由各自维护者提供，本仓库不分发教师资源包中的 AT 安装包或求解器二进制；请按其原始许可获取和使用。
- 教材、实验报告、课堂照片、课程原始 ZIP、规划书和 PDF 原页图片不包含在本仓库。知识点保留资料编号、页码及引用，原始资料需由有权使用的部署者自行导入。五份全书文本层索引的 1789 页、4092 个原文片段和 57 页复核记录保持在部署节点的私有 `.local`，不随源码分发；真实 API Key、私有数据库及网页后台快照也不上传 GitHub。
- v0.6 的公共 JSON 分发 30 篇 NOAA NOS 网页的清洗文字片段，依据 [NOAA NOS 使用与引用 FAQ](https://oceanservice.noaa.gov/about/faq.html)的公有领域说明，保留机构、原 URL、抓取/更新日期、哈希与使用限制。不分发 NOAA 徽标、照片、视频、音频或第三方署名素材，不暗示 NOAA 认可本项目；这些文字不被改称本项目原创版权。
- 另有 9 条项目自写导读与 3 个仅登记的动态入口。TEOS-10、Argo、ONC、UNESCO-IOC 等原站全文或具体数据集并未因登记链接而获得新的再分发许可；导读不是原文复制或官方译文。ONC 数据许可须逐数据集核对，不能把其数据政策当作网站全文许可。具体登记与刷新见 [OPEN_OCEAN_KNOWLEDGE.md](docs/OPEN_OCEAN_KNOWLEDGE.md)。
- npm/Python 依赖保留各自许可证；API 供应商的模型、计费和服务条件由对应供应商规定。
- 本轮直接复用了 `dorianbrown/rank_bm25` 的 BM25Okapi 实现，固定 commit `47aa3ddf8dc1ebeb7ef4e65f2b4536af44594099`，采用 Apache-2.0，完整原许可证和出处见 `ocean-acoustic-workbench/backend/vendor/`。
- JupyterLab、VS Code、AntV G6/Graphin、Docling、acoustics-agent、arlpy 等用于界面或技术方案研究；本轮未移植其完整应用、品牌图标、求解器或 AT 示例。界面说明见 `docs/DESIGN_AND_REUSE.md`，仿真取舍见 `docs/SIMULATION_AND_VALIDATION.md`。
- [LightRAG](https://github.com/HKUDS/LightRAG)（MIT）、[RAGFlow](https://github.com/infiniflow/ragflow)（Apache-2.0）、[LlamaIndex](https://github.com/run-llama/llama_index)（MIT）与 [Haystack](https://github.com/deepset-ai/haystack)（Apache-2.0）用于参考原文与图谱检索、文档覆盖报告、引用及一般知识回退方法；[Microsoft GraphRAG](https://github.com/microsoft/graphrag)（MIT）用于比较局部与全局检索。本项目没有安装这些完整框架或声称完成其向量、LLM 抽图、模型训练和 OCR。当前官方清单文档采集/刷新由本项目独立实现，不等于这些框架的完整联网检索流程。具体采用程度见 `docs/KNOWLEDGE_EXPANSION.md`。
- [WorkBuddy 官方模型配置](https://www.codebuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)与[任务上下文说明](https://www.codebuddy.cn/docs/workbuddy/Create-Task)用于参考聊天模型切换、配置入口和输入区信息组织；没有复制其应用、品牌角色或私有实现。供应商缓存机制以 [DeepSeek 官方说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)和[阿里云百炼官方说明](https://help.aliyun.com/zh/model-studio/context-cache)为依据；本项目输入预算不代表操作其 KV cache，也未承诺缓存命中。
- “小航”为本项目手绘 SVG 海洋探索员，使用原创造型和交互代码；未使用其他产品的官方角色、形象素材或品牌图标。它与工作台主问答共享当前访客的模型配置和对话，不另建能访问用户设备的 Agent。
