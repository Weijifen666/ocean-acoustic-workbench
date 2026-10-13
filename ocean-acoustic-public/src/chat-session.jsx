import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BookOpen, Globe2, Loader2, Settings2 } from "lucide-react";
import "./chat-controls.css";

const ChatContext = createContext(null);
const EMPTY_CATALOG = { providers: [], models: [] };

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch("/api" + path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    const error = new Error("网络连接未完成，请检查连接后重试。问题草稿会保留。");
    error.status = 0;
    throw error;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "服务请求未完成";
    const error = new Error(`${detail}（HTTP ${response.status}）`);
    error.status = response.status;
    error.code = typeof data?.code === "string" ? data.code : undefined;
    throw error;
  }
  if (data === null) throw new Error("服务响应格式不兼容，请稍后重试。");
  return data;
}

// The context only holds public connection metadata. No secret fields are
// copied, inspected, submitted, or written to browser storage here.
function publicConfig(raw) {
  if (!raw || typeof raw !== "object") throw new Error("模型配置响应格式不兼容。");
  return {
    provider: typeof raw.provider === "string" ? raw.provider : "",
    model: typeof raw.model === "string" ? raw.model : "",
    base_url: typeof raw.base_url === "string" ? raw.base_url : "",
    api_key_set: raw.api_key_set === true,
    public_mode: raw.public_mode === true,
    storage: typeof raw.storage === "string" ? raw.storage : undefined,
  };
}

function publicProfiles(raw) {
  const rows = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [provider, value] of Object.entries(raw)) {
      if (value && typeof value === "object") rows[provider] = publicConfig(value);
    }
  }
  return rows;
}

function historyRows(raw) {
  if (!Array.isArray(raw)) throw new Error("对话历史响应格式不兼容。");
  return raw.filter((row) => row && ["user", "assistant"].includes(row.role)).map((row) => ({
    id: row.id,
    role: row.role,
    text: typeof row.text === "string" ? row.text : "",
    mode: row.mode,
    knowledge_mode: row.knowledge_mode,
    model_used: row.model_used,
    model_provider: row.model_provider,
    requested_model: row.requested_model,
    response_model: row.response_model,
    knowledge_scope: row.knowledge_scope,
    coverage_notice: row.coverage_notice,
    coverage_status: row.coverage_status,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    citations: Array.isArray(row.citations) ? row.citations : [],
    retrieval: row.retrieval,
  }));
}

export function ChatProvider({ notify, children }) {
  const [textState, setTextState] = useState("");
  const [messagesState, setMessagesState] = useState([]);
  const [busy, setBusy] = useState(false);
  const [modeState, setModeState] = useState("chat");
  const [knowledgeModeState, setKnowledgeModeState] = useState("course");
  const [config, setConfig] = useState(null);
  const [catalog, setCatalog] = useState(EMPTY_CATALOG);
  const [profiles, setProfiles] = useState({});
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [knowledgeStatus, setKnowledgeStatus] = useState(null);
  const [gaps, setGaps] = useState([]);

  const aliveRef = useRef(true);
  const notifyRef = useRef(notify);
  const textRef = useRef("");
  const messagesRef = useRef([]);
  const modeRef = useRef("chat");
  const knowledgeModeRef = useRef("course");
  const configRef = useRef(null);
  const catalogRef = useRef(EMPTY_CATALOG);
  const profilesRef = useRef({});
  const readyRef = useRef(false);
  const busyRef = useRef(false);
  const selectionPromiseRef = useRef(null);
  const reloadPromiseRef = useRef(null);
  const bootstrapPromiseRef = useRef(null);
  const messageRevisionRef = useRef(0);
  const messageCounterRef = useRef(0);
  notifyRef.current = notify;

  const announce = useCallback((message) => {
    try { notifyRef.current?.(message); } catch { /* Host notifications must not break the session. */ }
  }, []);

  const setText = useCallback((next) => {
    const value = typeof next === "function" ? next(textRef.current) : next;
    textRef.current = typeof value === "string" ? value : "";
    if (aliveRef.current) setTextState(textRef.current);
  }, []);
  const setMsgs = useCallback((next) => {
    const value = typeof next === "function" ? next(messagesRef.current) : next;
    messagesRef.current = Array.isArray(value) ? value : [];
    messageRevisionRef.current += 1;
    if (aliveRef.current) setMessagesState(messagesRef.current);
  }, []);
  const setMode = useCallback((next) => {
    const value = typeof next === "function" ? next(modeRef.current) : next;
    if (!["chat", "agent"].includes(value)) return;
    modeRef.current = value;
    if (aliveRef.current) setModeState(value);
  }, []);
  const setKnowledgeMode = useCallback((next) => {
    const value = typeof next === "function" ? next(knowledgeModeRef.current) : next;
    if (!["course", "general"].includes(value)) return;
    knowledgeModeRef.current = value;
    if (aliveRef.current) setKnowledgeModeState(value);
  }, []);

  const acceptConfig = useCallback((raw) => {
    const value = publicConfig(raw);
    configRef.current = value;
    if (aliveRef.current) setConfig(value);
    return value;
  }, []);
  const acceptProfiles = useCallback((raw) => {
    const value = publicProfiles(raw);
    profilesRef.current = value;
    if (aliveRef.current) setProfiles(value);
    return value;
  }, []);

  const refreshKnowledgeStatus = useCallback(async () => {
    try {
      const data = await request("/knowledge/status");
      if (aliveRef.current) setKnowledgeStatus(data);
      return data;
    } catch (error) {
      const unavailable = { unavailable: true, scope: "知识库状态暂时无法读取。", error: error.message };
      if (aliveRef.current) setKnowledgeStatus(unavailable);
      return unavailable;
    }
  }, []);
  const refreshGaps = useCallback(async () => {
    try {
      const data = await request("/knowledge/gaps");
      const rows = Array.isArray(data) ? data : Array.isArray(data?.gaps) ? data.gaps : [];
      if (aliveRef.current) setGaps(rows);
      return rows;
    } catch {
      // Older servers or an unavailable private index must not block chat.
      if (aliveRef.current) setGaps([]);
      return [];
    }
  }, []);

  const reloadConfig = useCallback(async () => {
    // Settings and both chat surfaces may ask for a refresh concurrently.
    if (reloadPromiseRef.current) return reloadPromiseRef.current;
    const pending = (async () => {
      if (selectionPromiseRef.current) await selectionPromiseRef.current;
      try {
        // Establish one visitor cookie before any further visitor API GETs.
        const fresh = acceptConfig(await request("/config"));
        const [models, saved] = await Promise.all([
          catalogRef.current.providers.length ? catalogRef.current : request("/models/catalog"),
          request("/models/profiles"),
        ]);
        if (!Array.isArray(models?.providers) || !Array.isArray(models?.models) || !models.providers.length) {
          throw new Error("模型目录尚未准备好，请稍后重新加载。");
        }
        catalogRef.current = models;
        acceptProfiles(saved);
        readyRef.current = true;
        if (aliveRef.current) {
          setCatalog(models);
          setReady(true);
          setLoadError("");
        }
        return fresh;
      } catch (error) {
        readyRef.current = false;
        if (aliveRef.current) { setReady(false); setLoadError(error.message); }
        announce(error.message);
        return null;
      }
    })();
    reloadPromiseRef.current = pending;
    try { return await pending; }
    finally { if (reloadPromiseRef.current === pending) reloadPromiseRef.current = null; }
  }, [acceptConfig, acceptProfiles, announce]);

  useEffect(() => {
    aliveRef.current = true;
    // A shared promise also prevents duplicate bootstrap in React StrictMode.
    if (!bootstrapPromiseRef.current) {
      bootstrapPromiseRef.current = (async () => {
        const initial = await reloadConfig();
        if (!initial) return;
        const revision = messageRevisionRef.current;
        const loadHistory = request("/chat/history").then((raw) => {
          const rows = historyRows(raw);
          // A delayed history response must never replace a fresh send or edit.
          if (aliveRef.current && messageRevisionRef.current === revision && !busyRef.current) setMsgs(rows);
        }).catch((error) => {
          if (aliveRef.current) { setLoadError("历史暂未载入：" + error.message); announce("历史暂未载入：" + error.message); }
        });
        await Promise.all([loadHistory, refreshKnowledgeStatus(), refreshGaps()]);
      })();
    }
    return () => { aliveRef.current = false; };
  }, [reloadConfig, refreshKnowledgeStatus, refreshGaps, setMsgs, announce]);

  const selectModel = useCallback(async (provider, model) => {
    if (busyRef.current || selectionPromiseRef.current) return false;
    const earlierReload = reloadPromiseRef.current;
    const pending = (async () => {
      if (aliveRef.current) setSelectionBusy(true);
      try {
        // An earlier Settings refresh must finish before choosing a profile;
        // otherwise its delayed GET could roll back a just-saved selection.
        if (earlierReload) await earlierReload;
        if (!readyRef.current || !configRef.current) throw new Error("模型配置尚未载入，请稍后重试。");
        const current = configRef.current;
        const saved = provider === current.provider ? current : profilesRef.current[provider];
        const validProvider = catalogRef.current.providers.some((row) => row.id === provider);
        const validModel = catalogRef.current.models.some((row) => row.provider === provider && row.id === model)
          || saved?.model === model;
        if (!validProvider || !validModel) throw new Error("请选择目录模型或已经保存的自定义模型。");
        if (!saved?.api_key_set || !saved.base_url) throw new Error("请先在模型设置中保存该供应商的连接和密钥。");
        if (provider === current.provider && model === current.model) return true;
        // Changing a model within one provider retains that provider's key and
        // endpoint. A different provider uses its saved endpoint, never a
        // guessed/default region or another provider's connection.
        const body = { provider, model, ...(provider !== current.provider ? { base_url: saved.base_url } : {}) };
        const next = acceptConfig(await request("/config", { method: "PUT", body: JSON.stringify(body) }));
        acceptProfiles({ ...profilesRef.current, [provider]: next });
        try { acceptProfiles(await request("/models/profiles")); }
        catch { announce("模型选择已保存；其他供应商状态暂未刷新。"); }
        if (aliveRef.current) setLoadError("");
        return true;
      } catch (error) {
        if (aliveRef.current) setLoadError("模型切换未保存：" + error.message);
        announce("模型切换未保存：" + error.message);
        return false;
      } finally {
        if (aliveRef.current) setSelectionBusy(false);
      }
    })();
    selectionPromiseRef.current = pending;
    try { return await pending; }
    finally { if (selectionPromiseRef.current === pending) selectionPromiseRef.current = null; }
  }, [acceptConfig, acceptProfiles, announce]);

  const send = useCallback(async () => {
    const draft = textRef.current;
    const message = draft.trim();
    if (!message || busyRef.current) return null;
    if (message.length > 12000) { announce("问题最多 12000 字符，请缩短后再发送。"); return null; }
    // Ref changes synchronously, unlike a render: duplicate Enter/click events
    // across the main panel and floating chat cannot dispatch a second call.
    busyRef.current = true;
    if (aliveRef.current) setBusy(true);
    const requestMode = modeRef.current;
    const requestKnowledge = knowledgeModeRef.current;
    let userId;
    let snapshot;
    try {
      const selection = selectionPromiseRef.current;
      if (selection && !await selection) throw new Error("模型切换未保存，请确认当前模型后重新发送。");
      if (reloadPromiseRef.current) await reloadPromiseRef.current;
      if (!readyRef.current || !configRef.current) throw new Error("当前模型配置尚未载入，请先重新加载配置。");
      snapshot = { ...configRef.current, mode: requestMode, knowledge_mode: requestKnowledge };
      userId = `question-${Date.now().toString(36)}-${++messageCounterRef.current}`;
      if (textRef.current === draft) setText("");
      setMsgs((rows) => [...rows, {
        id: userId, role: "user", text: message, status: "sending",
        mode: snapshot.mode, knowledge_mode: snapshot.knowledge_mode,
        model_provider: snapshot.provider, requested_model: snapshot.model,
      }]);
      const data = await request("/chat", {
        method: "POST",
        body: JSON.stringify({ message, mode: snapshot.mode, knowledge_mode: snapshot.knowledge_mode,
                               provider: snapshot.provider, model: snapshot.model }),
      });
      if (typeof data.reply !== "string") throw new Error("服务没有返回文字消息，不能把这次请求标记为完成。");
      if (aliveRef.current) setLoadError("");
      setMsgs((rows) => [...rows.map((row) => row.id === userId ? { ...row, status: "sent" } : row), {
        id: `answer-${userId}`, role: "assistant", text: data.reply, status: "complete",
        mode: snapshot.mode, knowledge_mode: snapshot.knowledge_mode,
        model_used: data.model_used === true,
        model_provider: data.model_provider || null,
        requested_model: data.requested_model || snapshot.model,
        response_model: data.response_model || null,
        knowledge_scope: data.knowledge_scope || snapshot.knowledge_mode,
        coverage_notice: data.coverage_notice || "",
        coverage_status: data.coverage_status || null,
        evidence: Array.isArray(data.evidence) ? data.evidence : [],
        citations: Array.isArray(data.citations) ? data.citations : [],
        retrieval: data.retrieval,
      }]);
      // These are read-only metadata calls, never a provider connectivity test.
      void refreshGaps();
      void refreshKnowledgeStatus();
      return data;
    } catch (error) {
      if (!textRef.current.trim()) setText(draft);
      if (userId) {
        setMsgs((rows) => [...rows.map((row) => row.id === userId ? { ...row, status: "failed", retry_text: draft } : row), {
          id: `failure-${userId}`, role: "assistant", status: "failed", request_failed: true,
          text: "请求未完成：" + error.message,
          error: error.message, error_code: error.code || null, retry_text: draft,
          mode: requestMode, knowledge_mode: requestKnowledge,
          model_used: null, model_provider: null, response_model: null,
          requested_model: snapshot?.model || null, evidence: [], citations: [],
        }]);
      }
      announce(error.message);
      if (aliveRef.current) setLoadError(error.message);
      return null;
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }, [announce, refreshGaps, refreshKnowledgeStatus, setMsgs, setText]);

  const value = useMemo(() => ({
    text: textState, setText, msgs: messagesState, setMsgs, busy,
    mode: modeState, setMode, knowledgeMode: knowledgeModeState, setKnowledgeMode,
    send, config, catalog, profiles, selectionBusy, selectModel, reloadConfig,
    ready, loadError, knowledgeStatus, refreshKnowledgeStatus, gaps, refreshGaps,
  }), [textState, setText, messagesState, setMsgs, busy, modeState, setMode, knowledgeModeState,
       setKnowledgeMode, send, config, catalog, profiles, selectionBusy, selectModel, reloadConfig,
       ready, loadError, knowledgeStatus, refreshKnowledgeStatus, gaps, refreshGaps]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatSession() {
  const session = useContext(ChatContext);
  if (!session) throw new Error("useChatSession 必须在 ChatProvider 内使用。");
  return session;
}

export function ChatModelSwitcher({ compact = false, onOpenSettings }) {
  const { config, catalog, profiles, ready, busy, selectionBusy, selectModel,
          knowledgeMode, setKnowledgeMode, loadError, reloadConfig } = useChatSession();
  const blocked = !ready || busy || selectionBusy;
  const providers = catalog?.providers || [];
  const provider = providers.find((row) => row.id === config?.provider);
  const rows = (catalog?.models || []).filter((row) => row.provider === config?.provider);
  const custom = config?.model && !rows.some((row) => row.id === config.model);
  const chosen = rows.find((row) => row.id === config?.model);
  const configured = config?.api_key_set === true;
  function openSettings() {
    if (onOpenSettings) onOpenSettings();
    else window.dispatchEvent(new CustomEvent("ocean-open-settings"));
  }
  function changeProvider(event) {
    const id = event.target.value;
    const saved = id === config?.provider ? config : profiles[id];
    if (saved?.model) void selectModel(id, saved.model);
  }
  return (
    <section className={"chat-model-controls" + (compact ? " compact" : "")} aria-label="模型与知识范围">
      <div className="chat-model-row">
        <label className="chat-select-field">
          <span>供应商</span>
          <select aria-label="对话模型供应商" value={config?.provider || ""} disabled={blocked}
                  onChange={changeProvider}>
            {!providers.length && <option value="">正在载入…</option>}
            {providers.map((item) => {
              const available = item.id === config?.provider ? configured : profiles[item.id]?.api_key_set;
              return <option key={item.id} value={item.id} disabled={!available && item.id !== config?.provider}>
                {item.name}{available ? " · 已配密钥" : " · 未配置"}
              </option>;
            })}
          </select>
        </label>
        <label className="chat-select-field chat-model-field">
          <span>模型</span>
          <select aria-label="本次问答使用的模型" value={config?.model || ""}
                  disabled={blocked || !configured}
                  onChange={(event) => void selectModel(config.provider, event.target.value)}>
            {!config?.model && <option value="">正在载入…</option>}
            {rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            {custom && <option value={config.model}>已保存自定义 · {config.model}</option>}
          </select>
        </label>
        <button type="button" className="chat-settings-button" onClick={openSettings}
                disabled={busy || selectionBusy} title="配置供应商、密钥或自定义模型">
          <Settings2 size={14} /><span>{compact ? "设置" : "模型设置"}</span>
        </button>
      </div>
      {chosen?.compatibility_note && <p className="chat-knowledge-notice">{chosen.compatibility_note} · 请求入口与实际返回模型会分别记录。</p>}
      <div className="chat-model-status" aria-live="polite">
        {selectionBusy ? <><Loader2 size={12} className="spin" />正在保存模型选择…</>
          : ready ? <>{configured ? `${provider?.name || config.provider} · ${config.model}` : "未配模型密钥，可直接查课程依据"}
              {configured && <span>已配置密钥，权限与额度以账户为准</span>}</>
          : <>配置尚未载入 <button type="button" onClick={() => void reloadConfig()}>重新加载</button></>}
      </div>
      <div className="chat-knowledge-switch" role="group" aria-label="问答知识范围">
        <button type="button" aria-pressed={knowledgeMode === "course"}
                className={knowledgeMode === "course" ? "active" : ""} disabled={busy || selectionBusy}
                onClick={() => setKnowledgeMode("course")}><BookOpen size={13} />课程依据</button>
        <button type="button" aria-pressed={knowledgeMode === "general"}
                className={knowledgeMode === "general" ? "active" : ""} disabled={busy || selectionBusy}
                onClick={() => setKnowledgeMode("general")}><Globe2 size={13} />通用模型知识</button>
      </div>
      <p className={"chat-knowledge-notice" + (knowledgeMode === "general" ? " general" : "")}>
        {knowledgeMode === "course"
          ? "依据课程来源回答；没有命中时明确说明缺口，不编造引用。"
          : "调用模型已有知识；超出课程资料的内容不代表已核实，也不代表联网搜索。"}
      </p>
      {loadError && <div className="chat-controls-error" role="status">{loadError}</div>}
    </section>
  );
}
