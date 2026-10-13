# 模型连接故障与修复

2026-10-13。仅用于课程作业，无商业用途。

## 本次原因

云端原先为模型目录和聊天请求设置 `redirect: "error"`。Cloudflare 的 workerd 实现只支持 `follow` 和 `manual`，因而在发送供应商请求前抛出异常；旧捕获逻辑又将其统一显示为“连接未完成”。Node.js 中的模拟 fetch 没有覆盖这个运行时差异。[workerd 官方实现](https://github.com/cloudflare/workerd/blob/main/src/workerd/api/http.h)

截图中的 DeepSeek 地址 `https://api.deepseek.com` 和 API 模型 ID `deepseek-flash` 均符合[官方首次调用说明](https://api-docs.deepseek.com/)。此故障不能说明新建的 Key 无效。

## 修复

- 统一使用 `providerFetch`，设置 `redirect: "manual"`，显式拒绝全部 3xx，不把 Authorization 转发到重定向地址。
- 保留独立超时控制，分别报告供应商 HTTP 错误、连接异常、超时和重定向。网络异常仅返回固定诊断，不返回原始异常、请求头、Key 或内部信息。
- Key 两端空白自动修整；嵌入空白、换行、非 ASCII 字符及 `Bearer` 前缀在请求前明确提示。
- 仅 DeepSeek 连接测试使用关闭思考、`reasoning_effort: "none"`、64 Token 和非流式请求，减少无意义的思考与消耗；正常问答不因测试设置改变。[官方参数](https://api-docs.deepseek.com/api/create-chat-completion/)
- 测试通过后仍需“保存并应用配置”；测试输入不会自动持久化 Key。

## 实际验证

云端测试由 6 项增加至 15 项，全部通过。覆盖 workerd 兼容参数、重定向不转发凭据、网络异常脱敏、定时 Abort、HTTP 401 区分、密钥格式，以及测试与正常聊天参数隔离。

公网分别以无效测试 Key 请求 `/api/models/list` 与 `/api/models/test`。修复前两者均在供应商请求阶段异常；修复后分别用时约 1.49 秒、0.61 秒，均收到“供应商返回 HTTP 401”。网站封装状态为 502，但详情明确保留供应商 401，证明请求已到供应商认证层。

没有读取、保存或调用用户的真实 Key，也没有用这次无效 Key 验证实际付费生成。真实账户仍以供应商认证、余额和模型权限为准。

## 用户操作

本次仅修复服务端，已有页面可直接重新点击“测试当前模型”，无需为了这次故障重建 Key。成功后点击“保存并应用配置”。若收到明确的 401、402、403、404 或 429，分别检查密钥、余额、权限、模型/地址及限流；若仍收到网络或超时诊断，再排查计算服务到供应商的连接。
