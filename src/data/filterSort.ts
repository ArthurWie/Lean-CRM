// Pure filter + sort for the company table (DB-04 / DB-08, D-10/D6-07/D-12).
//
// View-only transform over already-loaded data: the search string never reaches
// SQL (T-02-INJ accepted — pure in-memory String.includes). Mirrors derive.ts'
// purity gate: this module imports ONLY types, NEVER drizzle/db/schema.
//
// - filterCompanies: UNCONDITIONALLY drops Tot/Geparkt rows (D6-07 — those now
//   live only in the Einstellungen "Stillgelegte Firmen" tab), then applies a
//   case-insensitive search over name + branche + contact name (D-10; NOT
//   notes/lessons). The dead-row TOGGLE (former D-11) is gone — exclusion is
//   no longer user-controllable.
// - sortCompanies: 🔥-first, then alphabetical by name in German locale (D-12).
// - visibleCompanies: composes filter → sort (the single call the table uses).
import type { Company, Contact } from "./companies";
import type { Status } from "../types";

// The two manual-override statuses that never appear in the active list.
// Lives here (the filter authority) and is imported by the table + the
// Einstellungen Stillgelegte tab.
export const DEAD = new Set<Status>(["Tot", "Geparkt"]);

export type FilterOptions = {
  search: string;
};

/**
 * Filter the company set (D6-07 unconditional dead-exclusion + D-10 search, ANDed).
 * - Tot/Geparkt rows are ALWAYS dropped from the active list (no toggle).
 * - A non-empty (trimmed) query matches case-insensitively against the company
 *   name, branche, and any contact name in contactsByFirma — never notes/lessons.
 * Returns a new array; the input is not mutated.
 */
export function filterCompanies(
  companies: readonly Company[],
  contactsByFirma: Record<string, Contact[]>,
  { search }: FilterOptions,
): Company[] {
  const q = search.trim().toLowerCase();
  return companies.filter((c) => {
    if (DEAD.has(c.status as Status)) return false; // D6-07: always exclude
    if (!q) return true; // D-10: empty query matches all
    const ap = (contactsByFirma[c.id] ?? [])
      .map((k) => k.name ?? "")
      .join(" ");
    return (
      c.name.toLowerCase().includes(q) ||
      (c.branche ?? "").toLowerCase().includes(q) ||
      ap.toLowerCase().includes(q)
    );
  });
}

/**
 * Sort 🔥-first then alphabetically by name (D-12).
 * Hot (`heiss`) companies precede non-hot ones; within each group rows are ordered
 * by `name.localeCompare(other, "de")` so ä/ö/ü/ß collate correctly. Returns a new
 * array; the input is not mutated.
 */
export function sortCompanies(companies: readonly Company[]): Company[] {
  return [...companies].sort((a, b) => {
    if (a.heiss !== b.heiss) return a.heiss ? -1 : 1; // 🔥 first
    return a.name.localeCompare(b.name, "de"); // then A→Z (German)
  });
}

/**
 * The single view transform the table renders: filter (unconditional dead-exclusion
 * + search) then 🔥-first German-alpha sort, over the already-loaded set.
 */
export function visibleCompanies(
  companies: readonly Company[],
  contactsByFirma: Record<string, Contact[]>,
  options: FilterOptions,
): Company[] {
  return sortCompanies(filterCompanies(companies, contactsByFirma, options));
}
