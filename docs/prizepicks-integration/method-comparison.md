# Phase 1 — integration method comparison & decision

## Legal / terms position (decisive)
PrizePicks does not publish an authorized public data API or a documented feed
for third-party board ingestion. Any automated retrieval would rely on
undocumented endpoints and/or an authenticated session, which risks violating
their Terms and anti-bot protections. Per the task's own non-negotiable rules
(no login automation, no credential storage, no CAPTCHA/anti-bot bypass, no
undocumented-endpoint dependence), **automated retrieval is not implemented.**

## Decision matrix (1 = poor, 5 = excellent)

| Method | Legal/terms | Reliability | Update speed | Completeness | Impl. complexity | Maint. burden | User effort | Silent-error risk | Deploy compat |
|---|---|---|---|---|---|---|---|---|---|
| A. Manual entry | 5 | 5 | 3 | 4 | Low | Low | High | Low | 5 |
| B. CSV import | 5 | 5 | 4 | 4 | Low | Low | Med | Low | 5 |
| C. Reviewed screenshot | 5 | 3 | 3 | 3 | High | Med | Med | Med (OCR) | 4 |
| D. Browser-assisted (paste / HAR export) | 4 | 3 | 4 | 3 | Med | Med | Med | Med | 4 |
| E. User-exported network payload | 3 | 3 | 4 | 4 | Med | High | High | Med | 4 |
| F. Licensed/authorized provider | 5 | 5 | 5 | 5 | External | Low | Low | Low | 5 |
| G. Public authorized feed | — | — | — | — | — | — | — | — | — (none exists) |

## Chosen layered strategy
The product stays useful even when any one method fails, using this priority:

1. **Manual entry** (guaranteed) — implemented.
2. **CSV import** (guaranteed) — implemented.
3. **Reviewed screenshot import** — **stub UI + manual-review path** implemented;
   automatic OCR extraction is intentionally *not* claimed (see below).
4. **Persistent line snapshots** — implemented (append-only).

Optional/replaceable, behind the same provider interface:
- **Browser-assisted paste / HAR** (Phase 8): documented approach, not built this
  pass; would still pass through normalize → validate → resolve → review.
- **Authorized provider** (F): interface exists (`authorized-provider` source
  type); no such provider is wired because none is authorized.

## Rejected / deferred and why
- **Automated PrizePicks scraping (login/endpoints):** rejected — terms/anti-bot
  risk; violates the task's explicit rules.
- **Automatic OCR of screenshots as trusted data:** rejected — would risk
  silently-incorrect lines/players. The screenshot path always requires human
  review before an entry is saved; we do not claim perfect OCR.
- **Server DB this pass:** deferred — no DB is provisioned. `localStorage` store
  is the honest baseline; a server store can replace it behind the same interface.

## Data-source honesty
Every imported entry records `sourceType` (`manual` | `csv` |
`reviewed-image-import` | `browser-assisted-import` | `authorized-provider`) and
`capturedAt`. Manual/CSV/image data is **never** labeled as live. Diamond Edge
model outputs are always visually separated from imported PrizePicks values.
