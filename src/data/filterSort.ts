// Pure filter + sort for the company table (DB-04 / DB-08, D-10/11/12).
//
// View-only transform over already-loaded data: the search string never reaches
// SQL (T-02-INJ accepted — pure in-memory String.includes). Mirrors derive.ts'
// purity gate: this module imports ONLY types, NEVER drizzle/db/schema.
//
// - filterCompanies: dead-row toggle (D-11) stacked with case-insensitive search
//   over name + branche + contact name (D-10; NOT notes/lessons).
// - sortCompanies: 🔥-first, then alphabetical by name in German locale (D-12).
// - visibleCompanies: composes filter → sort (the single call the table uses).
import type { Company, Contact } from "./companies";
import type { Status } from "../types";

// The two manual-override statuses hidden unless the Tot/Geparkt toggle is on.
// Lives here (the filter authority) and is imported by the table.
export const DEAD = new Set<Status>(["Tot", "Geparkt"]);

export type FilterOptions = {
  search: string;
  showDead: boolean;
};

/**
 * Filter the company set (D-10 search + D-11 dead toggle, ANDed).
 * - showDead=false drops Tot/Geparkt rows; true keeps everything.
 * - A non-empty (trimmed) query matches case-insensitively against the company
 *   name, branche, and any contact name in contactsByFirma — never notes/lessons.
 * Returns a new array; the input is not mutated.
 */
export function filterCompanies(
  companies: readonly Company[],
  contactsByFirma: Record<string, Contact[]>,
  { search, showDead }: FilterOptions,
): Company[] {
  const q = search.trim().toLowerCase();
  return companies.filter((c) => {
    if (!showDead && DEAD.has(c.status as Status)) return false; // D-11 toggle
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
 * The single view transform the table renders: filter (search + dead toggle) then
 * 🔥-first German-alpha sort, over the already-loaded set.
 */
export function visibleCompanies(
  companies: readonly Company[],
  contactsByFirma: Record<string, Contact[]>,
  options: FilterOptions,
): Company[] {
  return sortCompanies(filterCompanies(companies, contactsByFirma, options));
}
