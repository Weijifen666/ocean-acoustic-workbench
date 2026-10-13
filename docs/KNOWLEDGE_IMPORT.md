# 把资料接入问答

本项目用于课程作业，无商业用途。这里的入库是检索增强（RAG），不修改供应商大模型权重，不需要微调。当前实现 BM25 词项检索、中英术语别名、课程关系和概念优先排序；未部署向量模型、自动实体关系抽取或 OCR。

## 数据层次

1. `backend/data/course_graph.json`：人工核实的课程概念、公式、条件、误区和关系，公开到 GitHub。
2. `.local/kb/chunks.sqlite3`：从部署者获授权的资料提取的原页片段，带来源编号、PDF 页码、字符范围和文件 SHA256，保持私有。
3. 回答上下文：检索到的知识卡和原文片段，并附有类型的关系。关系不是原文引用，也不能当作因果证明。

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
      "page_nodes": {"375": ["munk_profile"]}
    }
  ]
}
```

`pages` 是从 1 开始的 PDF 文件页码。纸质页码与 PDF 页码分开保存；不要统一猜一个偏移值。`page_nodes` 是经人工确认的课程关联，不能把整本书的每一页都挂到同一个概念后当作相关证据。DOCX 没有稳定页码，使用段落/字符定位；需要页码追溯时先导出 PDF。

```powershell
cd ocean-acoustic-workbench
.\.venv\Scripts\python.exe backend/ingestion.py --manifest .local/kb/my-manifest.json
```

默认生成 `.local/kb/chunks.sqlite3` 和同目录的 `chunks.report.json`，按页分块，默认约 1100 字符、160 字符重叠。索引采用临时文件写入后替换，失败不覆盖旧索引。再次运行同一清单是重建该清单对应的索引；需要多来源时一次写入完整清单。

## 实际验证范围

2026-10-13 对 S07、S15、S17 的 38 个已引用原页形成 90 个片段。本轮没有声称所有课程资料已全文入库。选中页未产生 OCR/异常提取警告，不表示其他扫描资料已做 OCR；需要看报告并人工核对公式、表格和符号。

GET `/api/knowledge/status` 显示真实来源、页和片段数量，POST `/api/chat` 返回 `evidence`、`citations` 与 `retrieval`。点击引用打开对应原页 PNG。新增私有来源的编号和预览权限需由维护者显式登记，当前未开放匿名任意文件上传。

计算节点在线时，检索使用私有原文索引、BM25、术语别名和课程概念优先权重；这一实现没有多召回排行融合。节点离线时，云端只检索公开课程卡，使用 BM25、明确概念和一跳关系的三个排行做 RRF 融合。两种状态在接口中分别报告，不把离线课程卡描述成原文全文检索。

## 质量检查

运行 `tests/test_knowledge.py` 检查术语匹配、邻域边界、未知问题空结果、引用版本及真实 PDF 提取。回答必须区分 `reviewed_course_card` 人工课程摘要与 `source_excerpt` 待核查的原文提取。不同海域、单位或相干假设有冲突时分别引用并解释条件，不能通过拼接图谱制造结论。
