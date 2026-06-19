// End-to-end render proof for the walking skeleton: seed the DB on first launch,
// then read companies back through the thin data layer and render their NAMES.
// App.tsx imports the data layer ONLY — never drizzle or the schema (DATA-02).
// The styled Excel table is Plan 02.
import { useEffect, useState } from "react";
import { listCompanies, seedIfEmpty, type Company } from "./data/companies";

function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await seedIfEmpty();
        setCompanies(await listCompanies());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <main>
      <h1>ClickWise CRM</h1>
      {error && <p role="alert">DB error: {error}</p>}
      <ul>
        {companies.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
    </main>
  );
}

export default App;
