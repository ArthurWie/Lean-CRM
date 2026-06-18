<!-- GSD:project-start source:PROJECT.md -->

## Project

**ClickWise CRM (Lean Rebuild)**

A deliberately lean, single-user sales CRM for one person (Arthur) who wins customers for
ClickWise (security-awareness / IT-security) via cold calls and follow-ups. It does two things
well: keep a clean overview of contacted companies (who was approached, what was said, what was
learned, never forget a follow-up), and run through many calls fast in a distraction-free focus
mode. It is the radical simplification of an over-engineered predecessor that had grown into a
research platform (3D knowledge graph, dossiers, sequence editor, Obsidian vault).

**Core Value:** One logging action — channel → outcome → one-sentence note → optional follow-up/🔥 — must
**automatically derive** status, last-contact, the dated note, next step, and the follow-up
reminder. Type one sentence, five fields fill themselves. That derivation is the entire reason
this exists instead of an Excel sheet.

### Constraints

- **Tech stack**: Tauri (Rust core + React/TS frontend) — small bundle, native SQLite, clean OS-shell `tel:`/`mailto:`, matches Arthur's Rust skill. WebView2 on Windows, WebKit on macOS.
- **Tech stack**: Drizzle ORM behind a thin data layer — the rest of the app knows no SQL, so a later swap to Postgres (team mode) is cheap; lighter and better-suited to Tauri/desktop than Prisma (no bundled query-engine binary).
- **Compatibility**: Cross-platform — must run on **Windows 11 and macOS**. The one-click-call UX must degrade gracefully: macOS gets iPhone Continuity (click on Mac → call rings through iPhone, requires "allow calls on other devices"); Windows uses the default `tel:` handler (e.g. Phone Link). Calling behavior is designed per-OS.
- **Storage**: One local SQLite file in a synced folder (iCloud/Dropbox) for backup — no server.
- **Look & feel**: Corporate / Excel-like, not playful — sharp 2px corners, table grid lines, muted navy palette, text buttons (Tel/Mail/in) instead of emoji icons. **Sole exception: the 🔥 flame stays as an emoji**, small and subtle. `lean-crm-mockup.html` is the visual reference.
- **Data contract**: The lead-hunter CSV schema (`unternehmen,fn,branche,groesse,website,ansprechpartner,rolle,telefon,email,linkedin,lessons,quelle,notiz`) is the only interface between lead-finding and the app — import must honor it exactly, including semicolon-separated emails.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
