import React, {useRef, useEffect} from 'react';
import {Waves, ArrowUpRight, Loader2} from 'lucide-react';
import {useChatSession} from './chat-session';
import ConversationPicker from './ConversationPicker';
import ChatComposerControls from './ChatComposerControls';
import RichMessage from './RichMessage';
import {guideImage} from './OceanProfile';
export default function CourseChat({ openSettings, onKnowledge, onSimulation }) {
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
