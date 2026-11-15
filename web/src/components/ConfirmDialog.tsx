import { useEffect, useId, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A simple modal. Render it only while it should be visible. Escape cancels. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // An owner-proof or other modal may open above this confirmation. Its keyboard policy takes precedence.
      const activeModal = document.activeElement?.closest('[role="dialog"][aria-modal="true"]');
      if (activeModal && activeModal !== dialogRef.current) return;
      if (e.key === "Escape") { e.preventDefault(); onCancelRef.current(); }
      if (e.key === "Tab") {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []).filter(el => !el.hidden && el.getAttribute("aria-hidden") !== "true");
        const first = controls[0], last = controls.at(-1);
        if (!first) { e.preventDefault(); dialogRef.current?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); if (opener?.isConnected) opener.focus(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        className="card flex max-h-[calc(100dvh-2rem)] min-w-0 w-full max-w-md flex-col gap-3 shadow-xl"
      >
        <h2 id={titleId} className="shrink-0 text-lg font-semibold [overflow-wrap:anywhere]">
          {title}
        </h2>
        <div className="min-h-0 overflow-auto space-y-2 text-sm text-slate-600 dark:text-slate-300 [overflow-wrap:anywhere]">{children}</div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 pt-2">
          <button ref={cancelRef} type="button" className="btn-secondary min-h-11" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`${danger ? "btn-danger" : "btn-primary"} min-h-11`} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
