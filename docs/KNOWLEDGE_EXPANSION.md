# 扩大知识覆盖，保留大模型的通用能力 · v0.5

本项目仅用于课程作业，无商业用途。本页记录 2026-10-13 的知识扩展实现与参考项目。原始资料、正文索引和模型密钥继续留在私有 `.local`，不随 GitHub 源码上传。

## 两种知识来源

供应商大模型已有的知识与课程知识库是两层能力。模型切换只改变组织答案的模型，不会清空资料索引，也不需要为同一家供应商的不同模型反复填写 API Key。RAG 把本次问题相关的资料片段送进上下文；它不会修改模型权重，也不会让模型永久记住整本教材。

课程增强回答优先使用实际检索到的原页证据，并区分环境、单位、公式约定和模型补充。通用问答可以使用供应商模型原有知识处理其他领域的问题；没有课程引用时应明确说明来源范围，不把一般知识编成课程教材引用。通用问答路由由网页与聊天服务实现；Python 入库模块只负责资料检索，不会替用户调用任何模型。

主问答和原创海洋助手“小航”共享同一访客的对话、模型选择和知识范围；回答记录本次请求的供应商、模型标识和实际响应标识。选择“课程依据”时，普通空检索明确不生成未经依据支持的答案；选择“模型一般知识”时允许模型补充并标明未经本项目原文核验。Agent 可分析实际提供的共享模板，不等同于空检索的普通对话。

没有匹配资料的问题加入当前访客的待补资料记录。公网记录加密保存在访客状态内，不会公开给其他访客，也不会自动成为共享知识或触发模型训练。维护者可依据真实缺口寻找、登记有权使用的资料，再做入库与来源检查。

## 已完成的全文文本层索引

此前只导入课程图谱引用的 38 个原页。v0.5 已把 S01、S07、S15、S17、S18 五份授权资料逐页处理，实际结果如下：

| 来源 | 资料 | 总页／处理页 | 入库页 | 片段 | 空／短文本待复核 |
| --- | --- | ---: | ---: | ---: | ---: |
| S01 | 课程绪论 | 78 | 46 | 46 | 32 |
| S07 | SW06 观测与布置报告 | 117 | 116 | 221 | 1 |
| S15 | ASIAEX 2001 初步观测报告 | 101 | 100 | 198 | 1 |
| S17 | Computational Ocean Acoustics，第 2 版 | 813 | 806 | 1984 | 7 |
| S18 | Principles of Sonar Performance Modelling | 737 | 721 | 1643 | 16 |
| 合计 | 五份资料 | 1846 | 1789 | 4092 | 57 |

文本层入库页覆盖率为 1789 / 1846，约 96.9%；57 页全部为 `blank_or_short`，本次未检测到乱码或页级解析错误。这不是知识正确率、OCR 成功率或整份资料包覆盖率；原文的公式、表格、提取顺序和适用条件仍需要原页复核。最新实际检查见 [VALIDATION_V0_5.md](VALIDATION_V0_5.md)。

继续导入资料时，可以省略 `pages` 按全部页读取文本层；清单须包含需要保留的全部来源。下面是结构示例：

```json
{
  "sources": [
    {
      "id": "S17",
      "path": "../sources/S17.pdf",
      "title": "课程教材",
      "printed_page_offset": 19,
      "page_nodes": {
        "375": ["normal_mode_field"]
      }
    }
  ]
}
```

上例只展示单个来源的配置结构；实际五来源清单保持私有。`page_nodes` 只保留经过核实的原页—概念关系；没有关系的其他页也可以通过原文检索，不需要把全书每页挂到同一个知识点。

```powershell
python backend/ingestion.py --manifest .local/kb/full-manifest.json
```

默认输出 `.local/kb/chunks.sqlite3` 和 `.local/kb/chunks.report.json`。每次运行重建清单中所有来源，清单须包含需要保留的全部来源。正文、稳定片段编号、来源编号、PDF 原页、字符范围和文件 SHA256 一起保存；SQLite 的报告元数据与正文在同一次原子替换中更新。读取文件哈希采用分块读取，避免为大 PDF 额外复制整文件。

## 知识点之外的原页也能进入答案

完整资料中的英文 `sound speed profile` 可以被中文“声速剖面”或 `SSP` 命中。索引和查询均做课程术语别名展开；未绑定图谱节点的原文也用等价术语检查相关性。没有实际词项匹配的片段不会因为关联边而被引入。

精确匹配的人工课程卡优先，用于保留公式和适用条件；实际匹配的原文优先于宽泛的图谱背景，避免默认八条上下文全部被邻居知识卡占满。新增原页不会自动成为已审核知识卡，仍标记为 `source_text_unreviewed`。不会自动生成或认证物理因果关系。

全文索引修订后自动刷新检索缓存。同一批正文的词项展开、分词、BM25 统计与词项集合一起缓存；后续问题只进行查询评分，并仅复制最终返回的片段，避免每次深拷贝数千条原文。测试覆盖 1200 个独立片段，确认缓存复用与正文修改后的刷新；这不是大型生产系统性能基准。

## 可以查看真实覆盖情况

`GET /api/knowledge/status` 保留旧字段 `cards`、`indexed_sources`、`indexed_pages`、`chunks`、`needs_ocr`，并增加：

| 字段 | 含义 |
| --- | --- |
| `source_coverage` | 每个来源的编号、标题、总页数、选中页、处理页、成功页、片段和失败分类；不返回文件路径 |
| `coverage.total_pages` | 这批已登记 PDF 的实际总页数；无法确定时为 `null` |
| `coverage.selected_pages` | 本次选中处理的 PDF 页数；省略 `pages` 即选中整份 PDF |
| `coverage.processed_pages` | 已尝试提取的原页数，包括没有形成片段的页 |
| `coverage.indexed_pages` | 至少形成一个可检索片段的唯一原页数 |
| `coverage.failed_or_needs_ocr_pages` | 未形成片段、需要 OCR 或人工查看的数量 |
| `coverage.blank_or_short_pages` | 文本层为空或过短的页；可能是封面，也可能是扫描内容 |
| `coverage.unreadable_pages` | 乱码或页级解析错误 |
| `coverage.coverage_ratio` | 成功入库原页 / 资料总页数 |
| `coverage.selected_success_ratio` | 成功入库原页 / 本次选中页数 |

“选中页全部成功”不等于“整本资料都已检索”。DOCX、TXT 和 Markdown 没有稳定 PDF 页码，不能伪造总页数；其 `processed_units`、`indexed_units` 表示实际文本输入是否处理成功。旧索引没有总页数报告时保留 `null`，不猜覆盖率。

文本为空不能自动判定该页没有知识，因此仍保留原页检查提示。这里只读取 PDF 文本层，没有进行 OCR，也未确认这些页全部是扫描页。自动提取的公式、表格、页内顺序仍需要对照原图核查。

## 参考 GitHub 项目及复用范围

| 官方项目 | 对应思路 | 本项目当前采用程度 |
| --- | --- | --- |
| [LightRAG](https://github.com/HKUDS/LightRAG)，MIT | 原文与图谱共同检索，引用与增量维护 | 参考局部有边界的上下文和来源追溯；没有安装其向量、LLM 抽图或多模态服务 |
| [RAGFlow](https://github.com/infiniflow/ragflow)，Apache-2.0 | 文档解析、片段管理与[检索测试](https://github.com/infiniflow/ragflow/blob/main/docs/guides/dataset/retrieval_testing.md) | 参考“先确认正文进入索引，再调整检索”的维护流程，增加真实覆盖报告；没有替换完整应用 |
| [LlamaIndex](https://github.com/run-llama/llama_index)，MIT | 数据接入、可组合查询和[引用查询](https://developers.llamaindex.ai/python/framework-api-reference/query_engine/citation/) | 用于比较数据层与生成层的职责；本次没有引入其依赖或云端解析服务 |
| [Haystack](https://github.com/deepset-ai/haystack)，Apache-2.0 | [ConditionalRouter](https://docs.haystack.deepset.ai/docs/conditionalrouter) 显式路由与回退 | 借鉴课程检索与一般回答分开的路由思想；没有复制其组件实现 |
| [Microsoft GraphRAG](https://github.com/microsoft/graphrag)，MIT | 局部实体证据及语料整体主题总结 | 作为后续跨文档问题的参考；官方提醒索引成本且当前仓库为维护模式，本次没有做全库 LLM 社群报告 |
| [rank_bm25](https://github.com/dorianbrown/rank_bm25)，Apache-2.0 | BM25Okapi 评分 | 实际直接复用固定提交的评分器，原许可证见 `backend/vendor/LICENSE.rank_bm25` |

这些框架不能凭空增加海洋知识。增加知识仍需有来源的教材、论文、技术文档与数据说明进入索引，检索到正确片段，并在回答中核查适用条件。本项目未运行上述完整框架的比较基准，不声称自身检索优于它们。

## 尚未接入的扩展

向量模型与重排模型可改善同义改写和跨语言召回，但目前未部署；中文查询英文原文依赖明确的课程术语表，超出术语表的跨语言语义仍有限。扫描页可接 Docling 或本地 OCR，再人工核查公式和单位；目前只报告提取缺口。网页联网查资料与自动资料采集尚未接入，回答不能宣称已经搜索了实时网页。维护者可以继续登记获授权资料，匿名访客不能改写全组知识库。

后续评测应覆盖原先已有知识点、新导入页的概念、不同海域条件、单位误用、资料冲突及完全无关问题，同时检查来源页是否真实支持回答。扩大页数只是扩大可检索范围，不等于训练成功或事实正确率保证。
