/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { cn, initials } from "@/lib/utils";
import { teamColor } from "./teams/team-colors";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const SIZE_PX: Record<AvatarSize, number> = { sm: 32, md: 44, lg: 72, xl: 132 };

/**
 * PlayerAvatar — real MLB player headshot with a team-colored initials fallback.
 * Uses the public MLB photo CDN. Never shows a broken-image icon: on load
 * failure it renders team-colored initials. Lazy-loaded and accessible.
 */
export function PlayerAvatar({
  playerId,
  name,
  teamId,
  size = "md",
  shape = "circle",
  className,
  ring = true,
}: {
  playerId?: number;
  name: string;
  teamId?: number;
  size?: AvatarSize;
  shape?: "circle" | "rounded";
  className?: string;
  ring?: boolean;
}) {
  const px = SIZE_PX[size];
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(playerId ? "loading" : "error");
  const radius = shape === "circle" ? "rounded-full" : "rounded-xl";
  const color = teamColor(teamId);

  const showFallback = status === "error" || !playerId;

  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden",
        radius,
        ring && "ring-1 ring-border",
        className,
      )}
      style={{ width: px, height: px, background: showFallback ? undefined : "var(--surface-2)" }}
      aria-hidden={false}
    >
      {showFallback ? (
        <span
          className={cn("grid h-full w-full place-items-center font-bold text-white", radius)}
          style={{ background: `linear-gradient(150deg, ${color}, ${shade(color)})`, fontSize: px * 0.34 }}
          role="img"
          aria-label={name}
        >
          {initials(name)}
        </span>
      ) : (
        <>
          {status === "loading" && <span className={cn("shimmer-bg absolute inset-0", radius)} aria-hidden />}
          <img
            src={`/api/headshot/${playerId}?w=${Math.round(px * 2)}`}
            alt={name}
            width={px}
            height={px}
            loading="lazy"
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
            className={cn("h-full w-full object-cover object-top transition-opacity duration-300", status === "loaded" ? "opacity-100" : "opacity-0")}
          />
        </>
      )}
    </span>
  );
}

/** Darken a hex color for the fallback gradient. */
function shade(hex: string): string {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  const r = Math.max(0, ((n >> 16) & 255) - 40);
  const g = Math.max(0, ((n >> 8) & 255) - 40);
  const b = Math.max(0, (n & 255) - 40);
  return `rgb(${r}, ${g}, ${b})`;
}
