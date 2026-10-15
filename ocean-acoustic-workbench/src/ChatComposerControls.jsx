import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ExternalLink,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Settings2,
  Square,
  X,
} from "lucide-react";
import { useChatSession } from "./chat-session";
import "./chat-controls.css";

const BUDGETS = [
  ["auto", "自动 · 32K"],
  ["4096", "4K"],
  ["8192", "8K"],
  ["16384", "16K"],
  ["32768", "32K"],
  ["65536", "64K"],
  ["131072", "128K"],
];
const selectionValue = (provider, model) =>
  JSON.stringify([provider || "", model || ""]);
const count = (value) =>
  value != null && value !== "" && Number.isFinite(Number(value))
    ? Number(value).toLocaleString("zh-CN")
    : "未提供";
const snapshotTime = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date)
    : "未提供";
};

/** One composer footer, shared by the full conversation and the floating assistant. */
export default function ChatComposerControls({
  compact = false,
  onOpenSettings,
  onOpenChat,
  onKnowledge,
  onSend,
}) {
  const session = useChatSession();
  const {
    config,
    catalog,
    profiles,
    ready,
    busy,
    stop,
    conversationBusy,
    selectionBusy,
    selectModel,
    text,
    setText,
    send,
    mode,
    setMode,
    knowledgeMode,
    setKnowledgeMode,
    knowledgeStatus,
    gaps = [],
    contextBudget = "auto",
    setContextBudget,
    lastContext,
    loadError,
    reloadConfig,
  } = session;
  const [moreOpen, setMoreOpen] = useState(false);
  const [popup, setPopup] = useState({
    left: 12,
    top: 60,
    width: 320,
    maxHeight: 400,
  });
  const controls = useRef(null);
  const moreButton = useRef(null);
  const menu = useRef(null);
  const menuId = useId();
  const blocked = !ready || busy || selectionBusy || conversationBusy;
  const providers = catalog?.providers || [];
  const models = catalog?.models || [];
  const current = models.find(
    (model) =>
      model.provider === config?.provider && model.id === config?.model,
  );
  const currentValue = selectionValue(config?.provider, config?.model);
  const custom = config?.model && !current;
  const publicOcean = knowledgeStatus?.public_ocean;
  const canSend = !blocked && !!text.trim();

  function closeMenu(focus = false) {
    setMoreOpen(false);
    if (focus) moreButton.current?.focus();
  }
  function openSettings() {
    closeMenu();
    if (onOpenSettings) onOpenSettings();
    else window.dispatchEvent(new CustomEvent("ocean-open-settings"));
  }
  function useQuestion(question) {
    setText(question);
    closeMenu();
    requestAnimationFrame(() =>
      controls.current
        ?.closest(".composer, .mascot-chat-composer")
        ?.querySelector("textarea")
        ?.focus({ preventScroll: true }),
    );
  }
  useLayoutEffect(() => {
    if (!moreOpen) return;
    const update = () => {
      if (!moreButton.current || !menu.current) return;
      const anchor = moreButton.current.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 24);
      const maxHeight = Math.max(100, Math.min(520, window.innerHeight - 80));
      const height = Math.min(menu.current.scrollHeight, maxHeight);
      const above = anchor.top - height - 9;
      const preferred = above >= 12 ? above : anchor.bottom + 9;
      setPopup({
        width,
        maxHeight,
        left: Math.max(
          12,
          Math.min(window.innerWidth - width - 12, anchor.right - width),
        ),
        top: Math.max(
          12,
          Math.min(window.innerHeight - height - 12, preferred),
        ),
      });
    };
    update();
    menu.current?.querySelector("select")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(update);
    if (menu.current) observer.observe(menu.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [moreOpen, compact]);
  useEffect(() => {
    if (!moreOpen) return;
    const outside = (event) => {
      if (
        !controls.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      )
        closeMenu();
    };
    const escape = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [moreOpen]);

  return (
    <div
      ref={controls}
      className={`composer-controls${compact ? " compact" : ""}`}
    >
      <div className="composer-controls-row">
        <label className="composer-model-picker">
          <span className="composer-sr-only">模型</span>
          <select
            aria-label={compact ? "快捷问答模型" : "本次问答模型"}
            value={currentValue}
            disabled={blocked}
            title={
              config?.api_key_set
                ? `${config.provider} · ${config.model}`
                : "从更多菜单配置模型密钥"
            }
            onChange={(event) => {
              const [provider, model] = JSON.parse(event.target.value);
              void selectModel(provider, model);
            }}
          >
            {!ready && <option value={currentValue}>正在载入模型…</option>}
            {providers.map((provider) => (
              <optgroup key={provider.id} label={provider.name}>
                {models
                  .filter((model) => model.provider === provider.id)
                  .map((model) => {
                    const available =
                      provider.id === config?.provider
                        ? config?.api_key_set
                        : profiles?.[provider.id]?.api_key_set;
                    return (
                      <option
                        key={model.key || `${provider.id}:${model.id}`}
                        value={selectionValue(provider.id, model.id)}
                        disabled={!available}
                      >
                        {model.name}
                        {!available ? " · 未配密钥" : ""}
                      </option>
                    );
                  })}
              </optgroup>
            ))}
            {custom && (
              <option value={currentValue}>{config.model} · 自定义</option>
            )}
          </select>
        </label>
        <label className="composer-context-picker">
          <span>上下文</span>
          <select
            aria-label={compact ? "快捷问答上下文预算" : "本次问答上下文预算"}
            value={String(contextBudget)}
            disabled={blocked || !setContextBudget}
            title="每轮请求的上下文发送预算；自动默认32K"
            onChange={(event) => setContextBudget?.(event.target.value)}
          >
            {BUDGETS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          ref={moreButton}
          type="button"
          className="composer-more"
          aria-label={compact ? "快捷问答更多设置" : "更多问答设置"}
          aria-expanded={moreOpen}
          aria-controls={menuId}
          title="知识范围、代码分析和模型设置"
          onClick={() => setMoreOpen((value) => !value)}
        >
          <MoreHorizontal size={18} />
        </button>
        <button
          type="button"
          className="composer-send"
          aria-label={busy ? "停止生成" : compact ? "发送快捷问答" : "发送问题"}
          disabled={!busy && !canSend}
          onClick={() => {
            if (busy) stop();
            else if (canSend) void (onSend || send)();
          }}
          title={
            busy
              ? "停止当前请求，保留已收到的内容"
              : "Enter 发送，Shift + Enter 换行"
          }
        >
          {busy ? (
            <Square size={13} fill="currentColor" />
          ) : (
            <ArrowUp size={18} />
          )}
        </button>
      </div>
      {loadError && (
        <p className="composer-control-error" role="status">
          {loadError}
        </p>
      )}
      {moreOpen &&
        createPortal(
          <section
            ref={menu}
            id={menuId}
            className="composer-more-panel"
            role="dialog"
            aria-label="问答设置与知识库"
            aria-modal="false"
            style={popup}
          >
            <div className="composer-more-heading">
              <strong>问答设置</strong>
              <button
                type="button"
                aria-label="关闭问答设置"
                onClick={() => closeMenu(true)}
              >
                <X size={16} />
              </button>
            </div>
            <label className="composer-more-field">
              <span>回答依据</span>
              <select
                aria-label="回答依据范围"
                value={knowledgeMode}
                disabled={blocked}
                onChange={(event) => setKnowledgeMode(event.target.value)}
              >
                <option value="general">资料 + 模型知识</option>
                <option value="course">仅依据资料</option>
              </select>
            </label>
            <label className="composer-more-field">
              <span>工作方式</span>
              <select
                aria-label="问答工作方式"
                value={mode}
                disabled={blocked}
                onChange={(event) => setMode(event.target.value)}
              >
                <option value="chat">知识问答</option>
                <option value="agent">代码分析（Agent）</option>
              </select>
            </label>
            <p className="composer-more-note">
              {knowledgeMode === "course"
                ? "只依据可引用资料回答，缺少来源时明确说明。"
                : "结合可引用资料与模型已有知识；资料外的内容单独标注。"}
            </p>
            {mode === "agent" && (
              <p className="composer-more-note">
                分析课程公开模板；当前不操纵访问设备本机 MATLAB。
              </p>
            )}
            <button
              type="button"
              className="composer-menu-action"
              disabled={busy || selectionBusy}
              onClick={openSettings}
            >
              <Settings2 size={14} />
              模型连接设置
              <span>{config?.api_key_set ? "已配密钥" : "待配置"}</span>
            </button>
            {onOpenChat && (
              <button
                type="button"
                className="composer-menu-action"
                onClick={() => {
                  closeMenu();
                  onOpenChat();
                }}
              >
                <Maximize2 size={14} />
                进入完整知识问答
              </button>
            )}
            {current?.compatibility_note && (
              <details className="composer-info-section">
                <summary>模型入口说明</summary>
                <p>{current.compatibility_note}</p>
                <small>
                  请求 {config?.provider} · {config?.model}
                  ；实际返回标识记录在回答详情。
                </small>
              </details>
            )}
            <details className="composer-info-section">
              <summary>上下文用量</summary>
              <p>
                上下文控制每轮输入的发送预算，自动使用32K，保守估算并预留协议余量；不改变模型原生窗口或KV
                cache，实际Token以供应商返回为准。
              </p>
              {lastContext?.applied === false && (
                <p>上轮未向模型发送上下文。</p>
              )}
              {lastContext ? (
                <dl>
                  {[
                    ["应用预算", lastContext.budget_tokens],
                    ["上轮输入估算", lastContext.estimated_input_tokens],
                    ["实际输入用量", lastContext.provider_prompt_tokens],
                    ["实际缓存命中", lastContext.cached_tokens],
                    ["保留历史消息", lastContext.history_messages_used],
                    ["省略历史消息", lastContext.dropped_history_messages],
                    ["引用片段", lastContext.evidence_count],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value == null ? "未提供" : count(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <small>
                  发送后显示本轮估算，供应商返回实际用量时分别记录。
                </small>
              )}
              {(lastContext?.evidence_truncated ||
                lastContext?.template_truncated ||
                lastContext?.dropped_history_messages > 0) && (
                <p>上轮历史或资料超过预算，已缩短后发送。</p>
              )}
            </details>
            <details className="composer-info-section">
              <summary>知识库与来源</summary>
              {knowledgeStatus ? (
                <>
                  <p>
                    <strong>课程资料</strong>
                    <br />
                    {count(knowledgeStatus.cards)} 个知识点 ·{" "}
                    {count(knowledgeStatus.indexed_sources)} 份索引来源 ·{" "}
                    {count(knowledgeStatus.indexed_pages)} 页 ·{" "}
                    {count(
                      knowledgeStatus.source_chunks ?? knowledgeStatus.chunks,
                    )}{" "}
                    个片段。
                  </p>
                  {publicOcean && (
                    <p>
                      <strong>公开海洋资料</strong>
                      <br />
                      {count(publicOcean.registered_sources)} 项登记 ·{" "}
                      {count(publicOcean.indexed_sources)} 项已索引 ·{" "}
                      {count(publicOcean.chunks)} 个片段。
                      <br />
                      {count(publicOcean.successful_web_documents)} 份网页正文 ·{" "}
                      {count(publicOcean.reference_guides)} 份项目导读。
                      <br />
                      最新采集（北京时间）：
                      {snapshotTime(publicOcean.latest_fetched_at)}
                      {publicOcean.stale_sources > 0 && (
                        <>
                          <br />
                          {count(publicOcean.stale_sources)} 项快照待更新。
                        </>
                      )}
                    </p>
                  )}
                  <p>
                    公开网页与课程页数分别统计；快照可更新，不等于实时海况。新增来源保留出处与采集时间。
                  </p>
                </>
              ) : (
                <p>知识库概况尚未载入。</p>
              )}
              <a
                href="https://github.com/Weijifen666/ocean-acoustic-workbench/blob/main/docs/KNOWLEDGE_EXPANSION.md"
                target="_blank"
                rel="noreferrer"
              >
                查看扩库说明
                <ExternalLink size={12} />
              </a>
              <a
                href="https://github.com/Weijifen666/ocean-acoustic-workbench/blob/main/docs/OPEN_OCEAN_KNOWLEDGE.md"
                target="_blank"
                rel="noreferrer"
              >
                公开海洋资料范围
                <ExternalLink size={12} />
              </a>
            </details>
            <details className="composer-info-section">
              <summary>
                待补资料{gaps.length ? ` · ${gaps.length} 个问题` : ""}
              </summary>
              {gaps.length ? (
                gaps.slice(0, 4).map((gap) => (
                  <button
                    type="button"
                    className="composer-gap-question"
                    key={gap.id}
                    onClick={() => useQuestion(gap.question)}
                  >
                    {gap.question}
                    <small>出现 {gap.count} 次 · 点击继续问</small>
                  </button>
                ))
              ) : (
                <p>当前空间暂无待补来源记录。</p>
              )}
              <small>问题记录不直接作为已核实知识入库。</small>
            </details>
            {!ready && (
              <button
                type="button"
                className="composer-menu-action"
                onClick={() => void reloadConfig()}
              >
                重新加载配置
              </button>
            )}
          </section>,
          document.body,
        )}
    </div>
  );
}
