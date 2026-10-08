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

公开访问需将站点受众明确设为 Public。访客 Cookie 隔离各自配置与任务；密钥只保存在节点内存中，节点重启后需重新填写。清除浏览器 Cookie 后无法找回旧访客任务。单批最多 4 组计算，整个节点最多 16 组排队/运行任务；只执行经过参数校验的课程模板。

图谱、模型目录和关联查询在云端运行。教材原页 PNG 需节点有原始 PDF，并在首次成功读取后缓存到 R2。节点离线时仿真与模型连接不可用。公共 Agent 只读课程共享代码，不能访问用户设备上的文件。

部署后分别验证匿名打开网页、模型配置隔离、教材图片、仿真提交、结果图及下载。不要把仅成功构建页面当成 MATLAB 或云端模型已接通。
