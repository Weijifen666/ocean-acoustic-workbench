# 部署

## 本地计算节点

先按根 README 安装依赖、构建本地页面并导入自己有权使用的资源包。确认 `http://127.0.0.1:8765/api/health` 中 MATLAB 和求解器可用。原始资源不足时，图谱与目录可构建，但教材图片和真实仿真不能据此认定已接通。

`backend/install_toolbox.py` 将本地 `.local/at-input.zip` 安装到当前用户的 Documents/MATLAB/AcousticsToolbox，并为 MATLAB startup.m 增加 AT 路径；它保留已有 startup.m 的备份。执行后重启 MATLAB 验证。

## 云端网页

```powershell
cd ocean-acoustic-public
npm.cmd ci
npm.cmd run build
```

构建生成 Cloudflare Workers 兼容的 `dist/server/index.js`。生产运行时需要以下绑定：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `DB` | D1 | 加密临时请求与节点心跳 |
| `BUCKET` | R2 | 加密响应和已提供的教材图片缓存 |
| `GATEWAY_SECRET` | Secret | 节点验证及 AES-GCM 加密 |

当前项目使用 Sites 部署。每个部署者创建自己的站点，将 `hosting.example.json` 复制为 `.openai/hosting.json`，填入实际 Site project_id，并保持 `d1: DB`、`r2: BUCKET`。通过 Sites 标准源码推送、归档、保存版本、部署流程发布；生产网址及绑定由平台返回。`.openai/hosting.json` 不提交本仓库。直接使用其他 Workers 平台时，需要自行配置等效 DB/BUCKET 绑定、应用 `drizzle/*.sql` 迁移及设置 Secret；本仓库未提供已验证的其他平台自动部署流程。

## 连接节点

在本地工作台运行：

```powershell
.\.venv\Scripts\python.exe backend/init_public_runtime.py --site-url "https://你的实际公开站点"
```

脚本创建未入库的 `.local/public-runtime.json`，其中 `gateway_secret` 是随机生成的连接密钥。仅将该值配置到自己站点的运行时 Secret `GATEWAY_SECRET`，不要粘贴到仓库、Issue 或公开日志。修改云端 Secret 后重新部署以应用环境修订。

```powershell
.\start-public.ps1 -NoBrowser
```

启动器同时运行本地后台、仅监听 `127.0.0.1:8780` 的受限访客网关，以及主动发起 HTTPS 请求的云端连接程序。保持节点联网且不休眠。计算节点不需要开放公网入站端口，也不依赖临时隧道。

## 访问控制与限制

公开访问需将站点受众明确设为 Public。访客 Cookie 隔离各自配置与任务；公网模型密钥和对话按访客加密保存于 D1，计算节点重启不影响配置；页面提供清除全部密钥按钮。清除浏览器 Cookie 后无法找回旧访客任务。单批最多 4 组计算，整个节点最多 16 组排队/运行任务；只执行经过参数校验的课程模板。

图谱、模型目录和关联查询在云端运行。教材原页 PNG 需节点有原始 PDF，并在首次成功读取后缓存到 R2。节点离线时仿真和私有原文索引不可用；云端课程知识卡与模型问答仍可使用。公共 Agent 只读课程共享代码，不能访问用户设备上的文件。

部署后分别验证匿名打开网页、模型配置隔离、教材图片、仿真提交、结果图及下载。不要把仅成功构建页面当成 MATLAB 或云端模型已接通。


## v0.4 知识与验证

[私有知识入库](KNOWLEDGE_IMPORT.md)说明PDF/DOCX/TXT/Markdown的导入与引用边界。新增D1迁移创建cloud_visitors表，不改已应用迁移。模型配置与对话由云端直接处理；MATLAB仿真和原文索引由节点提供。每个新结果生成validation、analysis和manifest.json文件哈希，未报告的外部求解器版本保留null。

## 2026-10-15 节点数据库升级与恢复

本地 SQLite schema version 2 是追加式迁移，保留既有 jobs/messages 行及原始运行目录。启动服务 lifespan 时运行迁移；升级前通过 SQLite backup API 在 `.local/backups/` 保存 `workbench.pre-queue-v2.<时间>.<随机值>.sqlite3`，备份包含数据库及当时有效 WAL 数据。迁移事务失败会回滚；未知的更高 schema 版本会拒绝启动，不自动降级。该备份含私有消息，继续保留在 `.local`，不能上传 GitHub。

执行器以数据库事务持久领取 `QUEUED`，持有节点操作系统文件锁，状态事件可在任务详情的 `events` 查看。服务仍按单 MATLAB 执行器部署；文件锁防止误启动第二执行器，不代表所有 PDF/缓存模块已支持多进程部署。旧的排队任务跨重启保留，不再在模块导入时批量判失败。

若发现上次遗留 `RUNNING`，服务将其标为 `INTERRUPTED` 并暂停队列。管理员先检查并结束残留的本项目 MATLAB/求解器进程，再通过本地队列管理恢复；公网访客没有暂停/恢复整个节点的权限。该策略不会猜测某个残留文件就是完整成功结果，也不会自动重跑已经可能产生副作用的任务。正常停止服务会终止它管理的活动进程，并保留真实中断状态。

回滚前停止本地后台、网关、桥接程序以及访问同一数据库的其他服务。使用 `backend/persistence.py` 的 `restore_database(database, backup)`，由 SQLite backup API 将指定备份恢复到数据库；不要在运行中只覆盖主 `.sqlite3` 而忽略 WAL。恢复旧版本备份后使用对应旧版本程序启动；新程序再次启动会重新迁移。运行目录中的原始产物应另外保留，不要为回滚删除它们。本轮开发仅在临时数据库验证升级与回滚，实际节点迁移由部署步骤执行。

新接口：`POST /api/plans/draft` 只生成可审阅草案；`POST /api/jobs/compare` 只读取并验证已有成功结果；`GET /api/queue/status` 为本地管理员提供持久队列与执行器状态。公网代理需逐一检查比较任务的访客所有权，提交时转发访客命名空间和 `Idempotency-Key`，并在活跃任务限额检查前处理相同键的重放。个人模型密钥不属于仿真计划、幂等标识或对比结果。

隔离测试可通过 `OCEAN_RUNTIME_DIR` 选择临时运行目录，并设 `OCEAN_DISABLE_WORKER=1`、`OCEAN_DISABLE_PUBLIC_REFRESH=1`；这些设置仅供明确的测试环境使用，正式计算节点应启用执行器。参数解析、事务、比较和 mock 测试通过不能代替真实 MATLAB 集成或真实模型回答质量验收。
