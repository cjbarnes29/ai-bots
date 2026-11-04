import { useBots } from "../api/hooks";
import { WorkflowsSection } from "../components/WorkflowsSection";

/** Workflow Studio. The editor and run controls are the existing ones; they now have their own place instead of living inside Automation. */
export function Workflows() {
  const bots = useBots(false);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Workflow Studio</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Build a chain of steps your agents follow. A new workflow starts switched off; nothing runs until you turn it on or press Run.
      </p>
      <WorkflowsSection bots={bots.data ?? []} />
    </div>
  );
}
