# 知识原文、检索与证据质量

本项目仅用于课程作业，无商业用途。本次改动提升的是原文保真、候选召回和缺证据识别，不代表已训练海洋大模型，也不保证所有回答正确。

## 显示原文与检索文本分离

旧入库器把 NFKC 用于显示正文，会把 `p²`、`c₀` 等变成 `p2`、`c0`。新版 `backend/ingestion.py` 使用入库格式 **2**：

- `text` 保留 PDF 文本层的 Unicode 字符，只整理换行、NUL 与行内空白；`search_text` 单独进行 NFKC/小写归一化，供检索使用。
- `char_start/char_end` 是清理空白后的显示页文本位置，`offset_basis=display_page_text_v2`。不是 PDF 文件字节位置，也不是排版坐标。
- `ingestion_version`、`text_policy`、文件 SHA-256、来源编号、PDF 页码继续随片段记录；`math_layout_verified=false` 明确说明公式排版仍未经核验。
- 旧索引仍可读取，但 `retrieval_status().text_integrity.requires_rebuild=true`，片段带原文完整性提醒。不能把旧 `p2` 自动“修复”为 `p²`：必须从有授权的原始文件重建。

保留 Unicode 不能解决 PDF 自身缺失上下标、双栏阅读顺序、表格结构或扫描内容。57 个空白/短文本页仍待人工查看，不能声称已经 OCR。

在本地管理节点沿用现有私有来源清单执行，先写候选文件、核查报告并备份，再切换：

```powershell
python backend/ingestion.py --manifest "<现有授权来源清单.json>" --output .local/kb/chunks-v2-candidate.sqlite3
```

2026-10-15 实际五份全书重建结果为：1846 页处理、1789 页入库、57 页待复核、**4101 片段**。旧版 4092 片段是历史结果；保留 Unicode 与字符分块位置变化后数量有所改变。私有 PDF、清单、SQLite 和片段正文不提交 GitHub。

## 口语查询与多概念召回

共享的 `ocean-acoustic-public/data/knowledge-retrieval-rules.json` 维护有语境约束的术语与拆问规则。例如“放到声道轴附近”在有声源语境时扩展到声源深度、模态激发、深海声道；“接收位置平移后几乎听不到”扩展到相干模态相消、采样与近零声压。酸化贝壳、漂流仪器、缺氧、潮水高低也可找到相应公开官方来源。

每题最多四路候选排行；**只有规则命中时**，Python 才在原有 BM25/概念优先结果之上做多路 RRF。公共课程检索原有词项/图谱排行融合保留，增加同样的查询分支。公开网页按来源最多两个片段，避免一个长网页独占结果。精确知识卡先于同概念的多个自动原文片段；相关原文仍先于宽泛图谱邻居。Munk 精确问法不被泛声速网页覆盖。

这不是付费向量检索或神经重排器；未安装 LightRAG/RAGFlow 框架，未用模型自动造关键词或答案入库。未命中规则的同义表达仍可能遗漏，需在新题上验证。

### v10：精准焦点与候选精度补丁

实际浏览器验收发现：Munk知识卡虽然排第一，候选后部仍混入作者历史、目录、Cox–Munk海面粗糙度以及泛“剖面”网页。Hit@8=1只能证明目标出现，不能排除这些噪声；前次仅检查首条和召回的基准没有发现该问题。

有人工知识卡的明确概念或维护规则焦点时，原文只从该焦点卡**精确引用的同源PDF页**选取，不凭姓氏或“剖面”一词接纳其他章节。Munk原文限定S17/375、376，不扩大页码；保留焦点卡、最多2段引用页原文和最多2张有类型的关联卡，不补满8条。Node返回和云端合并都执行同一选择规则，不能在Node过滤后重新补入泛网页。明确另点名的来源仍可保留，例如“Munk与WOA / World Ocean Atlas比较”；仅“声速”“剖面”不算新主题。

Cox–Munk与Munk理想声速剖面分开处理：前者不路由到K016。完整语料提供BM25统计，再只选择正文实际命名Cox–Munk的原文；无相应材料时空召回，不加泛海面/模型介绍。无精准焦点的其他全文查询仍可检索未挂入图谱的原页。本次没有扩展为通用命名实体系统或语义重排。

无Key回复改为精炼课程卡片，保留公式、适用条件和来源定位；公开内容优先显示明确标记的项目中文导读。只有原文时列出原页定位，不倾倒PDF提取正文。全部保留的原文仍可在资料抽屉打开；有Key时也仅发送过滤后的候选。

本补丁新增Python4项、公共JS5项回归，检查所有返回候选，而不是只检查第一条：包括带目录/历史/Cox/异书噪声的合成库、精确页约束、关联卡上限、不填满8条、显式第二主题、online/offline合并、Cox有正确原文或空召回、无Key短回复不包含PDF乱码。这里的候选精度是人工标注负例与来源规则的检查，**不是逐句引用支持率或物理正确率**。实际4101片段的Munk探针仅保留K016、S17/375与376原文、ENV和深海声道关联卡；无Key摘要为220字。60题开发回归仍须与这些负例一起运行。

## 候选、引用与足够证据

所有返回资料默认 `support_status=candidate_only`、`claim_support_verified=false`。检索分数只表示相关程度，图谱关联不是物理命题的证明。教材引用保留来源编号/页码，入库原文附版本哈希和显示字符位置；网页引用保留 URL、机构、更新/抓取时间、许可与哈希。

独立模块接口：

| Python | 公共 Worker | 用途 |
|---|---|---|
| `assess_evidence(question, evidence)` | `assessEvidence(question, evidence)` | 判断候选与特定观测数值的证据缺口 |
| `answer_policy.policy(evidence, scope, mode, question)` | `answerPolicy(evidence, scope, mode, question)` | 返回 `can_generate`、`coverage_notice` 与 `evidence_assessment` |
| `validate_citation_ids(answer, evidence)` | `validateCitationIds(answer, evidence)` | 检查回答中的片段 ID 和 `[sourceID,page]` 是否存在于本轮候选 |

应用必须传第四个参数当前问题；在上下文裁剪后，用**实际留下的证据**再评估一次。引用 ID 检查只能查出不存在的引用，不能证明该句被原文支持，也不能代替单位、公式和物理适用条件核验。当前未开展生成答案的自动蕴含评测或人工盲评。

“今天东海一千米深声速是多少”等已覆盖问法要求时间、海域、深度、变量、单位和质控相匹配的结构化观测。教材典型值、Munk 模型、气候态和网页抓取时间不满足要求；返回 `missing_observation_data`，包括一般知识模式在内均不请求模型编造数值。多个海域比较要分别有相应记录。未来可信数据适配器才可提供 `structured_observation`；当前没有接入实时海况观测，合成测试记录不是产品数据。

门控是保守的显式规则，覆盖已列变量/海域/问法，不能宣称识别所有地名、坐标、时间窗或所有隐含数值请求。资料与一般模型知识仍须清楚区分；新论文/最新海况不能凭静态快照宣称实时检索。

## 60 题离线回归

基准为 [benchmarks/knowledge-60.json](benchmarks/knowledge-60.json)：30 道术语题、10 道口语/多概念题、10 道公开海洋主题题、8 道时空数值缺证据题、2 道未知题。每题含自写答案要点、适用条件、不得声称的内容和已有来源定位。缺证据题的空来源表示应拒绝伪造出处。

```powershell
# 本地节点：默认只读公开知识卡/网页快照，不读私有正文
python backend/evaluate_knowledge.py
# 同一语料和门控，关闭人工查询改写作消融；不是旧版本完整复刻
python backend/evaluate_knowledge.py --baseline --output .local/kb/evaluation-60-ablation.json
# 在已切换重建索引的本地管理节点验证完整私有语料
python backend/evaluate_knowledge.py --include-private
# 公共应用目录：直接运行实际公共检索器，不请求模型
node scripts/evaluate-knowledge.mjs
```

脚本记录 Hit@8（50 道有目标的题，至少命中一个目标）、课程节点 Recall@8、MRR、8 道观测门控与2道未知题空召回。生成明细存 `.local/kb`，不包含教材正文、API Key 或绝对来源路径。

2026-10-15 Python 公开知识及实际4101片段候选索引均达到：50/50 目标题至少命中、节点 Recall@8=1、MRR=1；8/8 数值缺证据门控、2/2 未知空召回。关掉查询改写的同语料公开消融为41/50目标题命中。公共 JS 使用相同题集另存报告，其排行与 Python 有实现差异。

**这是开发者编写并用于调参的回归集，不能报告为100%回答准确率。** 新增教师盲题、未见口语问法、逐句引用蕴含、公式/表格与实际仿真误差需分别测试；扩充文档页数本身不证明正确率提高。本次没有真实付费生成或模型质量评估。

## 上游方法参考

借鉴 [RAGFlow 的检索测试流程](https://github.com/infiniflow/ragflow/blob/main/docs/guides/dataset/retrieval_testing.md)：先检查目标片段是否进入候选，再分开检查模型答案。[LightRAG](https://github.com/HKUDS/LightRAG) 提供检索与图谱上下文结合的实践参考。本项目独立实现有界图谱关联、查询规则和排行融合；未把这些框架或其模型作为已接入功能。Python BM25 实际复用已有 Apache-2.0 `backend/vendor/rank_bm25`，沿用其许可与 NOTICE。NFKC 的兼容性字符转换依据 [Unicode Normalization Forms](https://www.unicode.org/reports/tr15/)，显示正文不再应用该转换。
