/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { cn, initials } from "@/lib/utils";

/** Official MLB player headshot with an initials fallback. */
export function PlayerHeadshot({
  playerId,
  name,
  size = 72,
  className,
}: {
  playerId: number;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {failed ? (
        <span className="text-lg font-bold text-muted">{initials(name)}</span>
      ) : (
        <img
          src={`https://midfield.mlbstatic.com/v1/people/${playerId}/spots/${Math.round(size * 1.6)}`}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}
