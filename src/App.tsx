// App shell: seed the DB on first launch, read companies back through the thin
// data layer, and render the sidebar + head + toolbar chrome around the
// CompanyTable. App.tsx imports the data layer ONLY — never drizzle or the
// schema (DATA-02). The table itself is CompanyTable (Plan 02).
import { useEffect, useState } from "react";
import {
  addCompany,
  deleteCompany,
  listCompanies,
  listContacts,
  listDeletedCompanies,
  markViewed,
  purgeExpiredCompanies,
  restoreCompany,
  seedIfEmpty,
  softDeleteCompany,
  updateCompanyField,
  type Company,
  type Contact,
} from "./data/companies";
import {
  listInteractions,
  logInteraction,
  updateInteractionNote,
  type Interaction,
} from "./data/interactions";
import {
  addContact,
  updateContact,
  deleteContact,
  setContactEmails,
} from "./data/contacts";
import {
  getFocusSnapshot,
  resolveDueFollowups,
  type FocusCompany,
} from "./data/focus";
import {
  parseCsv,
  validateHeader,
  classifyRows,
  importCsv,
  clearAllData,
  type ClassifiedRow,
  type Candidate,
} from "./data/import";
import { getBearbeiter, setBearbeiter } from "./data/settings";
import { CompanyTable } from "./components/CompanyTable";
import { FocusView } from "./components/FocusView";
import { Einstellungen } from "./components/Einstellungen";
import { ImportDialog, type ImportDialogMode } from "./components/ImportDialog";
import type { LogEntry } from "./components/LogForm";
import "./App.css";

// The three top-level views (replaces the old 2-way focusOpen boolean).
type View = "db" | "focus" | "settings";

function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  // "Zuletzt gelöscht": the soft-deleted companies, loaded for the trash view.
  const [deletedCompanies, setDeletedCompanies] = useState<Company[]>([]);
  const [interactionsByFirma, setInteractionsByFirma] = useState<
    Record<string, Interaction[]>
  >({});
  const [contactsByFirma, setContactsByFirma] = useState<
    Record<string, Contact[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The active top-level view (Datenbank / Fokus / Einstellungen). Replaces the
  // old 2-way focusOpen boolean (D6-05).
  const [view, setView] = useState<View>("db");
  // The configured "Erfasst als" name, read once on load via settings.ts and
  // passed down to Einstellungen AND the LogForm (DATA-02: App owns the read/
  // write; the components never import settings). "" = unset.
  const [bearbeiter, setBearbeiterState] = useState("");
  // Focus mode (Plan 04-03). focusSnapshot is the one-time ordered call stream
  // (getFocusSnapshot, read ONCE on open — D-07, never re-queried mid-session).
  const [focusSnapshot, setFocusSnapshot] = useState<FocusCompany[]>([]);
  // CSV import (Plan 05-02). One state slot drives the shared ImportDialog: null =
  // closed; otherwise { mode, rows }. "preview" → "report" reuses the SAME dialog
  // (the rows stay; only the mode flips after the write). "error" = wrong file (5a).
  const [importDialog, setImportDialog] = useState<{
    mode: ImportDialogMode;
    rows: ClassifiedRow[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await seedIfEmpty();
        // Auto-purge trash older than the retention window BEFORE the first load,
        // so expired companies never resurface in either list.
        await purgeExpiredCompanies();
        setCompanies(await listCompanies());
        setDeletedCompanies(await listDeletedCompanies());
        // D6-03: read the configured logging name once on load.
        setBearbeiterState(await getBearbeiter());
      } catch (e) {
        console.error("Failed to load companies:", e);
        setError("Firmen konnten nicht geladen werden.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Refresh both the active and the soft-deleted lists. Used after any action
  // that moves a company between the two (soft-delete, restore, permanent delete).
  async function refreshLists() {
    setCompanies(await listCompanies());
    setDeletedCompanies(await listDeletedCompanies());
  }

  // Load one company's interactions + contacts into the per-firma maps.
  async function loadFirma(firmaId: string) {
    const [interactions, contacts] = await Promise.all([
      listInteractions(firmaId),
      listContacts(firmaId),
    ]);
    setInteractionsByFirma((m) => ({ ...m, [firmaId]: interactions }));
    setContactsByFirma((m) => ({ ...m, [firmaId]: contacts }));
  }

  // Opening a row: clear the blue dot (markViewed, DB-05), lazily load its
  // interactions/contacts, and refresh the companies list so last_viewed updates.
  async function handleOpenRow(firmaId: string) {
    try {
      await markViewed(firmaId);
      await loadFirma(firmaId);
      setCompanies(await listCompanies());
    } catch (e) {
      console.error("Failed to open row:", e);
    }
  }

  // Saving a log: persist the interaction (status re-derived in the data layer),
  // then reload that company's interactions AND the companies list so the row's
  // derived columns (Status / Notizen / Nächster Schritt) update (LOG-03/04).
  async function handleSave(firmaId: string, entry: LogEntry) {
    try {
      await logInteraction({
        firma_id: firmaId,
        kanal: entry.kanal,
        outcome: entry.outcome,
        notiz: entry.notiz,
        heiss: entry.heiss,
        followup: entry.followup ?? undefined,
      });
      await loadFirma(firmaId);
      setCompanies(await listCompanies());
    } catch (e) {
      console.error("Failed to save interaction:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // Focus mode (Plan 04-03). The toolbar "Fokus" button (D-11) opens FocusView
  // over a ONE-TIME snapshot. App owns every data-layer call (DATA-02): it imports
  // ./data/focus, never drizzle. The save path is two SEQUENTIAL awaited writes
  // (logInteraction THEN resolveDueFollowups) with NO combined/proxy transaction (D-04 /
  // Pitfall 4 — the sqlite-proxy pool landmine). Skip never resolves (D-05).
  // ---------------------------------------------------------------------------

  // Open Focus: read getFocusSnapshot() ONCE and store it (D-07 — never re-query
  // mid-session). Eagerly load contacts + interactions for the WHOLE snapshot
  // (wiring choice (a)): the snapshot is a curated subset (due/hot/neu), not the
  // whole DB, so the cost is bounded — and because FocusView owns the cursor, the
  // parent has no next-served-id hook (no onAdvance prop), so eager loading is the
  // clean way to guarantee the served company's Tel/Mail/in + Letzte Notizen are
  // populated on first view (Pitfall 6). Never sets firmen.status (DATA-05).
  async function handleOpenFocus() {
    try {
      const snapshot = await getFocusSnapshot();
      setFocusSnapshot(snapshot);
      // Eager per-firma load over the bounded snapshot so every served company's
      // contacts/notes are ready (no empty panel on advance — Pitfall 6).
      await Promise.all(snapshot.map((c) => loadFirma(c.id)));
      setView("focus");
    } catch (e) {
      console.error("Failed to open Focus mode:", e);
      setError("Fokus-Modus konnte nicht geöffnet werden.");
    }
  }

  // "Speichern & weiter": SEQUENTIAL awaited writes, NO transaction (mirrors
  // handleSave). Order matters (Pitfall 4): logInteraction inserts the NEW future-
  // dated follow-up FIRST, then resolveDueFollowups closes only the OLD due ones —
  // so the freshly-set follow-up survives and the resurfacing one stops. FocusView
  // advances its own cursor after this resolves. Refresh the table so derived
  // columns reflect the log once Focus closes.
  async function handleFocusSave(firmaId: string, entry: LogEntry) {
    try {
      await logInteraction({
        firma_id: firmaId,
        kanal: entry.kanal,
        outcome: entry.outcome,
        notiz: entry.notiz,
        heiss: entry.heiss,
        followup: entry.followup ?? undefined,
      });
      await resolveDueFollowups(firmaId);
      setCompanies(await listCompanies());
    } catch (e) {
      console.error("Failed to save Focus interaction:", e);
    }
  }

  // "Überspringen": skip never resolves the follow-up (D-05) — the company stays
  // due so it resurfaces next session. No data write here; FocusView advances its
  // own cursor (skip-counts-once, 04-02).
  function handleFocusSkip(_firmaId: string) {
    // Intentionally a no-op on the data layer (D-05). The contacts/interactions
    // for every snapshot company were eagerly loaded on open, so nothing to fetch.
  }

  // Close Focus → back to Datenbank: refresh BOTH lists so the table's derived
  // columns (status / Notizen / Nächster Schritt) reflect the logs made in Focus.
  async function handleCloseFocus() {
    setView("db");
    await refreshLists();
  }

  // D6-03: persist the configured logging name, then update App state so the
  // LogForm + Einstellungen reflect it without a reload. App owns the write
  // (settings.ts) — Einstellungen never imports settings (DATA-02).
  async function handleSaveBearbeiter(name: string) {
    try {
      await setBearbeiter(name);
      setBearbeiterState(name);
    } catch (e) {
      console.error("Failed to save bearbeiter:", e);
      setError("Einstellung konnte nicht gespeichert werden.");
    }
  }

  // DB-07 / D-05: manual add via "+ Neue Firma". Persist the new company (Status
  // "Neu" derived in the data layer) then reload the list so it falls into sorted
  // order with its .stp.neu pill.
  async function handleAddCompany(input: {
    name: string;
    fn?: string;
    branche?: string;
    groesse?: string;
    website?: string;
  }) {
    try {
      await addCompany(input);
      setCompanies(await listCompanies());
    } catch (e) {
      console.error("Failed to add company:", e);
    }
  }

  // Addition 1 (D-07 amended): commit an inline edit of the Notizen cell. The cell
  // shows the NEWEST interaction's note, so the edit rewrites THAT interaction's
  // notiz (not a parallel company field). Reload the firma's interactions AND the
  // companies list so the derived Notizen column reflects the new text.
  async function handleEditNote(firmaId: string, interactionId: string, text: string) {
    try {
      await updateInteractionNote(interactionId, text);
      await loadFirma(firmaId);
      setCompanies(await listCompanies());
    } catch (e) {
      console.error("Failed to edit interaction note:", e);
    }
  }

  // "Zuletzt gelöscht": Löschen now SOFT-deletes — the company moves to the trash
  // view (recoverable for the retention window) rather than being destroyed. The
  // right-click and detail-panel "Löschen" both route here. Refresh both lists so
  // it leaves the active table and appears in "Zuletzt gelöscht".
  async function handleDeleteCompany(firmaId: string) {
    try {
      await softDeleteCompany(firmaId);
      await refreshLists();
    } catch (e) {
      console.error("Failed to delete company:", e);
    }
  }

  // Restore a soft-deleted company from the trash view back to the active list.
  async function handleRestoreCompany(firmaId: string) {
    try {
      await restoreCompany(firmaId);
      await refreshLists();
    } catch (e) {
      console.error("Failed to restore company:", e);
    }
  }

  // "Endgültig löschen" from the trash view: the permanent hard-delete cascade.
  async function handlePermanentDelete(firmaId: string) {
    try {
      await deleteCompany(firmaId);
      await refreshLists();
    } catch (e) {
      console.error("Failed to permanently delete company:", e);
    }
  }

  // D-08 (Plan 03-04): contact management. Each handler calls the contacts data
  // layer then loadFirma(firmaId) to refresh contactsByFirma so the detail panel
  // AND the row's Ansprechpartner/Tel/Mail/in (Plan 01) reflect the change. App
  // owns every data-layer call; CompanyDetail owns edit state only (DATA-02).
  async function handleAddContact(
    firmaId: string,
    input: {
      name?: string;
      rolle?: string;
      telefon?: string;
      linkedin?: string;
      emails?: string[];
    },
  ) {
    try {
      await addContact(firmaId, input);
      await loadFirma(firmaId);
    } catch (e) {
      console.error("Failed to add contact:", e);
    }
  }

  async function handleUpdateContact(
    firmaId: string,
    kontaktId: string,
    patch: Partial<Record<"name" | "rolle" | "telefon" | "linkedin", string>>,
  ) {
    try {
      await updateContact(kontaktId, patch);
      await loadFirma(firmaId);
    } catch (e) {
      console.error("Failed to update contact:", e);
    }
  }

  async function handleDeleteContact(firmaId: string, kontaktId: string) {
    try {
      await deleteContact(kontaktId);
      await loadFirma(firmaId);
    } catch (e) {
      console.error("Failed to delete contact:", e);
    }
  }

  async function handleSetContactEmails(
    firmaId: string,
    kontaktId: string,
    emails: string[],
  ) {
    try {
      await setContactEmails(kontaktId, emails);
      await loadFirma(firmaId);
    } catch (e) {
      console.error("Failed to set contact emails:", e);
    }
  }

  // D-07: commit an inline edit of a company text field, then reload so the row
  // reflects the persisted value.
  async function handleEditCell(
    id: string,
    patch: Partial<
      Pick<Company, "name" | "fn" | "branche" | "groesse" | "website" | "lessons">
    >,
  ) {
    try {
      await updateCompanyField(id, patch);
      setCompanies(await listCompanies());
    } catch (e) {
      console.error("Failed to edit company field:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // CSV import (Plan 05-02). The full flow lives here so the components stay SQL-
  // free (DATA-02): handleImport reads the File, parses + validates + classifies,
  // and opens the shared ImportDialog; handleConfirmImport writes only the neu rows
  // then flips the dialog to the report. App owns every data-layer call.
  // ---------------------------------------------------------------------------

  // Upload → parse → header-validate → classify → preview (D-06). A wrong header
  // opens the dialog in "error" mode and processes ZERO rows (T-05-HDR). Any read/
  // parse failure surfaces as the same error dialog rather than a silent throw
  // (T-05-FILE).
  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const { data, meta } = parseCsv(text);
      if (!validateHeader(meta.fields)) {
        setImportDialog({ mode: "error", rows: [] });
        return;
      }
      // Existing companies become dedupe candidates; their status drives the D-04
      // Tot → nicht-kontaktieren split. listCompanies includes Tot/Geparkt (the
      // status filter is UI-side), exactly what the classifier needs.
      const existing: Candidate[] = (await listCompanies()).map((c) => ({
        name: c.name,
        status: c.status,
        fn: c.fn ?? "",
        website: c.website ?? "",
      }));
      const rows = classifyRows(data, existing);
      setImportDialog({ mode: "preview", rows });
    } catch (e) {
      console.error("Failed to read/parse the CSV file:", e);
      setImportDialog({ mode: "error", rows: [] });
    }
  }

  // Bestätigen: write ONLY the neu rows (importCsv — sequential awaited inserts, NO
  // transaction, Plan 01), refresh the table + per-firma maps, then flip the SAME
  // dialog to "report" so the user sees the same itemization post-write (D-05).
  async function handleConfirmImport(neuRows: Parameters<typeof importCsv>[0]) {
    try {
      await importCsv(neuRows);
      await refreshLists();
      // Drop stale per-firma maps so reopened rows reload fresh contacts/notes.
      setInteractionsByFirma({});
      setContactsByFirma({});
      // Keep the classified rows; only the mode changes preview → report.
      setImportDialog((d) => (d ? { mode: "report", rows: d.rows } : null));
    } catch (e) {
      console.error("Failed to import CSV rows:", e);
      // A write failure shouldn't strand the user in the preview; surface the
      // generic error dialog (T-05-FILE) so the flow is never silently swallowed.
      setImportDialog({ mode: "error", rows: [] });
    }
  }

  // D6-01: "Alle Daten löschen" — hard-reset the DB. The friction now lives in
  // the Einstellungen Daten danger zone (type-to-confirm "LÖSCHEN"); this handler
  // just performs the reset and refreshes so the table falls through to its
  // existing empty state.
  async function handleClearAll() {
    try {
      await clearAllData();
      setInteractionsByFirma({});
      setContactsByFirma({});
      await refreshLists();
    } catch (e) {
      console.error("Failed to clear all data:", e);
      setError("Daten konnten nicht gelöscht werden.");
    }
  }

  // Stillgelegte Firmen: the Tot/Geparkt companies, derived from the loaded
  // active list (listCompanies includes them — only soft-deleted are excluded).
  // View-only in Einstellungen (DATA-05: no new manual-status surface).
  const stillgelegte = companies.filter(
    (c) => c.status === "Tot" || c.status === "Geparkt",
  );

  const headTitle =
    view === "focus" ? "Fokus" : view === "settings" ? "Einstellungen" : "Datenbank";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" /> Lean CRM
        </div>
        <button
          className={view === "db" ? "nav active" : "nav"}
          type="button"
          onClick={handleCloseFocus}
        >
          Datenbank
        </button>
        <button
          className={view === "focus" ? "nav active" : "nav"}
          type="button"
          onClick={handleOpenFocus}
        >
          Fokus
        </button>
        <button
          className={view === "settings" ? "nav active" : "nav"}
          type="button"
          onClick={() => setView("settings")}
        >
          Einstellungen
        </button>
        <div className="nav-foot">
          {/* D6-01: the clear-all moved OUT of the sidebar footer into the
              Einstellungen Daten danger zone, behind a type-to-confirm word. */}
          <div className="nav-foot-meta">
            Lean v3
            <br />
            Tel/Mail/LinkedIn klickbar. Zeile anklicken zum Eintragen.
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="head">
          <div>
            <h1>{headTitle}</h1>
          </div>
          <div className="sub">{companies.length} Firmen</div>
        </div>

        {error ? (
          <div className="state-error" role="alert">
            <div className="state-h">{error}</div>
            <div className="state-b">
              Die lokale Datenbank ist nicht erreichbar. Starte die App neu; bleibt
              der Fehler, prüfe die Datenbankdatei.
            </div>
          </div>
        ) : loading ? (
          <div className="state-loading">Lädt…</div>
        ) : view === "focus" ? (
          <FocusView
            snapshot={focusSnapshot}
            contactsByFirma={contactsByFirma}
            interactionsByFirma={interactionsByFirma}
            bearbeiter={bearbeiter}
            onSaveAndNext={handleFocusSave}
            onSkip={handleFocusSkip}
            onClose={handleCloseFocus}
          />
        ) : view === "settings" ? (
          <Einstellungen
            bearbeiter={bearbeiter}
            onSaveBearbeiter={handleSaveBearbeiter}
            stillgelegte={stillgelegte}
            onClearAll={handleClearAll}
          />
        ) : (
          <CompanyTable
            companies={companies}
            deletedCompanies={deletedCompanies}
            interactionsByFirma={interactionsByFirma}
            contactsByFirma={contactsByFirma}
            bearbeiter={bearbeiter}
            onOpenRow={handleOpenRow}
            onSave={handleSave}
            onAddCompany={handleAddCompany}
            onEditCell={handleEditCell}
            onEditNote={handleEditNote}
            onDeleteCompany={handleDeleteCompany}
            onRestoreCompany={handleRestoreCompany}
            onPermanentDelete={handlePermanentDelete}
            onAddContact={handleAddContact}
            onUpdateContact={handleUpdateContact}
            onDeleteContact={handleDeleteContact}
            onSetContactEmails={handleSetContactEmails}
            onOpenFocus={handleOpenFocus}
            onImport={handleImport}
          />
        )}
      </main>

      {importDialog && (
        <ImportDialog
          mode={importDialog.mode}
          rows={importDialog.rows}
          onConfirm={handleConfirmImport}
          onClose={() => setImportDialog(null)}
        />
      )}
    </div>
  );
}

export default App;
