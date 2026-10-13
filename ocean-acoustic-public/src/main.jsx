import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import GraphExplorer from "./GraphExplorer";
import ModelPanel from "./ModelPanel";
import { ChatProvider, useChatSession, ChatModelSwitcher } from "./chat-session";
import OceanBanner from "./OceanBanner";
import MascotDock from "./MascotDock";
import {
  Waves,
  MessageSquare,
  Network,
  FlaskConical,
  FolderCode,
  Settings2,
  Activity,
  ArrowUpRight,
  ChevronRight,
  Search,
  Maximize2,
  Plus,
  Minus,
  RotateCcw,
  BookOpen,
  ExternalLink,
  ArrowUp,
  Play,
  Pause,
  Check,
  AlertCircle,
  X,
  Download,
  FileText,
  Terminal,
  GitBranch,
  SlidersHorizontal,
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  Save,
  PanelRightClose,
} from "lucide-react";
import "./style.css";
import "./workbench.css";
import "./ocean-theme.css";
const api = async (path, options = {}) => {
  const r = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({ detail: r.statusText }));
    throw Error(
      typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail),
    );
  }
  return r.json();
};
const stateName = {
  QUEUED: "排队中",
  RUNNING: "运行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};
const relationName = {
  has_boundary: "边界条件",
  affects: "影响",
  formed_by: "组成",
  requires: "需要",
  differs_from: "不同于",
  calls_after_kraken: "随后调用",
  has_axes: "数据维度",
  observes: "观测",
};
const pages = [
  ["graph", "知识图谱", Network],
  ["chat", "知识问答", MessageSquare],
  ["simulation", "声场仿真", FlaskConical],
  ["project", "课程代码", FolderCode],
  ["jobs", "任务与结果", Activity],
];
const classes = {
  声学原理: "#15868e",
  工具与数据: "#657bac",
  实验观测: "#b48747",
};
function Button({
  children,
  onClick,
  variant = "",
  disabled = false,
  type = "button",
  title,
  ariaLabel,
}) {
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className={"button " + variant}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Badge({ state }) {
  return (
    <span className={"badge " + state.toLowerCase()}>
      <i />
      {stateName[state]}
    </span>
  );
}
function App() {
  const chat = useChatSession();
  const [page, setPage] = useState("graph");
  const [initialKnowledge, setInitialKnowledge] = useState(null);
  const [health, setHealth] = useState(null);
  const [toast, setToast] = useState("");
  const [image, setImage] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [activeJob, setActiveJob] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!chat.ready) return;
    let alive = true;
    const check = () =>
      api("/health")
        .then((data) => {
          if (alive) setHealth(data);
        })
        .catch(() => {
          if (alive)
            setHealth({ matlab_available: false, gateway_online: false });
        });
    check();
    const timer = setInterval(check, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refresh, chat.ready]);
  useEffect(() => {
    const open = () => { setPage("settings"); setSidebarOpen(false); };
    const changed = () => { void chat.reloadConfig(); setRefresh((value) => value + 1); };
    window.addEventListener("ocean-open-settings", open);
    window.addEventListener("ocean-model-config-changed", changed);
    return () => { window.removeEventListener("ocean-open-settings", open); window.removeEventListener("ocean-model-config-changed", changed); };
  }, [chat.reloadConfig]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        setImage(null);
        setSidebarOpen(false);
      }
      if (event.altKey && /^[1-6]$/.test(event.key)) {
        event.preventDefault();
        setPage(
          [...pages.map((item) => item[0]), "settings"][Number(event.key) - 1],
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = pages.find((item) => item[0] === page)?.[1] || "模型与环境";
  const navigate = useCallback((id) => {
    setPage(id);
    setSidebarOpen(false);
  }, []);
  const openMascotChat = useCallback(() => navigate("chat"), [navigate]);
  const openMascotSettings = useCallback(() => navigate("settings"), [navigate]);
  const openMascotKnowledge = useCallback((id) => {
    setInitialKnowledge({ id, request: Date.now() });
    navigate("graph");
  }, [navigate]);
  const connected = !!health?.matlab_available;

  return (
    <div className={"app workbench-app" + (sidebarOpen ? " sidebar-open" : "")}>
      <a className="skip-link" href="#workspace-content">
        跳到工作区域
      </a>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="关闭导航"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className="sidebar" aria-label="主导航">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate("graph");
          }}
        >
          <span className="brand-icon">
            <Waves size={23} />
          </span>
          <div>
            海洋声学<span>课程工作台</span>
          </div>
        </a>
        <div className="side-label">研究与学习</div>
        <nav>
          {pages.map(([id, label, Icon], index) => (
            <button
              key={id}
              className={page === id ? "nav-item active" : "nav-item"}
              aria-current={page === id ? "page" : undefined}
              title={"Alt + " + (index + 1)}
              onClick={() => navigate(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {id === "graph" && (
                <span className="nav-count">
                  {health?.knowledge_cards || 46}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <FolderCode size={16} />
          <div>
            当前课程项目<span>Munk 深海声道 / KRAKEN</span>
          </div>
        </div>
        <div className="side-bottom">
          <button
            className={page === "settings" ? "nav-item active" : "nav-item"}
            title="Alt + 6"
            onClick={() => navigate("settings")}
          >
            <Settings2 size={17} />
            <span>模型与环境</span>
          </button>
          <a
            className="repository-link"
            href="https://github.com/Weijifen666/ocean-acoustic-workbench"
            target="_blank"
            rel="noreferrer"
          >
            <GitBranch size={15} />
            项目源码
            <ExternalLink size={12} />
          </a>
          <div className="team">
            四人小组
            <br />
            高嘉豪 · 周子涵 · 刘继洲 · 李杰
          </div>
          <div className="course-purpose">仅用于课程作业 · 无商业用途</div>
        </div>
      </aside>
      <div className="main">
        <header className="workspace-header">
          <div className="workspace-header-left">
            <button
              className="mobile-menu"
              aria-label="打开导航菜单"
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen((open) => !open)}
            >
              <SlidersHorizontal size={19} />
            </button>
            <div className="breadcrumb">
              海洋声学工作台
              <ChevronRight size={14} />
              <strong>{title}</strong>
            </div>
          </div>
          <div className="header-status">
            <span
              title={
                connected
                  ? "共享计算节点已连接"
                  : "节点离线时仍可浏览云端课程图谱"
              }
            >
              <i className={connected ? "green" : "orange"} />
              {health === null
                ? "正在检测计算节点"
                : connected
                  ? "MATLAB 已连接"
                  : "计算节点离线"}
            </span>
            <button onClick={() => navigate("settings")}>
              <span
                className={
                  "mini-dot " + (chat.config?.api_key_set ? "green" : "orange")
                }
              />
              {chat.config?.api_key_set ? chat.catalog.models.find((m) => m.provider === chat.config.provider && m.id === chat.config.model)?.name || chat.config.model : "模型未配置"}
              <ChevronRight size={13} />
            </button>
          </div>
        </header>
        <main id="workspace-content" tabIndex={-1}>
          {(page === "graph" || page === "chat") && <OceanBanner />}
          {!chat.ready && <section className="panel visitor-loading"><Loader2 className="spin" size={20}/><h2>正在准备课程空间</h2><p>{chat.loadError || "载入你的模型配置与对话。"}</p>{chat.loadError && <Button onClick={() => chat.reloadConfig()}>重新载入</Button>}</section>}
          {chat.ready && page === "graph" && (
            <GraphExplorer
              setImage={setImage}
              notify={setToast}
              initialKnowledge={initialKnowledge}
              onAsk={(node) => {
                chat.setText(`请解释知识图谱中的“${node.label}”，结合公式、适用条件和相关知识点，并给出资料出处。`);
                navigate("chat");
              }}
              onSimulation={() => navigate("simulation")}
            />
          )}
          {chat.ready && page === "chat" && (
            <ChatView
              health={health}
              notify={setToast}
              openSettings={() => navigate("settings")}
              onKnowledge={(nodeId) => {
                setInitialKnowledge({ id: nodeId, request: Date.now() });
                navigate("graph");
              }}
            />
          )}
          {chat.ready && page === "simulation" && (
            <Simulation
              notify={setToast}
              onSubmit={(id) => {
                setActiveJob(id);
                navigate("jobs");
              }}
            />
          )}
          {chat.ready && page === "project" && <Project notify={setToast} />}
          {chat.ready && page === "jobs" && (
            <Jobs
              notify={setToast}
              activeJob={activeJob}
              setActiveJob={setActiveJob}
              openSim={() => navigate("simulation")}
              setImage={setImage}
            />
          )}
          {chat.ready && page === "settings" && (
            <Config
              notify={setToast}
              onSaved={() => { void chat.reloadConfig(); setRefresh((value) => value + 1); }}
            />
          )}
        </main>
        <footer className="workspace-statusbar">
          <span>
            <i className={connected ? "green" : "orange"} />
            {health === null
              ? "正在检测计算节点"
              : connected
                ? "共享 MATLAB 计算节点在线"
                : "课程图谱可用 · 计算节点待连接"}
          </span>
          <span>
            课程空间<span className="status-divider">|</span>v0.5
          </span>
        </footer>
      </div>
      <MascotDock onOpenChat={openMascotChat} onOpenSettings={openMascotSettings} onKnowledge={openMascotKnowledge} />
      {toast && (
        <div className="toast" role="status">
          <AlertCircle size={17} />
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {image && (
        <div className="modal-backdrop" onClick={() => setImage(null)}>
          <div
            className="image-modal"
            role="dialog"
            aria-modal="true"
            aria-label={image.caption}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title">
              {image.caption}
              <button
                aria-label="关闭图片"
                autoFocus
                onClick={() => setImage(null)}
              >
                <X />
              </button>
            </div>
            <img src={image.url} alt={image.caption} />
            {image.source_url && (
              <a target="_blank" rel="noreferrer" href={image.source_url}>
                查看原始来源 <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function PageTitle({ title, description, children }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}
function ChatView({
  health,
  notify,
  openSettings,
  onKnowledge,
}) {
  const {mode,setMode,text,setText,msgs,busy,send,selectionBusy,ready,config,knowledgeMode,knowledgeStatus,gaps} = useChatSession();
  const bottom = useRef(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);
  return (
    <>
      <PageTitle
        eyebrow="ACOUSTIC ASSISTANT"
        title="知识问答"
      description="选择模型与知识范围，核对课程原文，或阅读课程 MATLAB 模板。"
      >
        <div className="segmented">
          {[
            ["chat", "对话模式"],
            ["agent", "代码分析（Agent）"],
          ].map(([id, name]) => (
            <button
              className={mode === id ? "active" : ""}
              key={id}
              disabled={busy || selectionBusy}
              onClick={() => setMode(id)}
            >
              {id === "agent" ? (
                <FolderCode size={14} />
              ) : (
                <MessageSquare size={14} />
              )}{" "}
              {name}
            </button>
          ))}
        </div>
      </PageTitle>
      <div className="chat-layout">
        <div className="chat-panel panel">
          <ChatModelSwitcher onOpenSettings={openSettings} />
          <div className="chat-scroll">
            {msgs.length === 0 && (
              <div className="chat-welcome">
                <h2>查询原理，核对资料，理解代码</h2>
                <p>可直接检索课程知识；配置 API Key 后使用所选模型组织答案。</p>
                <div className="prompt-grid">
                  {[
                    "声源深度如何影响模态激发？",
                    "传播损失 TL 的参考压力是什么？",
                    "相干与非相干模态求和有什么区别？",
                    "阅读课程模板，说明 KRAKEN 的调用流程",
                  ].map((s) => (
                    <button key={s} onClick={() => setText(s)}>
                      <span>{s}</span>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div className={"message " + m.role + (m.request_failed ? " failed" : "")} key={m.id || i}>
                <div className="avatar">
                  {m.role === "assistant" ? <Waves size={17} /> : "我"}
                </div>
                <div>
                  <div className="message-label">
                    {m.role === "assistant" ? m.request_failed ? "请求未完成" : "海洋声学助手" : "你"}
                  </div>
                  {m.role === "assistant" && <div className="message-provenance">{m.model_used ? <span>{m.model_provider} · 请求 {m.requested_model}{m.response_model && <> · 返回 {m.response_model}</>}</span> : !m.request_failed && m.model_used === false ? <span>课程检索 · 未调用模型</span> : null}{m.knowledge_scope && <span>{m.knowledge_scope === "general" ? "模型一般知识" : "课程依据"}</span>}</div>}
                  <div className="message-text">{m.text}</div>
                  {m.coverage_notice && <p className="answer-coverage-notice">{m.coverage_notice}</p>}
                  <AnswerSources message={m} onKnowledge={onKnowledge} />
                </div>
              </div>
            ))}
            {busy && (
              <div className="thinking">
                <Loader2 className="spin" size={16} />
                正在检索与处理…
              </div>
            )}
            <div ref={bottom} />
          </div>
          <div className="composer">
            <textarea
              aria-label="输入问题"
              placeholder={
                mode === "agent" ? "描述项目分析要求…" : "输入海洋声学问题…"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div>
              <span>
                <BookOpen size={13} />
                {config?.api_key_set
                  ? knowledgeMode === "general" ? "模型一般知识 · 课程来源单独标注" : "课程依据 · 来源不足会明确说明"
                  : "未配置模型 · 使用课程资料检索"}
              </span>
              <Button
                ariaLabel="发送问题"
                variant="primary icon"
                disabled={!ready || busy || selectionBusy || !text.trim()}
                onClick={send}
              >
                <ArrowUp size={18} />
              </Button>
            </div>
          </div>
        </div>
        <aside className="chat-context panel">
          <div className="panel-heading">当前工作上下文</div>
          <div className="context-item">
            <BookOpen size={19} />
            <div>
              课程知识库
              <span>{knowledgeStatus?.cards || 46} 张知识卡 · {knowledgeStatus?.indexed_sources || 0} 份已索引资料<br/>{knowledgeStatus?.indexed_pages || 0} 页 · {knowledgeStatus?.chunks || 0} 个片段</span>
            </div>
          </div>
          <div className="context-item">
            <FlaskConical size={19} />
            <div>
              Munk 深海模板<span>5000 m · 简正波计算</span>
            </div>
          </div>
          <div className="context-item">
            <FolderCode size={19} />
            <div>
              课程公开模板<span>仅查看共享脚本与输入文件</span>
            </div>
          </div>
          <div className="context-note">
            <strong>
              {mode === "agent" ? "Agent 接入状态" : "模型连接状态"}
            </strong>
            <p>
              {mode === "agent"
                ? "Agent 可结合课程公开模板分析代码。读取或操纵访问设备上的 MATLAB，需另装本地连接程序，当前公开版尚未提供。"
                : config?.api_key_set
                  ? "使用所选供应商已保存的 Key。每条新回答记录请求模型与实际返回标识。"
                  : "添加 API Key 后可调用云端模型；不配置也可浏览图谱、读取文件、运行模板仿真。"}
            </p>
          </div>
          <Button onClick={openSettings}>
            <Settings2 size={15} />
            配置模型接口
          </Button>
          <div className="knowledge-growth-note"><strong>知识库可以持续扩充</strong><p>新增资料会进入私有检索索引，无需训练大模型。模型一般知识可补充未覆盖的问题；新增来源须保留出处并核查公式。</p><a href="https://github.com/Weijifen666/ocean-acoustic-workbench/blob/main/docs/KNOWLEDGE_EXPANSION.md" target="_blank" rel="noreferrer">扩库方法与开源参考 <ExternalLink size={12}/></a></div>
          {!!gaps.length && <div className="knowledge-gap-list"><strong>你的待补资料问题 · {gaps.length}</strong>{gaps.slice(0,4).map((gap) => <button key={gap.id} onClick={() => setText(gap.question)}>{gap.question}<small>出现 {gap.count} 次 · 待补来源</small></button>)}<p>只记录当前访客的问题，尚未作为知识入库。</p></div>}
        </aside>
      </div>
    </>
  );
}
function AnswerSources({ message, onKnowledge }) {
  const citations = message.citations || [];
  const evidence = message.evidence || [];
  const rows = citations.length ? citations : evidence;
  if (!rows.length && !message.retrieval) return null;
  const methods = message.retrieval?.methods || [];
  return (
    <details className="answer-sources">
      <summary>
        <BookOpen size={13} />
        检索依据{rows.length ? `（${rows.length}）` : ""}
      </summary>
      {!!methods.length && <p>检索方式：{methods.join(" + ")}</p>}
      {rows.map((row, index) => {
        const evidenceId = row.evidence_id || row.id || row.citation_id;
        const chunk =
          (evidenceId &&
            evidence.find(
              (item) =>
                item.id === evidenceId || item.evidence_id === evidenceId,
            )) ||
          row;
        const nodeId = row.node_id || chunk.node_id;
        const sourceUrl =
          row.url ||
          row.source_url ||
          (row.source_id && row.pdf_page
            ? `/api/source/${row.source_id}/page/${row.pdf_page}`
            : null);
        return (
          <div key={evidenceId || index}>
            <strong>
              {row.label || chunk.label || row.source_id || `依据 ${index + 1}`}
            </strong>
            <p>{chunk.text || chunk.excerpt || chunk.snippet || row.locator}</p>
            <small>
              {[
                row.source_id,
                row.pdf_page ? `PDF 第 ${row.pdf_page} 页` : row.locator,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
            <div>
              {nodeId && (
                <button onClick={() => onKnowledge(nodeId)}>
                  打开知识点
                  <Network size={12} />
                </button>
              )}
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noreferrer">
                  核对原页
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </details>
  );
}
const initialPlan = {
  frequencies_hz: "50, 100",
  source_depths_m: "500, 1000",
  receiver_depth_m: 1000,
  range_min_km: 1,
  range_max_km: 50,
  range_points: 201,
  depth_points: 251,
};
function Simulation({ notify, onSubmit }) {
  const [form, setForm] = useState(initialPlan),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false);
  const [exerciseData, setExerciseData] = useState(null);
  const [exerciseId, setExerciseId] = useState("");
  useEffect(() => {
    api("/exercises")
      .then(setExerciseData)
      .catch(() => {});
  }, []);
  const exercises = Array.isArray(exerciseData)
    ? exerciseData
    : exerciseData?.exercises || [];
  const exercise = exercises.find((item) => item.id === exerciseId);
  function applyExercise(preset) {
    setForm({
      template: preset.template || "munk_5000m",
      frequencies_hz: preset.frequencies_hz.join(", "),
      source_depths_m: preset.source_depths_m.join(", "),
      receiver_depth_m: preset.receiver_depth_m,
      range_min_km: preset.range_min_km,
      range_max_km: preset.range_max_km,
      range_points: preset.range_points,
      depth_points: preset.depth_points,
    });
    setPreview(null);
    notify("命题参数已填入，请检查计算计划后再提交。");
  }
  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setPreview(null);
  };
  const plan = () => ({
    ...form,
    frequencies_hz: form.frequencies_hz
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map(Number),
    source_depths_m: form.source_depths_m
      .split(/[,，\s]+/)
      .filter(Boolean)
      .map(Number),
    receiver_depth_m: Number(form.receiver_depth_m),
    range_min_km: Number(form.range_min_km),
    range_max_km: Number(form.range_max_km),
    range_points: Number(form.range_points),
    depth_points: Number(form.depth_points),
  });
  async function check() {
    try {
      setPreview(
        await api("/plans/preview", {
          method: "POST",
          body: JSON.stringify(plan()),
        }),
      );
    } catch (e) {
      notify(e.message);
    }
  }
  async function run() {
    setBusy(true);
    try {
      const r = await api("/jobs", {
        method: "POST",
        body: JSON.stringify(plan()),
      });
      notify("已提交 " + r.ids.length + " 组真实 MATLAB 计算");
      onSubmit(r.ids[0]);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="SIMULATION STUDIO"
        title="配置声场仿真"
        description="确认参数后，由项目计算节点的 MATLAB 执行；访客无需安装，每批最多 4 组。"
      />
      {!!exercises.length && (
        <section className="panel course-exercises">
          <div className="exercise-heading">
            <div>
              <BookOpen size={16} />
              <strong>课程命题</strong>
              <small>选择题目后明确填入参数，随后检查、运行。</small>
            </div>
            <select
              aria-label="选择课程命题"
              value={exerciseId}
              onChange={(event) => setExerciseId(event.target.value)}
            >
              <option value="">选择一个命题辅助配置</option>
              {exercises.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} · {item.title}
                  {item.runnable ? "" : "（分析题）"}
                </option>
              ))}
            </select>
          </div>
          {exercise && (
            <div className="exercise-body">
              <p className="exercise-question">{exercise.question}</p>
              <p>{exercise.objective}</p>
              <div className="exercise-actions">
                {exercise.runnable && exercise.plan ? (
                  exercise.comparison_plans?.length ? (
                    exercise.comparison_plans.map((preset, index) => (
                      <Button key={index} onClick={() => applyExercise(preset)}>
                        填入第 {index + 1} 份对照参数
                      </Button>
                    ))
                  ) : (
                    <Button onClick={() => applyExercise(exercise.plan)}>
                      填入参数
                    </Button>
                  )
                ) : (
                  <span className="exercise-analysis-note">
                    此题用于条件分析，当前模板不直接执行该命题。
                  </span>
                )}
              </div>
              <details>
                <summary>答题与结果核对提示</summary>
                <ul>
                  {[
                    ...(exercise.expected_outputs || []),
                    ...(exercise.scientific_notes || []),
                  ].map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </section>
      )}
      <div className="simulation-layout">
        <section className="panel sim-form">
          <div className="panel-heading">
            <span>
              01 <b>环境与求解器</b>
            </span>
            <span className="tag">已接入</span>
          </div>
          <div className="template-card">
            <div className="template-icon">
              <Waves size={28} />
            </div>
            <div>
              <h3>Munk 深海声道</h3>
              <p>水深 5000 m · 声速剖面来自教师示例</p>
              <small>KRAKEN / FIELD · 相干简正波</small>
            </div>
            <CheckCircle2 size={20} />
          </div>
          <div className="inline-note">
            <AlertCircle size={14} />
            示例环境不代表指定真实海域。首版暂不开放任意环境编辑。
          </div>
          <div className="panel-heading second">
            <span>
              02 <b>频率与深度</b>
            </span>
          </div>
          <div className="form-grid">
            <Field label="频率组合" unit="Hz" hint="10–200 Hz，用逗号分隔">
              <input
                value={form.frequencies_hz}
                onChange={(e) => set("frequencies_hz", e.target.value)}
              />
            </Field>
            <Field
              label="声源深度组合"
              unit="m"
              hint="大于 0、小于 5000 m，用逗号分隔"
            >
              <input
                value={form.source_depths_m}
                onChange={(e) => set("source_depths_m", e.target.value)}
              />
            </Field>
            <Field label="接收深度" unit="m" hint="返回最近网格点的实际深度">
              <input
                type="number"
                value={form.receiver_depth_m}
                onChange={(e) => set("receiver_depth_m", e.target.value)}
              />
            </Field>
            <Field label="接收深度网格" unit="点" hint="覆盖 0–5000 m">
              <select
                value={form.depth_points}
                onChange={(e) => set("depth_points", e.target.value)}
              >
                {[101, 251, 501].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="panel-heading second">
            <span>
              03 <b>距离与网格</b>
            </span>
          </div>
          <div className="form-grid three">
            <Field label="起始距离" unit="km">
              <input
                type="number"
                value={form.range_min_km}
                onChange={(e) => set("range_min_km", e.target.value)}
              />
            </Field>
            <Field label="终止距离" unit="km">
              <input
                type="number"
                value={form.range_max_km}
                onChange={(e) => set("range_max_km", e.target.value)}
              />
            </Field>
            <Field label="距离网格" unit="点">
              <select
                value={form.range_points}
                onChange={(e) => set("range_points", e.target.value)}
              >
                {[...new Set([101, 201, 401, 501, Number(form.range_points)])]
                  .filter(Number.isFinite)
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n}>{n}</option>
                  ))}
              </select>
            </Field>
          </div>
          <div className="form-footer">
            <span>参数修改后需重新检查</span>
            <Button onClick={check}>
              <Check size={16} />
              检查并生成计划
            </Button>
          </div>
        </section>
        <aside className="panel plan-panel">
          <div className="panel-heading">
            计算计划 <FlaskConical size={17} />
          </div>
          {preview ? (
            <>
              <div className="case-number">
                {preview.case_count}
                <span>组独立计算</span>
              </div>
              <div className="case-list">
                {preview.cases.map((c, i) => (
                  <div key={i}>
                    <small>{String(i + 1).padStart(2, "0")}</small>
                    <span>{c.frequency_hz} Hz</span>
                    <span>源深 {c.source_depth_m} m</span>
                  </div>
                ))}
              </div>
              <div className="plan-notes">
                {preview.warnings.map((s) => (
                  <p key={s}>
                    <AlertCircle size={13} />
                    {s}
                  </p>
                ))}
              </div>
              <Button variant="primary wide" disabled={busy} onClick={run}>
                <Play size={16} />
                确认并运行 MATLAB
              </Button>
            </>
          ) : (
            <div className="empty compact">
              <SlidersHorizontal size={35} />
              <h3>等待参数确认</h3>
              <p>配置左侧参数并检查，查看组合与计算范围。</p>
            </div>
          )}
          <div className="plan-foot">
            <Terminal size={14} />
            独立目录 · 串行运行 · 保留日志
          </div>
        </aside>
      </div>
    </>
  );
}
function Field({ label, unit, hint, children }) {
  return (
    <label className="field">
      <span>
        {label}
        <small>{unit}</small>
      </span>
      {children}
      {hint && <em>{hint}</em>}
    </label>
  );
}
function Jobs({ notify, activeJob, setActiveJob, openSim, setImage }) {
  const [jobs, setJobs] = useState([]),
    [detail, setDetail] = useState(null),
    [tab, setTab] = useState("result"),
    [paused, setPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const list = await api("/jobs");
        if (!alive) return;
        setJobs(list);
        const health = await api("/health");
        setPaused(health.paused);
        const id = activeJob || list[0]?.id;
        if (id) setDetail(await api("/jobs/" + id));
      } catch (e) {
        notify(e.message);
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeJob]);
  async function cancel() {
    try {
      await api("/jobs/" + detail.id + "/cancel", { method: "POST" });
      setDetail(await api("/jobs/" + detail.id));
    } catch (e) {
      notify(e.message);
    }
  }
  async function pause() {
    try {
      const r = await api("/queue/pause", {
        method: "POST",
        body: JSON.stringify({ paused: !paused }),
      });
      setPaused(r.paused);
    } catch (e) {
      notify(e.message);
    }
  }
  async function rerun() {
    try {
      const p = detail.plan;
      const r = await api("/jobs", {
        method: "POST",
        body: JSON.stringify({
          frequencies_hz: [p.frequency_hz],
          source_depths_m: [p.source_depth_m],
          receiver_depth_m: p.receiver_depth_m,
          range_min_km: p.range_min_km,
          range_max_km: p.range_max_km,
          range_points: p.range_points,
          depth_points: p.depth_points,
          template: p.template || "munk_5000m",
        }),
      });
      setActiveJob(r.ids[0]);
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="RUNS & RESULTS"
        title="任务与计算结果"
        description="每次运行保留独立参数、日志和本次输出。"
      >
        <Button variant="primary" onClick={openSim}>
          <Plus size={16} />
          新建仿真
        </Button>
      </PageTitle>
      {jobs.length === 0 ? (
        <div className="empty panel">
          <Activity size={42} />
          <h2>还没有计算任务</h2>
          <p>配置一个仿真，开始第一组真实计算。</p>
          <Button variant="primary" onClick={openSim}>
            配置声场仿真
          </Button>
        </div>
      ) : (
        <div className="jobs-layout">
          <aside className="panel job-list">
            <div className="panel-heading">
              运行记录 <span>{jobs.length}</span>
            </div>
            {jobs.map((j) => (
              <button
                key={j.id}
                className={(activeJob || jobs[0].id) === j.id ? "selected" : ""}
                onClick={() => setActiveJob(j.id)}
              >
                <div>
                  <strong>
                    {j.plan.frequency_hz} Hz · {j.plan.source_depth_m} m
                  </strong>
                  <Badge state={j.state} />
                </div>
                <small>
                  {j.id} ·{" "}
                  {new Date(j.created).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </button>
            ))}
          </aside>
          <section className="panel job-detail">
            {detail && (
              <>
                <div className="job-detail-header">
                  <div>
                    <span className="eyebrow">{detail.id}</span>
                    <h2>
                      {detail.plan.frequency_hz} Hz / 源深{" "}
                      {detail.plan.source_depth_m} m
                    </h2>
                  </div>
                  <Badge state={detail.state} />
                </div>
                <div className="job-actions">
                  <span>Munk · 5000 m · MATLAB R2024a</span>
                  {["QUEUED", "RUNNING"].includes(detail.state) ? (
                    <Button onClick={cancel}>
                      <X size={14} />
                      取消任务
                    </Button>
                  ) : (
                    <Button onClick={rerun}>
                      <RotateCcw size={14} />
                      重跑
                    </Button>
                  )}
                  <a
                    className="button"
                    href={"/api/jobs/" + detail.id + "/download"}
                  >
                    <Download size={14} />
                    下载结果包
                  </a>
                </div>
                <div className="tabs">
                  {[
                    ["result", "结果图表"],
                    ["log", "运行日志"],
                    ["files", "输出文件"],
                  ].map(([id, name]) => (
                    <button
                      key={id}
                      className={tab === id ? "selected" : ""}
                      onClick={() => setTab(id)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                {tab === "log" ? (
                  <pre className="code log">{detail.log}</pre>
                ) : tab === "files" ? (
                  <div className="artifact-list">
                    {detail.artifacts.map((f) => (
                      <a
                        key={f}
                        href={`/api/jobs/${detail.id}/artifact/${f}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FileText size={16} />
                        {f}
                        <Download size={15} />
                      </a>
                    ))}
                  </div>
                ) : detail.state === "SUCCEEDED" ? (
                  <div className="result-body">
                    <div className="result-metrics">
                      {[
                        [
                          "有效比例",
                          (detail.summary.valid_ratio * 100).toFixed(1) + "%",
                        ],
                        [
                          "中位 TL",
                          detail.summary.tl_median_db.toFixed(2) + " dB",
                        ],
                        [
                          "接收深度",
                          detail.summary.actual_receiver_depth_m + " m",
                        ],
                        ["结果网格", detail.summary.shape.join(" × ")],
                      ].map(([l, v]) => (
                        <div key={l}>
                          <span>{l}</span>
                          <strong>{v}</strong>
                        </div>
                      ))}
                    </div>
                    {["tl_map.png", "tl_curve.png"].map((name) => (
                      <button
                        className="result-image"
                        key={name}
                        onClick={() =>
                          setImage({
                            url: `/api/jobs/${detail.id}/artifact/${name}`,
                            caption: "实际 MATLAB 计算 · " + detail.id,
                          })
                        }
                      >
                        <img
                          src={`/api/jobs/${detail.id}/artifact/${name}`}
                          alt={
                            name === "tl_map.png"
                              ? "传播损失声场图"
                              : "传播损失曲线"
                          }
                        />
                      </button>
                    ))}
                    <p className="result-note">
                      {detail.summary.reference}
                      。接收深度采用最近网格点；统计覆盖本次网格，不能据此推断所有位置均最优。
                    </p>
                    {detail.summary.analysis && (
                      <ScientificAnalysis analysis={detail.summary.analysis} />
                    )}
                  </div>
                ) : (
                  <div className="empty">
                    <span>
                      {detail.state === "RUNNING" ? (
                        <Loader2 className="spin" size={34} />
                      ) : detail.state === "FAILED" ? (
                        <AlertCircle size={34} />
                      ) : (
                        <Activity size={34} />
                      )}
                    </span>
                    <h3>{stateName[detail.state]}</h3>
                    <p>
                      {detail.error ||
                        "结果通过校验后，将在这里显示。可切换到运行日志查看进度。"}
                    </p>
                    {detail.state === "FAILED" && (
                      <Button onClick={() => setTab("log")}>
                        查看失败日志
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
function ScientificAnalysis({ analysis }) {
  return (
    <section className="scientific-analysis">
      <h3>数值结果与解释边界</h3>
      {!!analysis.highlights?.length && (
        <dl>
          {analysis.highlights.map((item, index) => (
            <div key={item.id || index}>
              <dt>{item.label}</dt>
              <dd>
                {typeof item.value === "number"
                  ? Number(item.value.toFixed(3))
                  : item.value}
                {item.unit ? ` ${item.unit}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!!analysis.limits?.length && (
        <ul>
          {analysis.limits.map((limit, index) => (
            <li key={index}>{limit}</li>
          ))}
        </ul>
      )}
      {analysis.comparability?.can_rank_environments === false && (
        <p>本次示例计算不用于判断不同真实海域的优劣。</p>
      )}
    </section>
  );
}
function Project({ notify }) {
  const [data, setData] = useState(null),
    [file, setFile] = useState(null),
    [q, setQ] = useState("");
  useEffect(() => {
    api("/project/files")
      .then(setData)
      .catch((e) => notify(e.message));
  }, []);
  async function open(path) {
    try {
      setFile(await api("/project/file?path=" + encodeURIComponent(path)));
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="COURSE TEMPLATES"
        title="课程代码"
        description="浏览课程共享的 MATLAB 示例及输入文件。"
      />
      <div className="project-root">
        <FolderCode size={16} />
        {data?.root || "正在读取项目目录…"}
        <span>只读浏览</span>
      </div>
      <div className="project-layout">
        <aside className="panel">
          <label className="search">
            <Search size={15} />
            <input
              aria-label="筛选文件"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="筛选文件"
            />
          </label>
          <div className="file-list">
            {data?.files
              .filter((f) => f.path.toLowerCase().includes(q.toLowerCase()))
              .map((f) => (
                <button
                  key={f.path}
                  className={file?.path === f.path ? "selected" : ""}
                  onClick={() => open(f.path)}
                >
                  <FileText size={15} />
                  <span>
                    {f.path}
                    <small>{(f.size / 1024).toFixed(1)} KB</small>
                  </span>
                </button>
              ))}
          </div>
        </aside>
        <section className="panel editor">
          <div className="panel-heading">
            {file?.path || "选择一个项目文件"}
            <span>UTF-8</span>
          </div>
          {file ? (
            <>
              <pre className="code">
                {file.content.split("\n").map((line, i) => (
                  <div key={i}>
                    <span className="line-num">{i + 1}</span>
                    {line || " "}
                  </div>
                ))}
              </pre>
              <div className="editor-foot">
                SHA-256 {file.sha256.slice(0, 20)}… · 课程公开模板 · 只读
              </div>
            </>
          ) : (
            <div className="empty">
              <FolderCode size={38} />
              <p>点击左侧文件查看内容</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function Config({ notify, onSaved }) {
  const [cfg, setCfg] = useState(null),
    [checks, setChecks] = useState(null),
    [busy, setBusy] = useState(false),
    [resources, setResources] = useState([]);
  useEffect(() => {
    api("/config")
      .then(setCfg)
      .catch((e) => notify(e.message));
    api("/sources")
      .then(setResources)
      .catch((e) => notify(e.message));
    api("/environment/check", { method: "POST" })
      .then(setChecks)
      .catch((e) => notify(e.message));
  }, []);
  async function save() {
    setBusy(true);
    try {
      await api("/config", { method: "PUT", body: JSON.stringify(cfg) });
      notify("已保存当前访客的模型配置");
      onSaved();
      setCfg(await api("/config"));
      setChecks(await api("/environment/check", { method: "POST" }));
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!cfg)
    return (
      <div className="empty">
        <Loader2 className="spin" />
      </div>
    );
  const input = (key) => (e) =>
    setCfg((c) => ({ ...c, [key]: e.target.value }));
  return (
    <>
      <PageTitle
        eyebrow="ENVIRONMENT"
        title="模型与环境"
        description="填写你自己的模型密钥；MATLAB 由共享计算节点执行。"
      >
        <Button variant="primary" disabled={busy} onClick={save}>
          <Save size={15} />
          保存配置
        </Button>
      </PageTitle>
      <div className="settings-layout public-settings">
        {!cfg.public_mode && (
          <section className="panel settings-panel">
            <div className="panel-heading">
              <span>
                <Terminal size={17} />
                本地计算环境
              </span>
              <span className="tag">Windows</span>
            </div>
            <Field label="MATLAB 可执行路径">
              <input value={cfg.matlab_path} onChange={input("matlab_path")} />
            </Field>
            <Field label="AT 工具包目录">
              <input
                value={cfg.toolbox_path}
                onChange={input("toolbox_path")}
              />
            </Field>
            <Field label="授权项目目录">
              <input
                value={cfg.project_path}
                onChange={input("project_path")}
              />
            </Field>
            <Field label="单任务超时" unit="秒">
              <input
                type="number"
                value={cfg.timeout_seconds}
                onChange={input("timeout_seconds")}
              />
            </Field>
            <Button
              onClick={async () => {
                try {
                  setChecks(
                    await api("/environment/check", { method: "POST" }),
                  );
                  notify("环境检查完成");
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              <CheckCircle2 size={15} />
              检查运行环境
            </Button>
          </section>
        )}
        <ModelPanel
          cfg={cfg}
          setCfg={setCfg}
          onSave={save}
          busy={busy}
          notify={notify}
        />
      </div>
      {checks && (
        <section className="panel environment-checks">
          <div className="panel-heading">环境检查结果</div>
          <div>
            {checks.checks.map((c) => (
              <div className="check-item" key={c.name}>
                {c.ok ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.detail}</small>
                </div>
                <span className={c.ok ? "ok" : "pending"}>
                  {c.ok ? "通过" : "待配置"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="panel resource-panel">
        <div className="panel-heading">
          资料来源与入库状态<span>{resources.length} 份来源</span>
        </div>
        <div className="resource-scroll">
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>来源文件</th>
                <th>资料状态</th>
                <th>知识关联</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {resources.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>
                    {s.name}
                    <small>{s.reading_scope}</small>
                  </td>
                  <td>
                    {s.duplicate_of
                      ? "重复 " + s.duplicate_of
                      : s.extraction_state === "needs_ocr"
                        ? "扫描版 · 待 OCR"
                        : s.available
                          ? "PDF 可预览"
                          : "元数据已登记"}
                  </td>
                  <td>{s.index_status}</td>
                  <td>
                    {s.available && (
                      <a
                        href={"/api/source/" + s.id}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={15} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
createRoot(document.getElementById("root")).render(<ChatProvider><App /></ChatProvider>);
