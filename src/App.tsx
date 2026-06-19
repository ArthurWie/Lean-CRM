// App shell: seed the DB on first launch, read companies back through the thin
// data layer, and render the sidebar + head + toolbar chrome around the
// CompanyTable. App.tsx imports the data layer ONLY — never drizzle or the
// schema (DATA-02). The table itself is CompanyTable (Plan 02).
import { useEffect, useState } from "react";
import { listCompanies, seedIfEmpty, type Company } from "./data/companies";
import { CompanyTable } from "./components/CompanyTable";
import "./App.css";

function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
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
          <CompanyTable companies={companies} />
        )}
      </main>
    </div>
  );
}

export default App;
