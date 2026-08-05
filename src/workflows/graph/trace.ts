/* Mutable per-execution trace collector. Produces a WorkflowTrace conforming to
   the Zod contract. Pure (schemas + local). */

import type { NodeStatus, NodeTrace, WorkflowTrace } from "@/schemas/workflow";
import type { CostCategory } from "@/schemas/workflow";

interface MutableNodeTrace {
  id: string;
  status: NodeStatus;
  attempts: number;
  startedAt: number;
  completedAt: number;
  warnings: string[];
  errorCode?: string;
  cost: CostCategory;
  cacheStatus?: "hit" | "miss" | "stale" | "bypass";
  apiCalls: number;
  simulationCount: number;
}

export class TraceCollector {
  private nodes: MutableNodeTrace[] = [];
  private warnings: string[] = [];
  readonly startedAt = Date.now();

  constructor(
    readonly workflowId: string,
    readonly executionId: string,
    private readonly subject: { gameId?: number; playerId?: number; marketId?: string } = {},
  ) {}

  startNode(id: string, cost: CostCategory): MutableNodeTrace {
    const n: MutableNodeTrace = {
      id, status: "ok", attempts: 0, startedAt: Date.now(), completedAt: Date.now(),
      warnings: [], cost, apiCalls: 0, simulationCount: 0,
    };
    this.nodes.push(n);
    return n;
  }

  addWarning(msg: string) {
    this.warnings.push(msg);
  }

  finish(status: WorkflowTrace["status"]): WorkflowTrace {
    const completedAt = Date.now();
    const nodes: NodeTrace[] = this.nodes.map((n) => ({
      id: n.id,
      status: n.status,
      attempts: n.attempts,
      startedAt: n.startedAt,
      completedAt: n.completedAt,
      durationMs: Math.max(0, n.completedAt - n.startedAt),
      warnings: n.warnings,
      errorCode: n.errorCode,
      cost: n.cost,
      cacheStatus: n.cacheStatus,
      apiCalls: n.apiCalls,
      simulationCount: n.simulationCount,
    }));
    return {
      workflowId: this.workflowId,
      executionId: this.executionId,
      status,
      gameId: this.subject.gameId,
      playerId: this.subject.playerId,
      marketId: this.subject.marketId,
      startedAt: this.startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - this.startedAt),
      nodes,
      warnings: this.warnings,
    };
  }
}
