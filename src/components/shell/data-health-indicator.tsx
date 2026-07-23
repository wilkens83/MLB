"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import type { ProviderHealth } from "@/lib/providers/types";

/** Compact provider-health dot in the top bar. Reads the existing /api/health. */
export function DataHealthIndicator({ href = "/health" }: { href?: string }) {
  const { data } = useQuery({
    queryKey: ["health-mini"],
    queryFn: async () =>
      (await fetch("/api/health")).json() as Promise<{ providers: ProviderHealth[] }>,
    refetchInterval: 30000,
    staleTime: 20000,
  });

  const providers = data?.providers ?? [];
  const anyFailures = providers.some((p) => p.failures > 0);
  const anySuccess = providers.some((p) => p.lastSuccessAt);
  const state = providers.length === 0 ? "idle" : anyFailures ? "degraded" : anySuccess ? "ok" : "idle";

  const tone =
    state === "ok" ? "bg-[var(--positive)]" : state === "degraded" ? "bg-[var(--warning)]" : "bg-muted-2";
  const label = state === "ok" ? "Data OK" : state === "degraded" ? "Degraded" : "Idle";

  return (
    <Link
      href={href}
      className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground sm:inline-flex"
      title="Provider data health"
    >
      <span className={cn("h-2 w-2 rounded-full", tone)} aria-hidden />
      {label}
    </Link>
  );
}
