# 把资料接入问答 · v0.6

本项目用于课程作业，无商业用途。这里的入库是检索增强（RAG），不修改供应商大模型权重，不需要微调。当前实现 BM25 词项检索、中英术语别名、课程关系和概念优先排序；未部署向量模型、自动实体关系抽取或 OCR。

## 数据层次

1. `backend/data/course_graph.json`：人工核实的课程概念、公式、条件、误区和关系，公开到 GitHub。
2. `.local/kb/chunks.sqlite3`：从部署者获授权的资料提取的原页片段，带来源编号、PDF 页码、字符范围和文件 SHA256，保持私有。
3. 公共 `ocean-acoustic-public/data/open-ocean-sources.json` 与 `open-ocean-chunks.json`：经批准的官方知识网页片段及项目自写导读，带 URL、机构、时间、哈希和许可，独立于教材数据库。
4. 回答上下文：检索到的知识卡、教材原文、公开网页或导读，并附有类型的关系。关系不是原文引用，也不能当作因果证明；RAG 不会把内容永久训练进模型。

## 最小入库清单

在本地工作台创建 `.local/kb/my-manifest.json`：

```json
{
  "sources": [
    {
      "id": "S17",
      "path": "../sources/S17.pdf",
      "title": "课程教材",
      "pages": [375],
      "printed_page_offset": 19,
      "page_nodes": {"375": ["normal_mode_field"]}
    }
  ]
}
```

`pages` 是从 1 开始的 PDF 文件页码。纸质页码与 PDF 页码分开保存；不要统一猜一个偏移值。`page_nodes` 是经人工确认的课程关联，不能把整本书的每一页都挂到同一个概念后当作相关证据。DOCX 没有稳定页码，使用段落/字符定位；需要页码追溯时先导出 PDF。

需要全文索引时删除 `pages` 字段，并在同一清单内列出需要保留的所有来源。没有经核实的 `page_nodes` 也可以直接索引原文；未绑定节点的英文片段可通过课程中英术语表命中，不会自动变成正式知识图谱关系。

```powershell
cd ocean-acoustic-workbench
.\.venv\Scripts\python.exe backend/ingestion.py --manifest .local/kb/my-manifest.json
```

默认生成 `.local/kb/chunks.sqlite3` 和同目录的 `chunks.report.json`，按页分块，默认约 1100 字符、160 字符重叠。正文与覆盖报告一同写入临时 SQLite 后原子替换，失败不覆盖旧索引。再次运行同一清单是重建该清单对应的索引；需要多来源时一次写入完整清单。

## 实际验证范围

2026-10-13 已完成 S01、S07、S15、S17、S18 五份资料的全书文本层处理：1846 页全部尝试提取，1789 页形成 4092 个原文片段，57 页为 `blank_or_short`、等待原页复核；本次未检测到乱码或页级解析错误。其他课程来源仍未宣称全文入库。

57 页可能包括封面、图像页、扫描页或过短文本，不能直接称为“57 个扫描页”，也没有进行 OCR。文本可提取不等于公式、表格和单位已核查。完整源级页数与片段表见[知识扩展记录](KNOWLEDGE_EXPANSION.md)；教材全文验收保留在 [VALIDATION_V0_5.md](VALIDATION_V0_5.md)，本轮公开知识与预算检查见 [VALIDATION_V0_6.md](VALIDATION_V0_6.md)。

GET `/api/knowledge/status` 显示 `source_coverage` 和 `coverage`，区分资料总页、选中页、处理页、入库页与待复核页；另用 `public_ocean`、`web_sources` 报告公开网页，绝不把网页数当作 PDF 页数。POST `/api/chat` 返回 `evidence`、`citations`、`retrieval`、模型/知识范围及 `context` 预算用量。教材引用打开原页 PNG，公开引用打开实际官方 URL。新增私有来源的编号和预览权限需由维护者登记，未开放匿名任意文件上传。

计算节点在线时，课程检索使用私有原文索引、BM25、术语别名和概念优先权重，没有多召回排行融合；同时独立检索公开网页快照。节点离线时，云端课程卡使用 BM25、概念和一跳关系的三个排行做 RRF，公开网页使用单独 BM25 与人工双语主题别名。两种状态分别报告，不把离线课程卡描述成私有全文检索。

## 公开网页入库与刷新

v0.6 已采集 30 篇 NOAA NOS 正文，加 9 条项目自写中文导读，共 39 个可检索来源、67 个片段。42 项登记来源中的 3 个动态入口尚未接入实测数据。酸化、珊瑚、海平面、海流、漂流浮标、海啸和质控等中文问题已实际验证召回。图谱“学习资源”可查看对应来源与导读，无需 Key。

只有许可允许的正文才发布到公共 JSON；NOAA 正文保留署名与使用说明，其他机构只放自写导读与链接，不把导读标成复制原文或官方译文。具体字段、来源及许可见 [OPEN_OCEAN_KNOWLEDGE.md](OPEN_OCEAN_KNOWLEDGE.md)。不将教师私有 PDF、正文数据库或模型 Key 添加到这组公开文件。

```powershell
cd ocean-acoustic-workbench
python backend/public_ocean.py --publish --ttl-hours 168
python backend/public_ocean.py --force --publish --source O-NOAA-ACIDIFICATION
```

启动与状态查询通过 `refresh_if_stale(ttl_hours=168, background=True)` 在后台检查官方清单。默认只更新独立 `.local/kb/open-ocean/snapshot.json`，失败保留最后成功快照，不改课程 SQLite；`--publish` 才导出公共 JSON，之后需构建发布才能更新云端内置包。文档刷新不是本轮实时全网搜索，动态观测仍须另接数据 API。

## 回答范围与缺口记录

主问答和“小航”共用当前访客的对话状态及供应商模型选择。切换同一供应商的模型复用该供应商已配置的 Key；其他访客不会使用这份密钥。

聊天界面默认“资料 + 模型知识”（`general`），允许模型处理资料未覆盖的问题，并标记资料外内容未经本项目原文核验。“仅依据资料”（`course`）只依据本次课程或公开证据，普通对话空检索不调用模型编写无依据的结论；缺口加入访客私有记录。Agent 可分析实际提供的模板。没有片段时不编造引用，不声称搜索了实时全网或取得最新海况。

输入框底部的 4K–128K（自动 32K）控制实际输入发送预算；服务端裁剪历史和证据并报告结果，不修改模型原生窗口或 KV cache。实际输入与缓存用量仅按供应商返回记录，缺失保留 `null`。参见 [DeepSeek 缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)、[百炼缓存](https://help.aliyun.com/zh/model-studio/context-cache)与[知识扩展的预算说明](KNOWLEDGE_EXPANSION.md)。

GET `/api/knowledge/gaps` 只返回当前访客的缺口记录。公网记录与配置、历史一同加密存放在 D1；它是后续补资料的线索，不会自动训练模型、加入共享知识库或公开给其他访客。

## 质量检查

运行 `tests/test_knowledge.py`、`tests/test_public_ocean.py` 和 `tests/test_context_budget.py` 检查课程检索、公开来源/安全刷新与输入预算。回答区分 `reviewed_course_card` 人工课程摘要、`source_excerpt` 教材提取、`public_web_excerpt` 官方网页快照和 `public_reference_guide` 项目自写导读。不同海域、单位、时间或相干假设有冲突时分别引用，不拼接图谱制造结论。实际验收见 [VALIDATION_V0_6.md](VALIDATION_V0_6.md)。
