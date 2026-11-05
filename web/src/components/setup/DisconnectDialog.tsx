import { useDeleteSecret } from "../../api/hooks";
import type { ServiceGuide } from "../../lib/serviceGuides";
import { ConfirmDialog } from "../ConfirmDialog";

/** Asks first, then deletes this integration's OWN saved values from the vault (never another integration's shared ones). */
export function DisconnectDialog({ guide, names, onClose }: { guide: ServiceGuide; names: string[]; onClose: () => void }) {
  const del = useDeleteSecret();
  return (
    <ConfirmDialog
      title={`Disconnect ${guide.name}?`}
      confirmLabel="Disconnect"
      danger
      busy={del.isPending}
      onCancel={onClose}
      onConfirm={() =>
        void (async () => {
          for (const n of names) await del.mutateAsync(n);
          onClose();
        })().catch(() => undefined)
      }
    >
      <p>{guide.disconnect.note}</p>
      <p className="hint">Bots lose access straight away. You can connect it again at any time.</p>
      {del.error ? <p role="alert">Could not remove it. Try again.</p> : null}
    </ConfirmDialog>
  );
}
