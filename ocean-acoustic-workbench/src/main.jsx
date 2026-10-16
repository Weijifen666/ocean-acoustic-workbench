import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import GraphExplorer from "./GraphExplorer";
import ModelPanel from "./ModelPanel";
import { ChatProvider, useChatSession } from "./chat-session";
import RichMessage from "./RichMessage";
import ConversationPicker from "./ConversationPicker";
import ResearchWorkspace from "./ResearchWorkspace";
import { AccountBadge, AccountProvider } from "./account";
import { OceanProfile, guideImage } from "./SakanaGuide";
import { SimulationAssistant, JobComparison } from "./SimulationAssist";
import MascotDock from "./MascotDock";
import ChatComposerControls from "./ChatComposerControls";
import MatlabPanel from "./MatlabPanel";
import {
  Waves,
  Users,
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
import "./vendor/fuwari.css";
import "./anime-theme.css";
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
  INTERRUPTED: "执行中断",
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
  ["workspace", "共享课题", Users],
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
  const [initialSimulation, setInitialSimulation] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingNote, setPendingNote] = useState(null);
  const consumeNote = useCallback(() => setPendingNote(null), []);

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
    const open = () => {
      setPage("settings");
      setSidebarOpen(false);
    };
    const changed = () => {
      void chat.reloadConfig();
      setRefresh((value) => value + 1);
    };
    window.addEventListener("ocean-open-settings", open);
    window.addEventListener("ocean-model-config-changed", changed);
    return () => {
      window.removeEventListener("ocean-open-settings", open);
      window.removeEventListener("ocean-model-config-changed", changed);
    };
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
      if (event.altKey && /^[1-7]$/.test(event.key)) {
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
  const openMascotSettings = useCallback(
    () => navigate("settings"),
    [navigate],
  );
  const openMascotKnowledge = useCallback(
    (id) => {
      setInitialKnowledge({ id, request: Date.now() });
      navigate("graph");
    },
    [navigate],
  );
  const openSimulationDraft = useCallback(
    (value) => {
      setInitialSimulation({
        draft: value?.draft_plan ? value : null,
        node_id: value?.node_id || null,
        request: Date.now(),
        apply: !!value?.draft_plan,
      });
      navigate("simulation");
    },
    [navigate],
  );
  useEffect(() => {
    const collect = (event) => {
      if (event.detail && typeof event.detail.body === "string") {
        setPendingNote(event.detail);
        navigate("workspace");
      }
    };
    window.addEventListener("ocean-save-research-note", collect);
    return () =>
      window.removeEventListener("ocean-save-research-note", collect);
  }, [navigate]);
  const connected = !!health?.matlab_available;

  return (
    <div
      data-page={page}
      className={"app workbench-app" + (sidebarOpen ? " sidebar-open" : "")}
    >
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
        <OceanProfile />
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
            title="Alt + 7"
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
          <AccountBadge onOpen={() => navigate("workspace")} />
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
              {chat.config?.api_key_set
                ? chat.catalog.models.find(
                    (m) =>
                      m.provider === chat.config.provider &&
                      m.id === chat.config.model,
                  )?.name || chat.config.model
                : "模型未配置"}
              <ChevronRight size={13} />
            </button>
          </div>
        </header>
        <main id="workspace-content" tabIndex={-1}>
          {!chat.ready && (
            <section className="panel visitor-loading">
              <Loader2 className="spin" size={20} />
              <h2>正在准备课程空间</h2>
              <p>{chat.loadError || "载入你的模型配置与对话。"}</p>
              {chat.loadError && (
                <Button onClick={() => chat.reloadConfig()}>重新载入</Button>
              )}
            </section>
          )}
          {chat.ready && page === "graph" && (
            <GraphExplorer
              setImage={setImage}
              notify={setToast}
              initialKnowledge={initialKnowledge}
              onAsk={(node) => {
                chat.setText(
                  `请解释知识图谱中的“${node.label}”，结合公式、适用条件和相关知识点，并给出资料出处。`,
                );
                navigate("chat");
              }}
              onSimulation={(node) => openSimulationDraft({ node_id: node.id })}
            />
          )}
          {chat.ready && page === "chat" && (
            <ChatView
              health={health}
              notify={setToast}
              openSettings={openMascotSettings}
              onSimulation={openSimulationDraft}
              onKnowledge={openMascotKnowledge}
            />
          )}
          {chat.ready && page === "simulation" && (
            <Simulation
              notify={setToast}
              initialDraft={initialSimulation}
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
          {chat.ready && page === "workspace" && (
            <ResearchWorkspace
              notify={setToast}
              pendingNote={pendingNote}
              onConsumed={consumeNote}
            />
          )}
          {chat.ready && page === "settings" && (
            <Config
              notify={setToast}
              onSaved={() => {
                void chat.reloadConfig();
                setRefresh((value) => value + 1);
              }}
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
            课程空间<span className="status-divider">|</span>v0.7
          </span>
        </footer>
      </div>
      <MascotDock
        onOpenChat={openMascotChat}
        onOpenSettings={openMascotSettings}
        onKnowledge={openMascotKnowledge}
        onSimulation={openSimulationDraft}
      />
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
function ChatView({ openSettings, onKnowledge, onSimulation }) {
  const {
    mode,
    text,
    setText,
    msgs,
    busy,
    send,
    retry,
    progress,
    conversationBusy,
    selectionBusy,
    ready,
  } = useChatSession();
  const messages = useRef(null);
  const followLatest = useRef(true);
  const lastQuestion = useRef(null);
  const canSend =
    ready && !busy && !selectionBusy && !conversationBusy && !!text.trim();
  useEffect(() => {
    const question = [...msgs].reverse().find((row) => row.role === "user")?.id;
    if (question !== lastQuestion.current) {
      followLatest.current = true;
      lastQuestion.current = question;
    }
    if (messages.current && followLatest.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [msgs, busy]);
  return (
    <div className="chat-layout agent-chat">
      <section
        className="chat-panel agent-chat-panel"
        aria-label="海洋声学对话"
      >
        <div className="agent-chat-heading">
          <span>
            <Waves size={17} />
            海洋声学助手
          </span>
          <div className="chat-heading-tools">
            <ConversationPicker />
            <small>NPU · 课程项目</small>
          </div>
        </div>
        <div
          className="chat-scroll"
          ref={messages}
          onScroll={(event) => {
            const el = event.currentTarget;
            followLatest.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {!msgs.length && (
            <div className="chat-welcome">
              <div className="welcome-copy">
                <span className="section-kicker">
                  海洋研究 · 从一个问题开始
                </span>
                <h2>想探索哪片海洋知识？</h2>
                <p>
                  查阅声学原理，核对海洋资料，
                  <br />
                  或一起整理下一组仿真实验。
                </p>
                <div className="prompt-grid">
                  {[
                    "声源深度如何影响模态激发？",
                    "海洋酸化为什么会影响珊瑚生长？",
                  ].map((question) => (
                    <button key={question} onClick={() => setText(question)}>
                      {question}
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="welcome-art">
                <span className="welcome-orbit" />
                <img src={guideImage} alt="原创海洋研究员，手持水听器" />
                <small>让每一个结论，都能找到回响。</small>
              </div>
            </div>
          )}
          {msgs.map((message, index) => (
            <div
              className={`message ${message.role}${message.request_failed ? " failed" : ""}`}
              key={message.id || index}
            >
              <div className="avatar">
                {message.role === "assistant" ? <Waves size={17} /> : "我"}
              </div>
              <div className="message-content">
                <div className="message-label">
                  {message.role === "assistant"
                    ? message.request_failed
                      ? "请求未完成"
                      : "海洋声学助手"
                    : "你"}
                </div>
                {message.role === "assistant" ? (
                  <RichMessage
                    message={message}
                    onKnowledge={onKnowledge}
                    onSimulation={onSimulation}
                    onRetry={retry}
                    onSettings={openSettings}
                  />
                ) : (
                  <div className="message-text">{message.text}</div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="thinking">
              <Loader2 className="spin" size={16} />
              {progress || "正在处理…"}
            </div>
          )}
        </div>
        <div className="composer agent-composer">
          <textarea
            aria-label="输入问题"
            placeholder={
              mode === "agent"
                ? "描述课程代码分析要求…"
                : "输入问题，Shift + Enter 换行"
            }
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (canSend) send();
              }
            }}
          />
          <ChatComposerControls
            onOpenSettings={openSettings}
            onKnowledge={onKnowledge}
            onSend={send}
          />
        </div>
      </section>
    </div>
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
function Simulation({ notify, onSubmit, initialDraft }) {
  const [form, setForm] = useState(initialPlan),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false);
  const [exerciseData, setExerciseData] = useState(null);
  const [exerciseId, setExerciseId] = useState("");
  const submission = useRef(null),
    appliedRequest = useRef(null);
  async function applyDraft(draft) {
    if (!draft?.ready_for_preview) return;
    applyExercise(draft.draft_plan);
    try {
      setPreview(
        await api("/plans/preview", {
          method: "POST",
          body: JSON.stringify(draft.draft_plan),
        }),
      );
    } catch (error) {
      notify(error.message);
    }
  }
  useEffect(() => {
    api("/exercises")
      .then(setExerciseData)
      .catch(() => {});
  }, []);
  const exercises = Array.isArray(exerciseData)
    ? exerciseData
    : exerciseData?.exercises || [];
  const exercise = exercises.find((item) => item.id === exerciseId);
  useEffect(() => {
    if (!initialDraft || appliedRequest.current === initialDraft.request)
      return;
    if (initialDraft.draft && initialDraft.apply) {
      appliedRequest.current = initialDraft.request;
      void applyDraft(initialDraft.draft);
    } else if (initialDraft.node_id && exercises.length) {
      const linked = exercises.find((item) =>
        item.knowledge_nodes?.includes(initialDraft.node_id),
      );
      if (linked) setExerciseId(linked.id);
      appliedRequest.current = initialDraft.request;
    }
  }, [initialDraft, exercises.length]);
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
    if (submission.current?.busy) return;
    const payload = plan(),
      fingerprint = JSON.stringify(payload);
    const key =
      submission.current?.fingerprint === fingerprint
        ? submission.current.key
        : crypto.randomUUID();
    submission.current = { fingerprint, key, busy: true };
    setBusy(true);
    try {
      const r = await api("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(payload),
      });
      submission.current = null;
      notify("已提交 " + r.ids.length + " 组真实 MATLAB 计算");
      onSubmit(r.ids[0]);
    } catch (e) {
      notify(e.message);
    } finally {
      if (submission.current) submission.current.busy = false;
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
      <SimulationAssistant
        initialDraft={initialDraft?.draft}
        onApply={applyDraft}
        notify={notify}
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
  const [selectedJobs, setSelectedJobs] = useState([]),
    [comparing, setComparing] = useState(false);
  function toggleComparison(id) {
    setComparing(false);
    setSelectedJobs((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length < 4
          ? [...current, id]
          : current,
    );
  }
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
      {!!selectedJobs.length && (
        <div className="job-compare-toolbar">
          <span>已选 {selectedJobs.length} / 4 组完成任务</span>
          <button
            disabled={selectedJobs.length < 2}
            onClick={() => setComparing(true)}
          >
            查看对照
          </button>
          <button
            onClick={() => {
              setSelectedJobs([]);
              setComparing(false);
            }}
          >
            清空选择
          </button>
        </div>
      )}
      {comparing && (
        <JobComparison
          key={selectedJobs.join(",")}
          ids={selectedJobs}
          onClose={() => setComparing(false)}
        />
      )}
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
              <div className="job-row" key={j.id}>
                {j.state === "SUCCEEDED" && (
                  <label className="job-compare-select">
                    <input
                      type="checkbox"
                      checked={selectedJobs.includes(j.id)}
                      onChange={() => toggleComparison(j.id)}
                      disabled={
                        !selectedJobs.includes(j.id) && selectedJobs.length >= 4
                      }
                    />
                    加入对照
                  </label>
                )}
                <button
                  className={
                    (activeJob || jobs[0].id) === j.id ? "selected" : ""
                  }
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
              </div>
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
          <MatlabPanel
            cfg={cfg}
            setCfg={setCfg}
            onSave={save}
            busy={busy}
            notify={notify}
          />
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
createRoot(document.getElementById("root")).render(
  <ChatProvider>
    <AccountProvider>
      <App />
    </AccountProvider>
  </ChatProvider>,
);
