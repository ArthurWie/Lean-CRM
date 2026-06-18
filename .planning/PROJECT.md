# ClickWise CRM (Lean Rebuild)

## What This Is

A deliberately lean, single-user sales CRM for one person (Arthur) who wins customers for
ClickWise (security-awareness / IT-security) via cold calls and follow-ups. It does two things
well: keep a clean overview of contacted companies (who was approached, what was said, what was
learned, never forget a follow-up), and run through many calls fast in a distraction-free focus
mode. It is the radical simplification of an over-engineered predecessor that had grown into a
research platform (3D knowledge graph, dossiers, sequence editor, Obsidian vault).

## Core Value

One logging action — channel → outcome → one-sentence note → optional follow-up/🔥 — must
**automatically derive** status, last-contact, the dated note, next step, and the follow-up
reminder. Type one sentence, five fields fill themselves. That derivation is the entire reason
this exists instead of an Excel sheet.

## Business Context

- **Customer**: Arthur (single user) selling ClickWise security-awareness/IT-security services to AT/DACH B2B companies.
- **Revenue model**: Indirect — the tool drives Arthur's outbound sales pipeline; it is internal sales tooling, not a sold product.
- **Success metric**: Calls worked per session and follow-ups never dropped (no missed callbacks).
- **Strategy notes**: Lead-finding is intentionally *outside* the app (the `/lead-hunter` Claude skill); the app only imports CSVs.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Database surface (home / start view)**
- [ ] Excel-like table over all companies: Unternehmen · Branche · Größe · Ansprechpartner · Kontakt · Status · Nächster Schritt · Notizen · Lessons learned
- [ ] Sticky first column, horizontal scroll, grid lines; dead/parked companies dimmed and filterable
- [ ] Clickable contact actions per row — **Tel · Mail · in** (phone, email, LinkedIn); greyed out when no data; hover shows the address
- [ ] 🔥 hot-marking next to the company name that sorts the company to the top (set when logging, not in advance)
- [ ] Notizen column shows the newest interaction note with date + channel; blue dot = new since last viewed
- [ ] Click a row to expand an inline detail/logging panel (contacts, full history, logging) — replaces a separate detail page
- [ ] "+ Neue Firma" manual add and "CSV importieren" buttons

**Focus surface (power-dial mode)**
- [ ] One company shown large and alone: name (+🔥 if hot), small Branche + Größe, one line "why now" (e.g. callback agreed, fresh lead)
- [ ] Large phone button (one click calls), Mail/LinkedIn small alongside
- [ ] Show latest Notizen + Lessons learned as pre-call context
- [ ] Same logging as the database; "Speichern & weiter" and "Überspringen"; counter "Firma X von Y"; end-of-stream completion screen
- [ ] App auto-serves the next company (hot first); due follow-ups simply resurface in the stream — no calendar/date character

**Logging (identical at both surfaces — the central mechanic)**
- [ ] Choose channel (Telefon/E-Mail/LinkedIn) → choose **channel-dependent** outcome → one-sentence note → optional follow-up → optional 🔥
- [ ] Channel-dependent outcomes (Telefon / E-Mail / LinkedIn sets per the spec)
- [ ] Auto-derive from one log: Status, last contact, dated note (date/channel/bearbeiter), Nächster Schritt, and (if follow-up set) the Wiedervorlage entry

**Data & import**
- [ ] SQLite store, one local file, behind a thin data layer with a portable ORM (Drizzle)
- [ ] 5 tables: firmen, kontakte, kontakt_mails, interaktionen, followups; UUID/text IDs, UTC timestamps + updated_at
- [ ] Multiple emails per contact (kontakt_mails); semicolon-separated in import CSV
- [ ] Derived Status (Neu · Offen · Im Gespräch · Termin · Kein Interesse · Tot/Geparkt) — never set by hand
- [ ] CSV import in the exact lead-hunter format; on import match every row against all companies (FN → domain → normalized name)
- [ ] Dead-Company-Guard: on match to a Tot/"nicht kontaktieren" company → skip and report loudly, never re-create or surface; other matches → skip as duplicate
- [ ] Post-import report: "X neu, Y übersprungen (davon Z nicht-kontaktieren)"
- [ ] One-time migration of the existing ~39-company Excel export (`leads-book1.csv`)

**Contact actions**
- [ ] `tel:` and `mailto:` open via the OS shell (not the embedded webview) so platform calling integrations work

### Out of Scope

- Login / auth / user accounts — single user for now; keep door open via `bearbeiter` column only — [over-engineering trap, no second user yet]
- Multi-user / team mode / hosting — [v1 is one person; ORM + UUIDs + updated_at leave the door open for a cheap Postgres move later]
- Realtime sync — [iCloud/Dropbox folder sync of the SQLite file is enough for v1]
- Calendar / .ics / Outlook API integration — [v1 uses only the focus stream as the reminder; follow-ups resurface the company in focus]
- In-app lead research / deep research / ICP / scoring / dossiers / knowledge graph — [the reason the predecessor was scrapped; lead-finding lives in the external `/lead-hunter` skill, app only imports CSV]
- Pre-assigned hot/warm/cold scores — [🔥 is a reaction marker set while logging, not an upfront score]

## Context

- **Predecessor**: An over-engineered CRM/research platform (3D graph, insights dashboard, dossiers, sequence editor, Obsidian vault) was abandoned as overengineered. This is a from-scratch lean rebuild; the old vault and `.crm/crm.json` are archived, only raw company data is migrated.
- **User**: Arthur, solo. Works mostly in Python/Rust/TS-React (Rust experience makes Tauri a natural fit). Bilingual; the app UI and domain vocabulary are German.
- **Provided artifacts** (in repo root): `HANDOFF-clickwise-crm.md` (the spec / PRD), `lean-crm-mockup.html` (clickable visual target — the design contract), `lead-hunter/SKILL.md` (the external lead-research skill → goes under `.claude/skills/`), `leads-beispiel.csv` (import format + test file with a deliberate duplicate and a dead company), `leads-book1.csv` (existing 39-company Excel export for first import).
- **Domain notes (for lead targeting)**: NIS2 is a driver for energy/utilities/water but NOT for media/comms/agencies (there it's phishing risk / DSGVO). Smaller/mid firms where the GF answers the phone directly are more valuable than large corps with their own security teams.
- **Post first-import manual cleanup** (dead-company-guard can't fire on an empty DB): Chapter 4 GmbH → Tot (number doesn't exist); Milestones in Communication → Tot/Geparkt (insolvency); Verlag Österreich GmbH → Geparkt.

## Constraints

- **Tech stack**: Tauri (Rust core + React/TS frontend) — small bundle, native SQLite, clean OS-shell `tel:`/`mailto:`, matches Arthur's Rust skill. WebView2 on Windows, WebKit on macOS.
- **Tech stack**: Drizzle ORM behind a thin data layer — the rest of the app knows no SQL, so a later swap to Postgres (team mode) is cheap; lighter and better-suited to Tauri/desktop than Prisma (no bundled query-engine binary).
- **Compatibility**: Cross-platform — must run on **Windows 11 and macOS**. The one-click-call UX must degrade gracefully: macOS gets iPhone Continuity (click on Mac → call rings through iPhone, requires "allow calls on other devices"); Windows uses the default `tel:` handler (e.g. Phone Link). Calling behavior is designed per-OS.
- **Storage**: One local SQLite file in a synced folder (iCloud/Dropbox) for backup — no server.
- **Look & feel**: Corporate / Excel-like, not playful — sharp 2px corners, table grid lines, muted navy palette, text buttons (Tel/Mail/in) instead of emoji icons. **Sole exception: the 🔥 flame stays as an emoji**, small and subtle. `lean-crm-mockup.html` is the visual reference.
- **Data contract**: The lead-hunter CSV schema (`unternehmen,fn,branche,groesse,website,ansprechpartner,rolle,telefon,email,linkedin,lessons,quelle,notiz`) is the only interface between lead-finding and the app — import must honor it exactly, including semicolon-separated emails.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tauri over Electron | Rust core matches Arthur's skill, ~10MB bundle vs ~100MB, native SQLite, clean OS-shell tel:/mailto: | — Pending |
| Drizzle over Prisma | TS-native, lightweight, excellent SQLite+Tauri fit, trivial Postgres swap, no query-engine binary to bundle | — Pending |
| Cross-platform (Win + macOS) target | Dev on Windows, real use case (Continuity calling) is Mac+iPhone; both must work | — Pending |
| Status is always derived, never hand-set | The derivation from logging is the core value; manual status would let it drift | — Pending |
| Lead-finding stays outside the app (CSV-only interface) | In-app research is exactly what sank the predecessor; the app stays lean | — Pending |
| 🔥 as a reaction marker, not an upfront score | Avoids fake precision; reflects real phone reactions, set while logging | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-18 after initialization*
