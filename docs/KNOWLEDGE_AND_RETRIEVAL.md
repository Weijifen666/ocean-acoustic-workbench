# 海洋声学工作台：知识投喂与科研工作流调研

核对日期：2026-10-13。仅使用项目官方仓库、文档和许可证；没有使用社区帖子作为实现依据，没有调用付费模型。

## 当前缺口与取舍

旧实现搜索 46 张人工知识卡，把摘要和人工关系一并放入聊天上下文。它能解释课程概念，却不能检索资料包中未整理成卡片的原文；原页图片可追溯，但未形成正文索引。旧相关性是词语包含计分，缺少文档长度归一化、原文版本、入库状态与原文提取失败报告。公开 Agent 只读课程模板，尚不具备用户本机文件编辑或自主执行 MATLAB 的能力。

本次适合落地的路径是：授权课程资料 → 原页文本提取 → 带重叠的段落/句子分块 → 来源、PDF 页码、字符位置、SHA256 版本 → 私有 SQLite → BM25 检索 → 人工核实概念的一跳关联 → 依据原页回答。自动提取的片段明确标注待核查，不自动生成物理关系。精确概念优先，未知问题保持空结果，图谱背景不能替代原文证明。

## 官方项目比较

| 官方项目 | 许可证 | 可借鉴内容 | 本项目决策 |
| --- | --- | --- | --- |
| [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) | [MIT](https://github.com/HKUDS/LightRAG/blob/main/LICENSE) | 图谱上下文与原文片段结合，明确检索模式与引用；可接入既有领域图谱 | 借鉴局部概念、关联和原文并用的设计。本次不安装其抽取/embedding 服务，也不声称实现了其 vector/local/global/mix 全流程 |
| [microsoft/graphrag](https://github.com/microsoft/graphrag) | [MIT](https://github.com/microsoft/graphrag/blob/main/LICENSE) | [局部检索](https://microsoft.github.io/graphrag/query/local_search/)把实体关系与原文组合；[全局检索](https://microsoft.github.io/graphrag/query/global_search/)适合语料整体主题总结 | 课程知识点查询适合局部、有边界的检索。官方提示索引可能昂贵，仓库当前为维护模式；本次不引入社群报告预生成或整库 LLM 抽图 |
| [infiniflow/ragflow](https://github.com/infiniflow/ragflow) | [Apache-2.0](https://github.com/infiniflow/ragflow/blob/main/LICENSE) | 文档解析、可追溯引用、多路召回和融合重排；完整知识库管理流程 | 借鉴文档来源与入库状态；不替换整套工作台。官方起步部署建议 4 核、16GB 内存、50GB 磁盘且需 Docker/依赖服务，超出本次轻量节点改造需要 |
| [docling-project/docling](https://github.com/docling-project/docling) | [MIT](https://github.com/docling-project/docling/blob/main/LICENSE) | 结构化文档解析与表格、版面信息 | 后续可用于扫描教材和复杂公式。当前使用已有 PDFium 文本层提取，未接入 OCR；扫描/异常页须显式报告，不能宣称识别完成 |
| [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25) | [Apache-2.0](https://github.com/dorianbrown/rank_bm25/blob/master/LICENSE) | 可复用 BM25Okapi 评分器，调用方负责一致的索引/查询分词 | **实际直接复用**固定提交 `47aa3ddf8dc1ebeb7ef4e65f2b4536af44594099` 的未修改 Python 实现，保存原许可证和来源；课程中文 n-gram、术语别名、图谱约束由本项目实现 |
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | MIT | 持久化执行、状态机、人工检查点，适合长任务与失败恢复 | 可作为未来仿真 Agent 编排候选；本次未安装，当前已有任务队列继续使用，不为增加框架而重写稳定计算链路 |
| [microsoft/autogen](https://github.com/microsoft/autogen) | 代码 MIT、文档 CC-BY-4.0 | 工具调用和多 Agent 工作流 | 官方已标维护模式并建议 [Microsoft Agent Framework](https://github.com/microsoft/agent-framework)。本次仅对比，没有导入其代码 |
| [mathworks/matlab-engine-for-python](https://github.com/mathworks/matlab-engine-for-python) | MathWorks 自有 [LICENSE.txt](https://github.com/mathworks/matlab-engine-for-python/blob/R2026a/LICENSE.txt)，不能当 MIT | 在已安装 MATLAB 的宿主机上由 Python 调用 MATLAB 函数 | 仍需匹配 MATLAB 版本和合法安装。当前本机 R2024a 与 subprocess 批处理已验证，继续使用。Engine 不能让普通网页直接获得访客本机文件权限，也不免除 MATLAB 授权 |

以上“比当前方案更合理”的判断仅针对本项目规模、现有宿主机和课程需求；没有运行这些完整框架，也没有做跨框架质量基准，因此不宣传检索质量领先于 LightRAG/RAGFlow。

## 实际新增实现

- `backend/vendor/rank_bm25.py`：直接复用官方 BM25 源码，未改动。附 `LICENSE.rank_bm25` 和来源 README。
- `backend/ingestion.py`：支持 PDF、DOCX、UTF-8 TXT/Markdown；优先按段落/句子分块；不跨 PDF 页；保留来源、原页、稳定字符位置和原文件哈希；SQLite 原子刷新；空白/乱码页跳过并报告 `needs_ocr_pages`。
- `backend/retrieval.py`：BM25 与课程概念优先级、一跳人工关系融合；英文完整词边界、中英别名及中文 n-gram；原文必须实际匹配查询才可进入结果；不调用 embedding、不训练模型。
- `backend/knowledge.py`：兼容 `retrieve(q, limit=8)`；新增 `retrieval_status()`、`citations_for(evidence)`、`answer_context(evidence)`。保留原 UI 所需字段，增加 `evidence_type`、`verification_status`、`citation`、`retrieval`、易错点和图谱关系来源说明。
- `tests/test_knowledge.py`：12 项离线测试已通过，包含真实 PDFium 原页读取、Munk 精确命中、未知问题、完整英文别名、方法比较、关系不是正文引用、稳定版本、分块覆盖、扫描页报告、SQLite 原子更新与待核查片段。

检索得分是排序依据，不是正确率或置信概率。来源摘录仍可能存在文本层读取顺序问题、公式乱码、缺页和条件不完整；引用入口使学生能够查看原页核对。系统提示约束来源中的命令只作为文本，不能证明任意大模型对提示注入完全免疫。

## 本地接入步骤

1. 将上述后端和 vendor 目录同步到实际运行的工作台。新代码只读取 `.local/kb/chunks.sqlite3`，不会提交资料正文到 GitHub。
2. 使用 `ingestion.course_manifest(knowledge.graph_data(), '<实际工作台>/.local/sources')` 生成私有 `.local/kb/ingest-manifest.json`，会选取当前课程卡引用的 PDF 页，并保持每页对应的节点。S17 纸质页与 PDF 页存在 19 页偏移，可在来源对象设置 `printed_page_offset: 19`；引用使用 PDF 实际页码。
3. 在实际工作台目录执行 `python backend/ingestion.py --manifest .local/kb/ingest-manifest.json`。
4. 查看输出报告与 `.local/kb/chunks.report.json` 的 `chunks`、`needs_ocr_pages`、警告列表。只有成功提取的原文才可检索；扫描页仍展示原图并等待 OCR 或人工核查。
5. 聊天提示使用 `knowledge.answer_context(evidence)`，API 可返回 `evidence`、`citations`、`retrieval`。通过 `GET /api/knowledge/status` 展示实际库状态，而不是把“支持 RAG”当作“已经读完全部教材”。

推荐入库清单结构（仅保存到 `.local`）：

```json
{"sources":[{"id":"S17","path":"../sources/S17.pdf","pages":[375,376],"printed_page_offset":19,"page_nodes":{"375":["normal_mode_field"],"376":["mode_excitation"]}}]}
```

## 后续范围，均未接入

扫描教材可选 Docling/本地 OCR，随后人工核查公式和单位；再增加双语 embedding 与独立重排，使用同一批课程命题测量召回率与引用准确性。自动抽取的实体关系需在审核区确认后进入正式图谱。科研任务则需要“条件齐全 → 参数校验 → 教师/学生确认 → 白名单求解器运行 → 输出数值检查 → 引用结果分析”状态机，而不是让 LLM 自由运行任意本机脚本。公共访客对本机项目的读写仍需安装并授权本地连接器，不能仅靠网页按钮实现。

本项目仅用于课程作业、无商业用途的声明不会替代第三方开源许可、教材版权或 MATLAB 授权。完整教材、扫描原文索引、API Key 与访问数据库继续保存在私有 `.local`。
