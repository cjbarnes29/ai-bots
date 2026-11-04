import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useConversations, useMessages, useSendChat } from "../api/hooks";
import type { Bot } from "../api/types";

const MAX_MESSAGE_CHARS = 8000;

interface Props {
  bot: Bot;
  /** True when the Details tab has unsaved edits (chat uses the SAVED bot). */
  hasUnsavedEdits: boolean;
}

export function ChatTab({ bot, hasUnsavedEdits }: Props) {
  const conversations = useConversations(bot.id);
  const [activeId, setActiveId] = useState<string | null>(null);
  const messages = useMessages(bot.id, activeId);
  const send = useSendChat(bot.id);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const cannotChat =
    bot.archived
      ? "This bot is archived. Unarchive it to chat."
      : bot.runtime === "openclaw"
        ? "This bot uses the OpenClaw runtime, which is not installed. Switch it to the built-in engine on the Details tab."
        : bot.model === null
          ? "Choose a model for this bot on the Details tab first."
          : null;

  const submit = () => {
    const message = text.trim();
    if (!message || cannotChat || send.isPending) return;
    setWarning(null);
    setPending(message);
    send.mutate(
      { message, conversationId: activeId },
      {
        onSuccess: (reply) => {
          setActiveId(reply.conversationId);
          setText("");
          setWarning(reply.warning);
        },
        onSettled: () => setPending(null),
      },
    );
  };

  const error = send.error instanceof ApiError ? send.error.friendly : send.error ? "The message could not be sent." : null;
  const shown = messages.data ?? [];

  return (
    <div role="tabpanel" aria-label="Chat" className="space-y-4">
      <div className="rounded-md bg-slate-200 p-3 text-sm dark:bg-slate-800">
        <p>
          <strong>Test chat.</strong> {bot.name} only replies when you send a message. It has no tools and can't take any action.
        </p>
        <p className="mt-1 text-slate-600 dark:text-slate-400">
          Uses the saved bot (version {bot.currentVersion}) with model{" "}
          {bot.model ? <code>{bot.model}</code> : <em>none chosen</em>}. Messages go to the model provider, and free tiers may
          store them, so don't type anything private.
        </p>
        {hasUnsavedEdits && (
          <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
            You have unsaved edits on the Details tab. Save them for the chat to use them.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="conversation" className="text-sm font-medium">
          Conversation
        </label>
        <select
          id="conversation"
          className="max-w-xs"
          value={activeId ?? ""}
          onChange={(e) => {
            setActiveId(e.target.value === "" ? null : e.target.value);
            setWarning(null);
            send.reset();
          }}
        >
          <option value="">New conversation</option>
          {(conversations.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({c.messageCount})
            </option>
          ))}
        </select>
        {activeId && (
          <button type="button" className="btn-secondary" onClick={() => setActiveId(null)}>
            Start a new conversation
          </button>
        )}
      </div>

      <div className="card min-h-40 space-y-3" aria-label="Messages" aria-live="polite">
        {activeId === null && !pending && <p className="text-sm text-slate-600 dark:text-slate-400">Say hello to start the conversation.</p>}
        {activeId !== null && messages.isPending && <p role="status">Loading messages…</p>}
        {shown.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
            <p className="text-xs font-semibold text-slate-500">{m.role === "user" ? "You" : bot.name}</p>
            <p
              className={`inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-left text-sm ${
                m.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800"
              }`}
            >
              {m.content}
            </p>
            {m.role === "assistant" && m.inputTokens !== null && (
              <p className="mt-1 text-xs text-slate-500">
                {m.providerId}/{m.modelId} · {m.inputTokens} tokens in, {m.outputTokens} out
                {m.tokensEstimated ? " (estimated)" : ""} · version {m.botVersion}
              </p>
            )}
          </div>
        ))}
        {pending && (
          <div className="text-right">
            <p className="text-xs font-semibold text-slate-500">You</p>
            <p className="inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-indigo-600 px-3 py-2 text-left text-sm text-white">
              {pending}
            </p>
            <p role="status" className="mt-2 text-left text-sm text-slate-500">
              {bot.name} is thinking…
            </p>
          </div>
        )}
      </div>

      {warning && (
        <p role="alert" className="rounded-md bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {warning}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}{" "}
          {error.includes("Settings") && (
            <Link to="/settings/ai-models" className="underline">
              Open Settings
            </Link>
          )}
        </p>
      )}
      {cannotChat && (
        <p role="status" className="rounded-md bg-slate-200 p-3 text-sm dark:bg-slate-800">
          {cannotChat}
        </p>
      )}

      <div>
        <label htmlFor="chat-input" className="label">
          Your message
        </label>
        <textarea
          id="chat-input"
          rows={3}
          value={text}
          maxLength={MAX_MESSAGE_CHARS}
          disabled={cannotChat !== null}
          placeholder="Type a message. Press Ctrl+Enter to send."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="hint">
            {text.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()} characters
          </p>
          <button type="button" className="btn-primary" onClick={submit} disabled={!text.trim() || cannotChat !== null || send.isPending}>
            {send.isPending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
