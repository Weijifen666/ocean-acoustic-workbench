import React from "react";
import { Loader2, Plus, RotateCcw } from "lucide-react";
import { useChatSession } from "./chat-session";

export default function ConversationPicker() {
  const {
    conversations,
    conversationId,
    conversationsSupported,
    conversationBusy,
    conversationError,
    selectConversation,
    createConversation,
    busy,
  } = useChatSession();
  if (!conversationsSupported) return null;
  return (
    <div className="conversation-picker">
      <select
        aria-label="切换研究会话"
        value={conversationId || ""}
        disabled={busy || conversationBusy}
        onChange={(event) => void selectConversation(event.target.value)}
      >
        {!conversations.length && <option value="">新会话</option>}
        {conversations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title || "未命名会话"}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || conversationBusy}
        title="新建会话"
        aria-label="新建会话"
        onClick={() => void createConversation()}
      >
        {conversationBusy ? (
          <Loader2 size={15} className="spin" />
        ) : (
          <Plus size={15} />
        )}
      </button>
      {conversationError && (
        <button
          className="conversation-retry"
          onClick={() => void selectConversation(conversationId)}
          title={conversationError}
          aria-label="重新载入当前会话"
        >
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
}
