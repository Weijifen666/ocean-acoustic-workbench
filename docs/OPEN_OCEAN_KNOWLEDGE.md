# 公开海洋知识库：来源、入库、刷新与边界

本项目仅用于四人小组课程作业，无商业用途。公开知识索引独立于教师资料：教师教材仍留在授权本地节点的私有 SQLite 中；公开官方网页正文与项目自写导读可以随网站部署。此功能是检索增强，不是重新训练大模型，也不是声称已覆盖“全网”或已连接实时海况。

## 已实际落地的内容

首批登记 42 个官方来源，已实际取得并入库 30 篇 NOAA National Ocean Service 文章正文，另外有 9 条项目自行撰写的中文参考导读和 3 个动态数据入口。当前共有 39 个可检索来源、67 个片段；42 个登记入口的响应均已取得并保存原响应哈希。后续刷新是否成功以 `open-ocean-sources.json` 的 `snapshot_status` 和知识库状态接口为准。

正文覆盖水下声音、主动/被动声呐、水听器、后向散射、SOFAR、温跃层、深海温度、盐度、上升流、热盐环流、潮汐、水文测量、酸化、富营养化、缺氧、海洋噪声、海流驱动与观测、漂流浮标与 ADCP、珊瑚白化、海平面、海啸、风浪、潮位计、测深、静水压力、微塑料和业务海洋预报。中文问题通过人工整理的中文标题、关键词和简短导读检索英文正文；它们明确标记为项目编辑材料，不能说成 NOAA 官方译文。

不需要新增付费数据库或嵌入 API。已实现 BM25 检索与中英文主题别名，保留逐来源引用。没有安装 LightRAG、RAGFlow、LlamaIndex 或 Haystack；来源登记、可追溯片段和分离采集/检索的设计借鉴这些项目常见的 RAG 工作方式，代码没有冒充其完整框架。课程索引已有的 BM25 组件仍按其 Apache-2.0 许可证说明保留。

## 资料类型与使用许可

| 类型 | 当前来源 | 发布到开源仓库的内容 | 更新含义 |
| --- | --- | --- | --- |
| 官方知识网页正文 | 30 个 NOAA NOS 白名单文章 | 去导航、侧栏、图片、音视频、图片说明后的正文片段；保留 NOAA 来源与使用说明 | 最近取得的知识页面快照；不是实时观测 |
| 项目自写参考导读 | Argo 数据质控、TEOS-10、ONC 数据政策、QARTOD、WOA、WOD、海洋热含量产品、UNESCO-IOC 2026 报告发布信息、OISST | 自行撰写的短中文导读与官方链接；未复制原站或报告全文 | 导读和链接供核对；原始资料许可按具体出版物/数据集决定 |
| 动态数据入口 | NOAA CO-OPS、NDBC、全球海洋热含量更新入口 | 官方 URL、用途、时间/质控要求；不提供伪造的观测数值 | 当前登记入口，尚未实现数据产品 API 读取 |

NOAA 对多数 NOS 资料公开提供公有领域使用说明，同时要求检查第三方署名/例外并保留 NOAA 来源。索引只复用文章文字，不打包 NOAA 徽标、图片、视频或第三方素材，也不暗示 NOAA 认可本项目。依据：[NOAA NOS 引用与使用 FAQ](https://oceanservice.noaa.gov/about/faq.html)。这部分上游公共资料的身份不因仓库代码采用 MIT 而改变。

ONC 政策主要规定具体数据集：ONC 独有数据通常为 CC BY 4.0，但合作数据可能有其他许可。网站文章全文不因此自动变成 CC BY 4.0。依据：[ONC Data Policy](https://www.oceannetworks.ca/data/data-policy/)。TEOS-10 网站、国际报告和 Argo 网页也不因公开可访问就自动取得全文再发布权；本项目只提供自写导读和链接。

## 来源登记与可追溯证据

`ocean-acoustic-public/data/open-ocean-sources.json` 是人工审核的来源清单。每项保留：

- `id`、机构、标题（正文来源保留原题，导读使用项目标题）、项目中文标题、主题、检索关键词与 `guide_zh`。
- `url`、明确批准的 `allowed_urls` 与 `allowed_hosts`；不是用户提供任意 URL 的抓取接口。
- `content_policy`、许可名称、许可/使用说明 URL 与署名限制。
- `source_updated_at`：原页明确给出的最后更新日期；没有提供时为 `null`，不把 HTTP 缓存时间伪造为文章更新日期。
- `fetched_at`、`checked_at`、HTTP Last-Modified/ETag、原响应字节 SHA-256 与清洗正文 SHA-256。没有实际取得原响应时，原页哈希保留 `null` 并记录检查失败；不能编造哈希。
- `snapshot_status`、`last_fetch_error`、TTL 与时间解释说明。

片段放在独立 `open-ocean-chunks.json` 中，含 `source_id`、正文、字符定位、原 URL、来源机构、抓取时间、更新日期、哈希和许可。公开网页的 `pdf_page` 固定为 `null`，不伪造教材页码。`public_web_excerpt` 是取得的官方正文；`public_reference_guide` 是项目自写导读，二者在证据类型和引用定位中区分。

字符定位针对清洗后的原页文本，不能当作网页 HTML 字节偏移。原响应哈希可核对下载版本，正文哈希可核对清洗版本；清洗正文改变时形成新片段 ID，仅导航或其他非正文内容改变不会改变片段 ID。项目导读的字符定位与正文哈希针对自写导读，不代表复制了所链接网页。引用中的抓取时间指出所用快照的时间。

## 采集与后台刷新

维护 CLI 在本地 Python 环境中运行：

```powershell
cd ocean-acoustic-workbench
python backend/public_ocean.py --publish --ttl-hours 168
python backend/public_ocean.py --force --publish --source O-NOAA-ACIDIFICATION
```

不带 `--publish` 时，仅更新独立 `.local/kb/open-ocean/snapshot.json`，不修改开源内置 JSON；从头至尾不覆盖 `.local/kb/chunks.sqlite3` 课程索引。`--publish` 导出可公开分享的快照，随后按原项目构建与发布流程更新云端网站。

本地应用已在启动和状态查询时调用以下入口，按 168 小时 TTL 检查 30 篇 NOAA 正文是否需要后台刷新；9 条项目导读与 3 个数据入口由维护者更新登记，不由该任务自动改写：

```python
import public_ocean
public_ocean.refresh_if_stale(ttl_hours=168, background=True)
```

该调用返回即时调度状态，后台使用线程锁和最多 3 个采集线程；检索和状态响应读取已有快照，不等待网络。每个来源请求有 20 秒总时间限制与 2 MB 响应上限；只使用已登记的官方 HTTPS 主机和具体 URL。手动检查重定向目的地，未登记的路径、私网主机、带账号的 URL 和 HTTP 均拒绝；不带 API Key、用户 Cookie 或环境代理配置，也不转发站点设置的 Cookie。刷新失败记录固定错误类别并保留上次成功的正文、哈希和抓取日期。

默认文档 TTL 为一周，可由应用调低为一天；这是触发检查时的过期判断，不是无人运行节点也会执行的定时任务。TTL 依据取得快照的时间，不是原页最后编辑时间。节点在线时可通过其接口使用新证据；云端 Worker 的内置离线快照仍需导出、构建并重新部署才会更新，构建本身不执行抓取。内置快照过期时状态会明确标记。

## 应用接口

Python `knowledge.retrieve()` 整合私有课程和公开索引，并为明确的课程概念保持原有优先级。`knowledge.citations_for()` 对公开证据输出实际 URL 和时间，不把图谱关系当作原文来源。`knowledge.retrieval_status()` 的原 `indexed_pages`、`source_chunks` 等字段仍只统计课程 PDF，另外返回 `public_ocean` 和 `web_sources`。

云端模块通过依赖注入接收构建时 JSON，不需要 Node 文件系统：

```javascript
import {createPublicOceanKnowledge} from './server/open-ocean-retrieval.mjs';
const ocean = createPublicOceanKnowledge({sources: OPEN_OCEAN_SOURCES, chunks: OPEN_OCEAN_CHUNKS});
ocean.retrievePublicOcean('海洋酸化为什么影响珊瑚', 6);
ocean.publicOceanStatus();
```

模块也导出 `configurePublicOcean(data)` 和配置后的 `retrievePublicOcean(q, limit)`、`publicOceanStatus()`。来源参数可为 `{sources: [...]}` 的登记对象或来源数组，片段参数为数组。

公开状态字段：`registered_sources`、`indexed_sources`、`successful_web_documents`、`reference_guides`、`data_service_entries`、`chunks`、`latest_fetched_at`、`oldest_fetched_at`、`stale_sources`、`web_sources`、`refresh`。这些字段中的网页来源数或片段数不能加到课程 PDF 页数。`realtime_observations_connected`、`live_web_search` 和 `training_performed` 当前均为 `false`。

## 时间与科学条件

“今天抓取”“原页最近更新”“今天的观测数据”是三件事。NOAA 一些概述页仍含 2014 年等较早示例，即使页面标为 2026 年更新，也不能把其海平面速率、设备数量、缺氧面积或历史灾害损失解释成当前数值。材料统一带 `snapshot_not_realtime: true` 与时间说明，回答上下文明确要求区分历史示例、典型值、气候态、数值预报和实测值。

请求最新某站点海温、波高或海流时，系统应说明当前没有获取该实时产品，并提供对应官方入口。后续真正接入 CO-OPS、NDBC、Argo 或 ERDDAP 时，至少应保存站点/经纬度、观测时间与时区、有效深度、单位、垂直基准、质量标记、产品版本和取得时间，缺测也应保留。当前没有完成这些数据产品适配器，不把产品介绍页面当成实时数值。

课程仿真中可把公开知识用于解释条件和选择数据来源，仍需真实导入有许可的具体温盐/地形数据，再运行 MATLAB 求解器。知识回答不代表已仿真，气候态不代表某次实验的环境实测。

## 验证

离线测试覆盖真实公开快照的酸化、珊瑚、海平面、海流、漂流浮标、海啸和 Argo 质控中文检索；确认每条证据带可访问的来源 URL、许可和时间信息，未知问题不拼凑答案。模拟网络测试覆盖两种 NOAA 页面布局、软 404、去导航/图片噪声、重定向拒绝、尺寸与时间上限、失败保留最后成功快照、精确字符定位和 TTL。测试不会读取私有教材或调用付费模型。

公开知识与部署验收见 [VALIDATION_V0_6.md](VALIDATION_V0_6.md)，此前课程全文与共享模型验证见 [VALIDATION_V0_5.md](VALIDATION_V0_5.md)。
