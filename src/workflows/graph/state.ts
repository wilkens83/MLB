/* Shared execution state — node outputs + statuses during a run. Pure. */

import type { NodeStatus } from "@/schemas/workflow";

export type RunStatus = "pending" | "running" | NodeStatus;

export class ExecutionState {
  readonly outputs = new Map<string, unknown>();
  readonly status = new Map<string, RunStatus>();

  constructor(nodeIds: string[], initialInputs: Record<string, unknown>) {
    for (const id of nodeIds) this.status.set(id, "pending");
    for (const [k, v] of Object.entries(initialInputs)) this.outputs.set(k, v);
  }

  /** A dependency is "usable" (produces input) when it ended ok or degraded. */
  usable(id: string): boolean {
    const s = this.status.get(id);
    return s === "ok" || s === "degraded";
  }

  /** Terminal = will never change again. */
  terminal(id: string): boolean {
    const s = this.status.get(id);
    return s === "ok" || s === "degraded" || s === "skipped" || s === "failed" || s === "timeout" || s === "cancelled";
  }

  /** Snapshot of currently-available named outputs (resolved deps only). */
  inputsView(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(this.outputs.entries());
  }
}
