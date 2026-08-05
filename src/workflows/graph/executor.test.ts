import { test, expect, describe } from "bun:test";
import { z } from "zod";
import { defineNode } from "./node";
import { runWorkflow, type Workflow } from "./executor";
import { ok, err } from "./result";
import { externalApiError, modelError } from "./errors";

/** A trivial cpu node that returns a constant, recording nothing external. */
function constNode(id: string, value: unknown, dependsOn: string[] = []) {
  return defineNode({
    id, description: id, dependsOn,
    inputSchema: z.any(), outputSchema: z.any(),
    selectInput: (i) => i, run: async () => ok(value),
  });
}

describe("executor — ordering & fan-in", () => {
  test("runs nodes in dependency order and threads outputs", async () => {
    const a = constNode("a", 1);
    const b = defineNode({
      id: "b", description: "b", dependsOn: ["a"],
      inputSchema: z.object({ a: z.number() }), outputSchema: z.number(),
      selectInput: (i) => ({ a: i.a as number }),
      run: async (i) => ok(i.a + 10),
    });
    const wf: Workflow = { id: "t", output: "b", nodes: [a, b] };
    const { result, trace } = await runWorkflow<number>(wf);
    expect(result.ok && result.value).toBe(11);
    expect(trace.status).toBe("ok");
    expect(trace.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  test("fan-out then fan-in: two parallel nodes merge into one", async () => {
    const a = constNode("a", 2);
    const b = constNode("b", 3);
    const sum = defineNode({
      id: "sum", description: "sum", dependsOn: ["a", "b"],
      inputSchema: z.object({ a: z.number(), b: z.number() }), outputSchema: z.number(),
      selectInput: (i) => ({ a: i.a as number, b: i.b as number }),
      run: async (i) => ok(i.a + i.b),
    });
    const { result } = await runWorkflow<number>({ id: "t", output: "sum", nodes: [a, b, sum] });
    expect(result.ok && result.value).toBe(5);
  });
});

describe("executor — conditional routing (guards)", () => {
  test("a node whose guard is false is skipped; dependents cascade-skip", async () => {
    const a = constNode("a", 1);
    const gated = defineNode({
      id: "gated", description: "gated", dependsOn: ["a"],
      inputSchema: z.any(), outputSchema: z.any(),
      guard: () => false,
      selectInput: (i) => i, run: async () => ok("should not run"),
    });
    const dep = constNode("dep", "x", ["gated"]);
    const { result, trace } = await runWorkflow({ id: "t", output: "dep", nodes: [a, gated, dep] });
    expect(result.ok).toBe(false); // output node cascade-skipped → no usable value
    expect(trace.nodes.find((n) => n.id === "gated")?.status).toBe("skipped");
    expect(trace.nodes.find((n) => n.id === "dep")?.status).toBe("skipped");
  });
});

describe("executor — retry & timeout", () => {
  test("retries a retryable failure then succeeds", async () => {
    let attempts = 0;
    const flaky = defineNode({
      id: "flaky", description: "flaky",
      inputSchema: z.any(), outputSchema: z.number(),
      retry: { maxAttempts: 3, backoffMs: 1, factor: 1 },
      selectInput: (i) => i,
      run: async () => { attempts++; return attempts < 3 ? err(externalApiError("try again")) : ok(42); },
    });
    const { result, trace } = await runWorkflow<number>({ id: "t", output: "flaky", nodes: [flaky] });
    expect(result.ok && result.value).toBe(42);
    expect(attempts).toBe(3);
    expect(trace.nodes[0].attempts).toBe(3);
  });

  test("a non-retryable failure is not retried and fails fast", async () => {
    let attempts = 0;
    const hard = defineNode({
      id: "hard", description: "hard",
      inputSchema: z.any(), outputSchema: z.any(),
      retry: { maxAttempts: 3, backoffMs: 1, factor: 1 },
      selectInput: (i) => i,
      run: async () => { attempts++; return err(modelError("nope")); },
    });
    const { result } = await runWorkflow({ id: "t", output: "hard", nodes: [hard] });
    expect(result.ok).toBe(false);
    expect(attempts).toBe(1);
  });

  test("a node exceeding its timeout yields a timeout status", async () => {
    const slow = defineNode({
      id: "slow", description: "slow", timeoutMs: 20,
      inputSchema: z.any(), outputSchema: z.any(),
      selectInput: (i) => i,
      run: async () => { await new Promise((r) => setTimeout(r, 200)); return ok("late"); },
    });
    const { result, trace } = await runWorkflow({ id: "t", output: "slow", nodes: [slow] });
    expect(result.ok).toBe(false);
    expect(trace.nodes[0].status).toBe("timeout");
  });
});

describe("executor — failure policies", () => {
  test("skip-with-warning continues; the run degrades to a warning", async () => {
    const optional = defineNode({
      id: "optional", description: "optional", failurePolicy: "skip-with-warning",
      inputSchema: z.any(), outputSchema: z.any(),
      selectInput: (i) => i, run: async () => err(externalApiError("weather down")),
    });
    const main = constNode("main", "ok"); // independent
    const { result, trace } = await runWorkflow({ id: "t", output: "main", nodes: [optional, main] });
    expect(result.ok).toBe(true);
    expect(trace.warnings.join(" ")).toMatch(/weather down/);
    expect(trace.nodes.find((n) => n.id === "optional")?.status).toBe("skipped");
  });

  test("fallback substitutes a value and the run continues", async () => {
    const withFallback = defineNode({
      id: "wf", description: "wf", failurePolicy: "degrade",
      inputSchema: z.any(), outputSchema: z.string(),
      selectInput: (i) => i,
      run: async () => err(externalApiError("down")),
      fallback: () => ok("neutral"),
    });
    const { result, trace } = await runWorkflow<string>({ id: "t", output: "wf", nodes: [withFallback] });
    expect(result.ok && result.value).toBe("neutral");
    expect(trace.status).toBe("degraded");
  });
});

describe("executor — budget & cancellation", () => {
  test("exceeding the node budget stops with budget-exceeded", async () => {
    const nodes = Array.from({ length: 5 }, (_, i) => constNode(`n${i}`, i, i ? [`n${i - 1}`] : []));
    const { result, trace } = await runWorkflow(
      { id: "t", output: "n4", nodes },
      { budget: { maxNodes: 2 } },
    );
    expect(result.ok).toBe(false);
    expect(trace.status).toBe("budget-exceeded");
  });

  test("an already-aborted signal cancels the run", async () => {
    const c = new AbortController();
    c.abort();
    const { result, trace } = await runWorkflow(
      { id: "t", output: "a", nodes: [constNode("a", 1)] },
      { signal: c.signal },
    );
    expect(result.ok).toBe(false);
    expect(trace.status).toBe("cancelled");
  });
});

describe("executor — schema enforcement", () => {
  test("a node whose output violates its schema fails (defence in depth)", async () => {
    const bad = defineNode({
      id: "bad", description: "bad",
      inputSchema: z.any(), outputSchema: z.number(),
      selectInput: (i) => i,
      // returns a string but claims a number output
      run: async () => ok("not a number" as unknown as number),
    });
    const { result } = await runWorkflow({ id: "t", output: "bad", nodes: [bad] });
    expect(result.ok).toBe(false);
  });

  test("input validation failure is a fail-fast validation error", async () => {
    const strict = defineNode({
      id: "strict", description: "strict",
      inputSchema: z.object({ n: z.number() }), outputSchema: z.any(),
      selectInput: () => ({ n: "x" } as unknown as { n: number }),
      run: async () => ok(1),
    });
    const { result } = await runWorkflow({ id: "t", output: "strict", nodes: [strict] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION");
  });
});
