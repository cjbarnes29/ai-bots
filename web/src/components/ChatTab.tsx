import { useId, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { ContextLinks } from "./hub/ContextLinks";
import { ApiError } from "../api/client";
import { useConversations, useMessages, useSendChat } from "../api/hooks";
import { useConversationAttachments, useConversationSources } from "../api/knowledgeHooks";
import type { Bot } from "../api/types";
import { AttachButton, MessageAttachments, MessageSources, RetentionPicker, StagedList, useStaging } from "./chat/Attachments";

const MAX_MESSAGE_CHARS = 8000;

interface Props {
  bot: Bot;
  /** True when the Details tab has unsaved edits (chat uses the SAVED bot). */
  hasUnsavedEdits: boolean;
  /** Open this conversation first (the page that shows the chat decides, not this component). */
  initialConversationId?: string | null;
  /** A NEW conversation started here is filed under this project. */
  projectId?: string | null;
  /** Told whenever the open conversation changes (the chat drawer uses it to offer "open in full"). */
  onConversation?: (id: string | null) => void;
  /** Smaller: leaves out the long explanation (the drawer). */
  compact?: boolean;
  /** A taller message area (the AI Assistant workspace). */
  large?: boolean;
  /** Keep the unsent draft in this browser tab under this name, so it survives moving to another page. */
  draftKey?: string;
  /**
   * Called with the text before it is sent to the model. Returns true when the request was handled here (a lookup or an edit), so nothing is sent;
   * a string means "send this text instead" (for example with a prefix removed).
   * Not called when files are attached: then the owner wants the model to read them.
   */
  beforeSend?: (message: string) => Promise<boolean | string>;
}

export function ChatTab({ bot, hasUnsavedEdits, initialConversationId = null, projectId = null, onConversation, compact = false, large = false, draftKey, beforeSend }: Props) {
  const uid = useId(); // unique per chat, so the drawer and an agent page can both be mounted
  const conversations = useConversations(bot.id);
  const [activeId, setActiveIdRaw] = useState<string | null>(initialConversationId);
  const setActiveId = (id: string | null) => {
    setActiveIdRaw(id);
    onConversation?.(id);
  };
  const messages = useMessages(bot.id, activeId);
  const send = useSendChat(bot.id);
  const [text, setTextRaw] = useState(() => {
    try {
      return (draftKey && sessionStorage.getItem(draftKey)) || "";
    } catch {
      return "";
    }
  });
  const setText = (v: string) => {
    setTextRaw(v);
    if (!draftKey) return;
    try {
      if (v) sessionStorage.setItem(draftKey, v);
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  };
  const staging = useStaging(projectId);
  const [useKnowledge, setUseKnowledge] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [checking, setChecking] = useState(false);
  const attachments = useConversationAttachments(bot.id, activeId);
  const sources = useConversationSources(bot.id, activeId);
  const [pending, setPending] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const cannotChat =
    bot.archived
      ? "This bot is archived. Unarchive it to chat."
      : bot.runtime === "openclaw"
        ? "This bot uses the OpenClaw runtime, which is not installed. Switch it to the built-in engine on the Details tab."
        : bot.model === null
          ? "Choose a model for this bot on the Details tab first."
          : bot.status !== "active"
            ? `This bot is ${bot.status === "paused" ? "paused" : "switched off"}. Set its Status (top right) to Active to chat with it.`
            : null;

  const submit = async () => {
    let message = text.trim();
    if (!message || cannotChat || send.isPending || staging.uploading || checking) return;
    setWarning(null);
    if (beforeSend && staging.ids.length === 0) {
      setChecking(true);
      let handled: boolean | string = false;
      try {
        handled = await beforeSend(message);
      } catch {
        handled = false; // a failed lookup never blocks ordinary chat
      } finally {
        setChecking(false);
      }
      if (typeof handled === "string") message = handled;
      if (handled === true) {
        setText("");
        return;
      }
    }
    setPending(message);
    send.mutate(
      { message, conversationId: activeId, projectId: activeId ? null : projectId, attachmentIds: staging.ids, useKnowledge },
      {
        onSuccess: (reply) => {
          setActiveId(reply.conversationId);
          setText("");
          staging.clear();
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
      {activeId && <ContextLinks kind="conversation" id={activeId} />}
      <div className="rounded-md bg-slate-200 p-3 text-sm dark:bg-slate-800">
        <p>
          <strong>Test chat.</strong> {bot.name} only replies when you send a message. It has no tools and can't take any action.
        </p>
        <div hidden={compact}>
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
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={`${uid}-conv`} className="text-sm font-medium">
          Conversation
        </label>
        <select
          id={`${uid}-conv`}
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

      <div className={`card space-y-3 ${large ? "min-h-[45vh] max-h-[60vh] overflow-y-auto" : "min-h-40"}`} aria-label="Messages" aria-live="polite">
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
            {m.role === "user" && <MessageAttachments items={(attachments.data ?? []).filter((a) => a.messageId === m.id)} />}
            {m.role === "assistant" && <MessageSources items={sources.data?.[String(m.id)] ?? []} />}
            {m.role === "assistant" && m.inputTokens !== null && (
              <p className="mt-1 text-xs text-slate-500">
                {m.providerId === "demo" && <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">Simulated</span>}
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

      <div
        onDragOver={(e: DragEvent) => {
          if (cannotChat === null) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDragging(false);
          if (cannotChat === null && e.dataTransfer.files.length) staging.add(e.dataTransfer.files);
        }}
        className={`space-y-2 rounded-lg ${dragging ? "outline-dashed outline-2 outline-indigo-500" : ""}`}
        aria-label="Message composer"
      >
        {dragging && <p role="status" className="text-center text-sm font-medium text-indigo-700 dark:text-indigo-300">Drop files to attach them</p>}
        <StagedList staged={staging.staged} onRemove={staging.remove} />
        {staging.staged.length > 0 && <RetentionPicker value={staging.retention} onChange={staging.setRetention} />}
        <label htmlFor={`${uid}-input`} className="label">
          Your message
        </label>
        <textarea
          id={`${uid}-input`}
          rows={3}
          value={text}
          maxLength={MAX_MESSAGE_CHARS}
          disabled={cannotChat !== null}
          placeholder="Type a message. Press Ctrl+Enter to send."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <AttachButton onFiles={staging.add} disabled={cannotChat !== null} />
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={useKnowledge} onChange={(e) => setUseKnowledge(e.target.checked)} /> Use the Knowledge Center
          </label>
          {staging.staged.length === 0 && <details className="text-sm"><summary className="min-h-11 cursor-pointer leading-[2.75rem]">Where files are kept</summary><RetentionPicker value={staging.retention} onChange={staging.setRetention} /></details>}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="hint">
            {text.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()} characters
          </p>
          <button type="button" className="btn-primary" onClick={() => void submit()} disabled={!text.trim() || cannotChat !== null || send.isPending || staging.uploading || checking}>
            {send.isPending ? "Sending…" : staging.uploading ? "Uploading…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
