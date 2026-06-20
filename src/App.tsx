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
  markViewed,
  seedIfEmpty,
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
import { CompanyTable } from "./components/CompanyTable";
import type { LogEntry } from "./components/LogForm";
import "./App.css";

function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [interactionsByFirma, setInteractionsByFirma] = useState<
    Record<string, Interaction[]>
  >({});
  const [contactsByFirma, setContactsByFirma] = useState<
    Record<string, Contact[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await seedIfEmpty();
        setCompanies(await listCompanies());
      } catch (e) {
        console.error("Failed to load companies:", e);
        setError("Firmen konnten nicht geladen werden.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  // Addition 2: hard-delete a company (cascade) after the inline confirm, then
  // reload the list. CompanyTable already closed the detail panel for the deleted
  // row, and a delete failure leaves the panel closed but the row present (refresh
  // re-renders the still-existing company), surfacing the problem.
  async function handleDeleteCompany(firmaId: string) {
    try {
      await deleteCompany(firmaId);
      setCompanies(await listCompanies());
    } catch (e) {
      console.error("Failed to delete company:", e);
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" /> ClickWise
        </div>
        <button className="nav active" type="button">
          Datenbank
        </button>
        <button className="nav" type="button">
          Fokus
        </button>
        <div className="nav-foot">
          Lean v3
          <br />
          Tel/Mail/LinkedIn klickbar. Zeile anklicken zum Eintragen.
        </div>
      </aside>

      <main className="main">
        <div className="head">
          <div>
            <h1>Datenbank</h1>
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
        ) : (
          <CompanyTable
            companies={companies}
            interactionsByFirma={interactionsByFirma}
            contactsByFirma={contactsByFirma}
            onOpenRow={handleOpenRow}
            onSave={handleSave}
            onAddCompany={handleAddCompany}
            onEditCell={handleEditCell}
            onEditNote={handleEditNote}
            onDeleteCompany={handleDeleteCompany}
          />
        )}
      </main>
    </div>
  );
}

export default App;
