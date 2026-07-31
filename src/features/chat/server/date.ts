/* ============================================================================
   Relative-date resolution. Phrases like "today", "tonight", "tomorrow",
   "yesterday" are converted to an explicit YYYY-MM-DD in the user's timezone,
   server-side, and stored in the response metadata. No future data ever feeds a
   pregame projection because the resolved date is always the slate the tools query.
   ========================================================================== */

/** Format a Date as YYYY-MM-DD in a given IANA timezone. */
export function isoDateInTimezone(date: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(date); // en-CA yields YYYY-MM-DD
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export interface ResolvedDate {
  date: string;
  label: string;
  /** True when the phrase referred to a future date (blocks pregame leakage checks upstream). */
  future: boolean;
}

/**
 * Resolve an explicit date or a relative phrase inside the message to YYYY-MM-DD.
 * Precedence: explicit `explicitDate` > phrase in message > today.
 */
export function resolveDate(
  message: string,
  timezone: string,
  explicitDate: string | undefined,
  now = new Date(),
): ResolvedDate {
  const today = isoDateInTimezone(now, timezone);
  if (explicitDate) return { date: explicitDate, label: explicitDate, future: explicitDate > today };

  const text = message.toLowerCase();
  // Explicit ISO date mentioned in the text, e.g. "on 2026-07-14".
  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return { date: isoMatch[1], label: isoMatch[1], future: isoMatch[1] > today };

  if (/\btomorrow\b/.test(text)) {
    const d = shiftDays(today, 1);
    return { date: d, label: "tomorrow", future: true };
  }
  if (/\byesterday\b/.test(text)) {
    const d = shiftDays(today, -1);
    return { date: d, label: "yesterday", future: false };
  }
  // "today", "tonight", "this afternoon" all resolve to today.
  return { date: today, label: "today", future: false };
}

/** Parse a recent-games window ("last 15 games", "last seven games") → count. */
export function parseWindow(message: string): number | undefined {
  const text = message.toLowerCase();
  const digit = text.match(/last\s+(\d{1,3})\s+(?:games?|starts?)/);
  if (digit) return Math.min(50, Math.max(1, Number(digit[1])));
  const words: Record<string, number> = {
    five: 5, seven: 7, ten: 10, fifteen: 15, twenty: 20, thirty: 30,
  };
  const word = text.match(/last\s+(five|seven|ten|fifteen|twenty|thirty)\s+(?:games?|starts?)/);
  if (word) return words[word[1]];
  return undefined;
}
