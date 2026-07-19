import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";

/* ---------------------------------- Badge --------------------------------- */

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-surface-2 text-foreground border border-border",
        brand: "bg-brand-500/15 text-brand-500 border border-brand-500/25",
        positive: "bg-[var(--positive)]/12 text-[var(--positive)] border border-[var(--positive)]/25",
        negative: "bg-[var(--negative)]/12 text-[var(--negative)] border border-[var(--negative)]/25",
        warning: "bg-[var(--warning)]/12 text-[var(--warning)] border border-[var(--warning)]/25",
        info: "bg-[var(--info)]/12 text-[var(--info)] border border-[var(--info)]/25",
        outline: "border border-border text-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/* --------------------------------- Button --------------------------------- */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:scale-[0.98]",
  {
    variants: {
      variant: {
        brand:
          "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[0_6px_20px_-6px_rgba(249,115,22,0.6)] hover:from-brand-400 hover:to-brand-500",
        solid: "bg-foreground text-background hover:opacity-90",
        outline: "border border-border bg-transparent hover:bg-surface-2 text-foreground",
        ghost: "hover:bg-surface-2 text-foreground",
        subtle: "bg-surface-2 text-foreground hover:bg-surface-2/70",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "brand", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/* -------------------------------- Skeleton -------------------------------- */

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shimmer-bg rounded-lg", className)} {...props} />;
}

/* --------------------------------- StatPill ------------------------------- */

export function StatPill({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "positive" | "negative" | "brand";
  className?: string;
}) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--positive)]"
      : tone === "negative"
        ? "text-[var(--negative)]"
        : tone === "brand"
          ? "text-brand-500"
          : "text-foreground";
  return (
    <div className={cn("rounded-xl border border-border bg-surface-2/50 px-3 py-2.5", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-0.5 text-lg font-bold tabular-nums", toneClass)}>{value}</div>
      {hint && <div className="text-[11px] text-muted-2">{hint}</div>}
    </div>
  );
}

/* ------------------------------- Progress bar ----------------------------- */

export function MeterBar({
  value,
  className,
  tone = "brand",
}: {
  value: number; // 0..1
  className?: string;
  tone?: "brand" | "positive" | "negative";
}) {
  const pctv = Math.max(0, Math.min(1, value)) * 100;
  const bg =
    tone === "positive"
      ? "bg-[var(--positive)]"
      : tone === "negative"
        ? "bg-[var(--negative)]"
        : "bg-gradient-to-r from-brand-500 to-brand-400";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div className={cn("h-full rounded-full transition-all duration-500", bg)} style={{ width: `${pctv}%` }} />
    </div>
  );
}
