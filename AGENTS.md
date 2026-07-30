<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MLB data conventions

- **Never hard-code a season year.** The active season is resolved from the date
  in `src/lib/mlb/season.ts` (`getCurrentMlbSeason()` / `getMlbSeasonForDate(date)`).
  Use it for any `season` default. A historical request must resolve to the
  season that date belonged to — data created after a game must never feed a
  pregame projection.
- **Zero ≠ unavailable.** Missing MLB/Savant values stay `undefined` and are
  reported as unavailable; do not coerce them to 0.
- **Confirmed vs. projected.** Lineups inferred from a team's most recent game
  are `projected`, never presented as confirmed. Resolve players by MLB player
  ID, never by name alone.
- **Live vs. fixtures.** Do not describe a surface as live if it only runs on
  fixtures or manual imports (e.g. Tennis).
- Live/network scripts (`scripts/verify-*.ts`) run under Node/tsx, not Bun; the
  Bun unit suite (`bun test src`) must stay deterministic and offline.
