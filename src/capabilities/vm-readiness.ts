import type { Capability } from "./registry.js";

/**
 * Desktop agent and VMware READINESS (M9). A read-only checklist of what stands between today's supervised desktop engine and an isolated virtual machine.
 * It builds, installs, creates and changes NOTHING: every step that would is marked as needing the owner's separate approval (CLAUDE.md 5b, D-026, D-036, D-043).
 * "met" needs evidence; anything nobody has verified is "not done" or "unknown", never "met".
 */
export type ReadyState = "met" | "not_done" | "unknown";
export interface ReadinessStep {
  id: string;
  title: string;
  state: ReadyState;
  evidence: string;
  /** Doing this needs the owner's separate explicit approval (administrator, account, VM, install, firewall, security boundary). */
  needsOwnerApproval: boolean;
  /** Where the prepared, review-only material is. */
  where: string;
}
export interface VmReadiness {
  ready: false;
  summary: string;
  steps: ReadinessStep[];
  /** Sizing suggestion from the host's real resources. Advice only. */
  sizing: { hostRamGb: number; hostCpuThreads: number; vmRamGb: number; vmCpus: number; note: string };
  /** What the owner would have to approve, in order (D-040). */
  approvalOrder: string[];
}

export interface VmInputs {
  ramGb: number;
  cpuThreads: number;
  /** Did a read-only look at the usual install folders find VMware Workstation? null = not looked. */
  vmwareFound: boolean | null;
  caps: Capability[];
}

export function vmReadiness(i: VmInputs): VmReadiness {
  const cap = (id: string) => i.caps.find((c) => c.id === id);
  const guardian = cap("env-guardian");
  const desktop = cap("env-desktop-engine");
  // Keep at least 8 GB and half the threads for the owner's own PC; the guest gets what is left, capped small.
  const vmRam = Math.max(0, Math.min(8, Math.floor(i.ramGb - 8)));
  const vmCpus = Math.max(1, Math.min(4, Math.floor(i.cpuThreads / 2) - 1));
  const roomOk = i.ramGb >= 12 && i.cpuThreads >= 4;
  const steps: ReadinessStep[] = [
    { id: "host", title: "The PC has room for a guest without starving your own work", state: roomOk ? "met" : "not_done", evidence: `${i.ramGb} GB memory, ${i.cpuThreads} threads (needs about 12 GB and 4 threads).`, needsOwnerApproval: false, where: "docs/TIER-B-PLAN.md" },
    { id: "guardian-a", title: "Guardian Tier A running (supervised use)", state: guardian?.levels.operational.state === "yes" ? "met" : "not_done", evidence: guardian?.stateReason ?? "Not reported.", needsOwnerApproval: false, where: "docs/GUARDIAN.md section 8" },
    { id: "guardian-a-verified", title: "Guardian lock and idle pauses checked on this PC (NV-8)", state: guardian?.levels.verified.state === "yes" ? "met" : "not_done", evidence: guardian?.levels.verified.evidence ?? "Not reported.", needsOwnerApproval: false, where: "docs/GUARDIAN.md section 11 (your own checks)" },
    { id: "firewall-audit", title: "Elevated read-only firewall audit A0-A13 run and shared (NV-10)", state: "not_done", evidence: "The script is prepared and parse-checked; it has not been run.", needsOwnerApproval: true, where: "scripts/security/firewall-audit.ps1, docs/SECURITY-AUDIT.md section 1" },
    { id: "vmware", title: "VMware Workstation present", state: i.vmwareFound === null ? "unknown" : i.vmwareFound ? "met" : "not_done", evidence: i.vmwareFound === null ? "Not looked for." : i.vmwareFound ? "Found in a usual install folder (a file-exists check only; nothing was started or opened)." : "Not found in the usual install folders.", needsOwnerApproval: false, where: "docs/SECURITY-AUDIT.md (VMware exposure)" },
    { id: "image-licence", title: "Licence terms of the free Windows evaluation image read and approved (NV-7)", state: "not_done", evidence: "No image is chosen and the terms have not been read.", needsOwnerApproval: true, where: "docs/DECISION-BOARD.md NV-7" },
    { id: "account", title: "Dedicated standard Windows account (D-036 option A)", state: "not_done", evidence: "Not created. Account creation needs your approval.", needsOwnerApproval: true, where: "scripts/security/tier-b/01-create-ai-account.ps1 (review only)" },
    { id: "firewall-rules", title: "Fixed-name AWP-* firewall rules and host-to-VM restrictions", state: "not_done", evidence: "Not applied. The script is review-only and dry-run by default.", needsOwnerApproval: true, where: "scripts/security/tier-b/02-firewall-rules.ps1" },
    { id: "tier-b", title: "Guardian Tier B built, installed and its drills passed (NV-9)", state: "not_done", evidence: "NOT BUILT. Required before anything runs unattended.", needsOwnerApproval: true, where: "docs/TIER-B-PLAN.md, scripts/security/tier-b/03-install-guardian.ps1" },
    { id: "vm", title: "Isolated VM created and configured", state: "not_done", evidence: "No VM exists. Creating or configuring one needs your approval.", needsOwnerApproval: true, where: "docs/TIER-B-PLAN.md" },
    { id: "in-guest", title: "In-guest connectivity test showing what the guest can reach", state: "not_done", evidence: "Cannot run before the VM and rules exist.", needsOwnerApproval: true, where: "docs/SECURITY-AUDIT.md" },
    { id: "desktop-real", title: "Desktop engine verified beyond the disposable test windows (NV-14)", state: desktop?.levels.verified.state === "yes" ? "met" : "not_done", evidence: desktop?.levels.verified.evidence ?? "Not reported.", needsOwnerApproval: true, where: "docs/DESKTOP-ENGINE.md (owner-approved trials on disposable data, one program at a time)" },
  ];
  const open = steps.filter((s) => s.state !== "met").length;
  return {
    ready: false,
    summary: `Not ready: ${open} of ${steps.length} steps are not done or not known. Nothing about a VM has been created or changed. Everything stays supervised.`,
    steps,
    sizing: { hostRamGb: i.ramGb, hostCpuThreads: i.cpuThreads, vmRamGb: vmRam, vmCpus, note: vmRam >= 4 ? `A guest with about ${vmRam} GB and ${vmCpus} CPUs would leave your own PC at least 8 GB.` : "There is not enough spare memory for a guest that leaves your own PC 8 GB." },
    approvalOrder: ["1 Run the elevated firewall audit and share the output", "2 Review UltraViewer/UltraVNC and the Public any-port rules", "3 Host-to-VM restrictions (firewall rules)", "4 NetBIOS and file sharing on the VMware adapters", "5 MetaTrader / VMware Authd review", "6 Licence check for the evaluation image, then the dedicated account, the VM and the in-guest test", "7 Build and verify Guardian Tier B (before any unattended work)"],
  };
}
