/* Execution budget tracker — caps wall-clock, node count, and external API
   calls, and exposes the concurrency limit. Pure. */

import type { ExecutionBudget } from "./types";

export class BudgetTracker {
  private nodesRun = 0;
  private apiCalls = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly budget: ExecutionBudget) {}

  get maxConcurrency(): number {
    return this.budget.maxConcurrency;
  }

  countNode(): void {
    this.nodesRun++;
  }
  countApiCalls(n: number): void {
    this.apiCalls += n;
  }

  /** Returns a reason string when the budget is exceeded, else null. */
  exceeded(): string | null {
    if (Date.now() - this.startedAt > this.budget.maxWallClockMs) {
      return `wall-clock > ${this.budget.maxWallClockMs}ms`;
    }
    if (this.nodesRun >= this.budget.maxNodes) {
      return `node count >= ${this.budget.maxNodes}`;
    }
    if (this.apiCalls > this.budget.maxExternalApiCalls) {
      return `external API calls > ${this.budget.maxExternalApiCalls}`;
    }
    return null;
  }
}
