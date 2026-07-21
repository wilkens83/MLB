/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { cn, initials } from "@/lib/utils";

/**
 * Renders an official MLB team logo (public mlbstatic CDN) with a graceful
 * initials fallback if the asset fails to load.
 */
export function TeamLogo({
  teamId,
  name,
  size = 32,
  className,
}: {
  teamId?: number;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showFallback = failed || !teamId;

  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {showFallback ? (
        <span className="text-[10px] font-bold text-muted">{initials(name)}</span>
      ) : (
        <img
          src={`/api/team-logo/${teamId}`}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain p-0.5"
        />
      )}
    </span>
  );
}
