import type { ReactNode } from "react";
import { useSession } from "../api/hooks";
import { PairScreen } from "./PairScreen";

/** On a phone that is not paired, show only the pairing screen. On the PC (and on a paired phone) show the dashboard. */
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session.isPending) return <p role="status" className="p-6">Loading…</p>;
  if (session.data && session.data.mode === "remote" && session.data.paired === false) return <PairScreen />;
  return <>{children}</>;
}
