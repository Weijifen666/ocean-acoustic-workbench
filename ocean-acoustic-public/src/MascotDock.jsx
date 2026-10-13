import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BookOpen,
  ExternalLink,
  Minus,
  Network,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { useChatSession } from "./chat-session";
import ChatComposerControls from "./ChatComposerControls";
import MascotFigure from "./MascotFigure";
import "./mascot.css";

const POSITION_KEY = "ocean:assistant-position:v1";
const AVATAR_WIDTH = 92;
const AVATAR_HEIGHT = 126;
const MARGIN = 12;
const PARKING_GAP = 12;
const PARKING_CONTROLS =
  ".button.primary, .drawer-footer button, .composer, .composer-controls, .composer-send, .composer textarea, .composer select, .apply-model, .exercise-actions button";

function screenSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}
function clampPosition(position, screen = screenSize()) {
  const maxX = Math.max(MARGIN, screen.width - AVATAR_WIDTH - MARGIN);
  const maxY = Math.max(MARGIN, screen.height - AVATAR_HEIGHT - 40);
  return {
    x: Math.round(Math.max(MARGIN, Math.min(maxX, position.x))),
    y: Math.round(Math.max(Math.min(62, maxY), Math.min(maxY, position.y))),
  };
}
function defaultPosition() {
  const screen = screenSize();
  return clearParking(
    clampPosition(
      {
        x: screen.width - AVATAR_WIDTH - 23,
        y: screen.height - AVATAR_HEIGHT - 46,
      },
      screen,
    ),
  );
}
function clearParking(position) {
  const screen = screenSize();
  const parked = clampPosition(position, screen);
  const controls = [...document.querySelectorAll(PARKING_CONTROLS)]
    // The floating chat intentionally overlays the page; only protect the workspace.
    .filter((element) => !element.closest(".mascot-chat-panel, .mascot-dock"))
    .map((element) => element.getBoundingClientRect())
    .filter(
      (rect) =>
        rect.width &&
        rect.height &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < screen.width &&
        rect.top < screen.height,
    );
  const clear = (candidate) =>
    !controls.some(
      (rect) =>
        candidate.x < rect.right + PARKING_GAP &&
        candidate.x + AVATAR_WIDTH > rect.left - PARKING_GAP &&
        candidate.y < rect.bottom + PARKING_GAP &&
        candidate.y + AVATAR_HEIGHT > rect.top - PARKING_GAP,
    );
  if (clear(parked)) return parked;
  const candidates = controls.flatMap((rect) => [
    { x: parked.x, y: rect.top - AVATAR_HEIGHT - PARKING_GAP },
    { x: parked.x, y: rect.bottom + PARKING_GAP },
    { x: rect.left - AVATAR_WIDTH - PARKING_GAP, y: parked.y },
    { x: rect.right + PARKING_GAP, y: parked.y },
  ]);
  // Keep a manually chosen location if safe; otherwise prefer the nearest clear edge.
  for (let y = 62; y < screen.height - 40; y += AVATAR_HEIGHT + PARKING_GAP) {
    candidates.push(
      { x: MARGIN, y },
      { x: screen.width - AVATAR_WIDTH - MARGIN, y },
    );
  }
  const safe = candidates
    .map((candidate) => clampPosition(candidate, screen))
    .filter(clear)
    .sort(
      (a, b) =>
        Math.hypot(a.x - parked.x, a.y - parked.y) -
        Math.hypot(b.x - parked.x, b.y - parked.y),
    );
  return safe[0] || parked;
}
function readPosition() {
  try {
    const stored = JSON.parse(localStorage.getItem(POSITION_KEY));
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      const screen = screenSize();
      const priorWidth = Number(stored.viewport_width);
      const priorHeight = Number(stored.viewport_height);
      const position =
        priorWidth > 0 && priorHeight > 0
          ? {
              x: stored.x * (screen.width / priorWidth),
              y: stored.y * (screen.height / priorHeight),
            }
          : stored;
      // Legacy x/y-only records are clamped now and checked against mounted controls below.
      return clampPosition(position, screen);
    }
  } catch {
    /* Position storage is optional. */
  }
  return defaultPosition();
}
function storePosition(position) {
  try {
    const screen = screenSize();
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({
        x: position.x,
        y: position.y,
        viewport_width: screen.width,
        viewport_height: screen.height,
      }),
    );
  } catch {
    /* Keep functioning in private browsing. */
  }
}
function safeSourceUrl(value) {
  return typeof value === "string" &&
    (value.startsWith("/api/") || /^https:\/\//i.test(value))
    ? value
    : null;
}
function modelIdentity(message) {
  if (message.request_failed || message.status === "failed")
    return "请求未完成";
  if (message.model_used === false) return "资料检索（未调用模型）";
  if (message.model_used === true) {
    if (message.response_model)
      return [message.model_provider, message.response_model]
        .filter(Boolean)
        .join(" · ");
    return message.requested_model
      ? `模型已调用 · 入口 ${message.requested_model}`
      : "模型已调用";
  }
  return message.response_model
    ? `记录的返回模型：${message.response_model}`
    : "模型调用记录未提供";
}

/** Shared chat state comes from ChatProvider, never from another history/request loop. */
export default function MascotDock({
  onOpenChat,
  onOpenSettings,
  onKnowledge,
}) {
  const { text, setText, msgs, busy, send, ready, selectionBusy } =
    useChatSession();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [preferenceSize, setPreferenceSize] = useState({
    width: 218,
    height: 220,
  });
  const [position, setPosition] = useState(readPosition);
  const [screen, setScreen] = useState(screenSize);
  const [dragging, setDragging] = useState(false);
  const [wave, setWave] = useState(false);
  const positionRef = useRef(position);
  const gesture = useRef(null);
  const animation = useRef(null);
  const pendingPosition = useRef(null);
  const moved = useRef(false);
  const lastReply = useRef(null);
  const scrollArea = useRef(null);
  const input = useRef(null);
  const figureButton = useRef(null);
  const preferenceMenu = useRef(null);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);
  useLayoutEffect(() => {
    if (open || dragging || hidden) return;
    let frame;
    const check = () => {
      const next = clearParking(positionRef.current);
      if (
        next.x !== positionRef.current.x ||
        next.y !== positionRef.current.y
      ) {
        positionRef.current = next;
        setPosition(next);
        storePosition(next);
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        observeComposers();
        check();
      });
    };
    const workspace = document.querySelector("#workspace-content");
    const app = document.querySelector(".workbench-app");
    const observed = new Set();
    const resizeObserver = new ResizeObserver(schedule);
    const observeComposers = () => {
      for (const element of document.querySelectorAll(
        "#workspace-content, #workspace-content .composer, #workspace-content .composer-controls",
      )) {
        if (!observed.has(element)) {
          observed.add(element);
          resizeObserver.observe(element);
        }
      }
      for (const element of observed) {
        if (!element.isConnected) {
          resizeObserver.unobserve(element);
          observed.delete(element);
        }
      }
    };
    const mutations = new MutationObserver(schedule);
    if (workspace)
      mutations.observe(workspace, { childList: true, subtree: true });
    if (app)
      mutations.observe(app, {
        attributes: true,
        attributeFilter: ["data-page"],
      });
    observeComposers();
    check();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [ready, open, dragging, hidden, screen.width, screen.height]);
  useEffect(() => {
    const resize = () => {
      const nextScreen = screenSize();
      setScreen(nextScreen);
      setPosition((current) => {
        const next = clampPosition(current, nextScreen);
        positionRef.current = next;
        return next;
      });
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      if (animation.current) cancelAnimationFrame(animation.current);
    };
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        if (open) figureButton.current?.focus();
        setOpen(false);
        setPreferences(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useLayoutEffect(() => {
    if (!preferences || !preferenceMenu.current) return;
    const rect = preferenceMenu.current.getBoundingClientRect();
    setPreferenceSize((current) =>
      Math.abs(current.width - rect.width) > 0.5 ||
      Math.abs(current.height - rect.height) > 0.5
        ? { width: rect.width, height: rect.height }
        : current,
    );
  }, [preferences, screen.width, screen.height]);
  useEffect(() => {
    if (open && scrollArea.current)
      scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [open, msgs, busy]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (busy) {
      setWave(false);
      return;
    }
    const reply = [...msgs]
      .reverse()
      .find((message) => message.role === "assistant");
    const signature = reply?.id || reply?.text;
    if (!signature || signature === lastReply.current || busy) return;
    lastReply.current = signature;
    if (reply.request_failed) return;
    setWave(true);
    const timer = setTimeout(() => setWave(false), 2400);
    return () => clearTimeout(timer);
  }, [msgs, busy]);

  function pointerDown(event) {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    gesture.current = {
      id: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      start: positionRef.current,
    };
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.originX;
    const dy = event.clientY - current.originY;
    if (!moved.current && Math.hypot(dx, dy) <= 6) return;
    moved.current = true;
    setDragging(true);
    pendingPosition.current = clampPosition({
      x: current.start.x + dx,
      y: current.start.y + dy,
    });
    if (animation.current) return;
    animation.current = requestAnimationFrame(() => {
      animation.current = null;
      positionRef.current = pendingPosition.current;
      setPosition(pendingPosition.current);
    });
  }
  function pointerEnd(event) {
    if (!gesture.current || gesture.current.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (animation.current) {
      cancelAnimationFrame(animation.current);
      animation.current = null;
    }
    if (moved.current && pendingPosition.current) {
      const next = open
        ? pendingPosition.current
        : clearParking(pendingPosition.current);
      positionRef.current = next;
      setPosition(next);
      storePosition(next);
    }
    gesture.current = null;
    setDragging(false);
    if (event.type === "pointercancel") moved.current = false;
  }
  function toggleChat() {
    if (moved.current) {
      moved.current = false;
      return;
    }
    setPreferences(false);
    setOpen((value) => !value);
  }
  function moveByKey(event) {
    const direction = {
      ArrowLeft: [-20, 0],
      ArrowRight: [20, 0],
      ArrowUp: [0, -20],
      ArrowDown: [0, 20],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const requested = clampPosition({
      x: positionRef.current.x + direction[0],
      y: positionRef.current.y + direction[1],
    });
    const next = open ? requested : clearParking(requested);
    positionRef.current = next;
    setPosition(next);
    storePosition(next);
  }
  function openSettings() {
    setOpen(false);
    setPreferences(false);
    onOpenSettings?.();
  }
  function openFullChat() {
    setOpen(false);
    onOpenChat?.();
  }
  function showKnowledge(id) {
    setOpen(false);
    onKnowledge?.(id);
  }
  function resetPosition() {
    const next = defaultPosition();
    positionRef.current = next;
    setPosition(next);
    storePosition(next);
    setPreferences(false);
  }

  const panelWidth = Math.min(420, screen.width - 24);
  const panelHeight = Math.min(550, Math.floor(screen.height * 0.7));
  const panelX = Math.max(
    MARGIN,
    Math.min(
      screen.width - panelWidth - MARGIN,
      position.x + AVATAR_WIDTH - panelWidth,
    ),
  );
  const above = position.y - panelHeight - 8;
  const panelY = Math.max(
    58,
    Math.min(
      screen.height - panelHeight - 37,
      above >= 58 ? above : position.y + AVATAR_HEIGHT + 8,
    ),
  );
  const canSend = ready && !busy && !selectionBusy && !!text.trim();
  const preferenceMaxHeight = Math.max(0, screen.height - MARGIN * 2 - 28);
  const preferenceWidth = Math.min(
    preferenceSize.width,
    Math.max(0, screen.width - MARGIN * 2),
  );
  const preferenceHeight = Math.min(preferenceSize.height, preferenceMaxHeight);
  const preferenceX = Math.max(
    MARGIN,
    Math.min(
      screen.width - preferenceWidth - MARGIN,
      position.x + AVATAR_WIDTH - preferenceWidth,
    ),
  );
  const preferenceAbove = position.y - preferenceHeight - 10;
  const preferenceY = Math.max(
    MARGIN,
    Math.min(
      screen.height - preferenceHeight - 40,
      preferenceAbove >= MARGIN
        ? preferenceAbove
        : position.y + AVATAR_HEIGHT + 10,
    ),
  );

  if (hidden)
    return (
      <button
        className="mascot-restore"
        onClick={() => {
          const next = defaultPosition();
          setHidden(false);
          positionRef.current = next;
          setPosition(next);
          storePosition(next);
        }}
        aria-label="重新显示海洋声学课程助手"
      >
        <BookOpen size={15} />
        课程助手
      </button>
    );

  return (
    <>
      <div
        className={`mascot-dock${dragging ? " is-dragging" : ""}`}
        style={{ left: position.x, top: position.y }}
      >
        <button
          ref={figureButton}
          className="mascot-launcher"
          aria-label={
            open ? "收起海洋声学助手" : "打开海洋声学助手，可拖动或用方向键移动"
          }
          aria-expanded={open}
          aria-controls="ocean-assistant-panel"
          title="点击问答 · 拖动移动 · 方向键调整位置"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          onKeyDown={moveByKey}
          onClick={toggleChat}
        >
          <MascotFigure busy={busy} wave={wave} />
          <span className="mascot-name">
            小航<span>{busy ? "正在处理" : "课程助手"}</span>
          </span>
        </button>
        <button
          className="mascot-position-button"
          aria-label="助手位置与显示设置"
          aria-expanded={preferences}
          aria-controls="ocean-assistant-preferences"
          onClick={() => {
            setOpen(false);
            setPreferences((value) => !value);
          }}
        >
          <Settings2 size={13} />
        </button>
        {preferences && (
          <div
            id="ocean-assistant-preferences"
            ref={preferenceMenu}
            className="mascot-preferences"
            style={{
              left: preferenceX,
              top: preferenceY,
              maxHeight: preferenceMaxHeight,
            }}
          >
            <strong>助手位置与显示</strong>
            <button onClick={resetPosition}>
              <RotateCcw size={13} />
              回到默认位置
            </button>
            <button
              onClick={() => {
                setHidden(true);
                setOpen(false);
                setPreferences(false);
              }}
            >
              <Minus size={13} />
              收起人物
            </button>
            <button onClick={openSettings}>
              <Settings2 size={13} />
              模型连接设置
            </button>
            <small>原创课程形象，可拖动；不是官方吉祥物。</small>
          </div>
        )}
      </div>
      {open && (
        <section
          id="ocean-assistant-panel"
          className="mascot-chat-panel"
          role="dialog"
          aria-label="海洋声学助手快捷问答"
          aria-modal="false"
          style={{
            left: panelX,
            top: panelY,
            width: panelWidth,
            height: panelHeight,
          }}
        >
          <div className="mascot-chat-heading">
            <div>
              <span className="mascot-heading-icon">
                <BookOpen size={17} />
              </span>
              <div>
                <strong>海洋声学助手</strong>
                <span>与知识问答共享同一对话</span>
              </div>
            </div>
            <div>
              <button
                aria-label="收起快捷问答"
                title="收起快捷问答"
                onClick={() => {
                  setOpen(false);
                  figureButton.current?.focus();
                }}
              >
                <X size={17} />
              </button>
            </div>
          </div>
          <div
            className="mascot-chat-messages"
            ref={scrollArea}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {!msgs.length && (
              <div className="mascot-chat-empty">
                <h3>想探索哪片海洋知识？</h3>
                <p>
                  查看原理与出处，或分析课程代码。页面和快捷窗口使用同一份对话。
                </p>
                <button onClick={() => setText("声源深度如何影响模态激发？")}>
                  声源深度如何影响模态激发？
                </button>
                <button
                  onClick={() => setText("海洋酸化为什么会影响珊瑚生长？")}
                >
                  海洋酸化为什么会影响珊瑚生长？
                </button>
              </div>
            )}
            {msgs.slice(-8).map((message, index) => (
              <div
                key={message.id || `${msgs.length - 8 + index}-${message.role}`}
                className={`mascot-message ${message.role}${message.request_failed ? " request-failed" : ""}`}
              >
                <div className="mascot-message-label">
                  <span>
                    {message.role === "user"
                      ? "你"
                      : message.request_failed
                        ? "请求未完成"
                        : "课程助手"}
                  </span>
                </div>
                <p>{message.text}</p>
                {message.role === "assistant" && (
                  <details className="mascot-message-trace">
                    <summary>
                      回答详情
                      {message.citations?.length
                        ? ` · ${message.citations.length} 条依据`
                        : ""}
                    </summary>
                    <p>{modelIdentity(message)}</p>
                    {message.coverage_notice && (
                      <small className="mascot-coverage-note">
                        {message.coverage_notice}
                      </small>
                    )}
                    <CompactSources
                      message={message}
                      onKnowledge={showKnowledge}
                    />
                  </details>
                )}
              </div>
            ))}
            {busy && (
              <div className="mascot-thinking">
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                正在处理问题…
              </div>
            )}
          </div>
          <form
            className="mascot-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSend) send();
            }}
          >
            <textarea
              ref={input}
              aria-label="快捷问答输入问题"
              placeholder="输入问题；Shift + Enter 换行"
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
              compact
              onOpenSettings={openSettings}
              onOpenChat={openFullChat}
              onKnowledge={showKnowledge}
              onSend={send}
            />
          </form>
        </section>
      )}
    </>
  );
}

function CompactSources({ message, onKnowledge }) {
  const citations = message.citations?.length
    ? message.citations
    : message.evidence || [];
  if (!citations.length) return null;
  return (
    <div className="mascot-answer-sources">
      {citations.slice(0, 4).map((citation, index) => {
        const evidenceId =
          citation.evidence_id || citation.id || citation.citation_id;
        const evidence =
          (evidenceId &&
            message.evidence?.find(
              (item) =>
                item.id === evidenceId || item.evidence_id === evidenceId,
            )) ||
          citation;
        const nodeId = citation.node_id || evidence.node_id;
        const url = safeSourceUrl(
          citation.url ||
            citation.source_url ||
            (citation.source_id && citation.pdf_page
              ? `/api/source/${citation.source_id}/page/${citation.pdf_page}`
              : null),
        );
        return (
          <div key={evidenceId || index}>
            <strong>
              {citation.label ||
                evidence.label ||
                citation.source_id ||
                "课程依据"}
            </strong>
            <small>
              {[
                citation.source_id,
                citation.pdf_page
                  ? `PDF 第 ${citation.pdf_page} 页`
                  : citation.locator,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
            <div>
              {nodeId && (
                <button onClick={() => onKnowledge(nodeId)}>
                  <Network size={12} />
                  知识点
                </button>
              )}
              {url && (
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} />
                  原始来源
                </a>
              )}
            </div>
          </div>
        );
      })}
      {citations.length > 4 && <small>完整依据可进入知识问答查看。</small>}
    </div>
  );
}
