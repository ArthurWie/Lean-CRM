// CSV import data layer (IMPORT-01..07 / D-01..D-09).
//
// Two clearly separated sections:
//
//  1. PURE helpers — normalizers, the email tokenizer, the header validator, the
//     lessons merge, the match cascade, and the classifier. Per the derive.ts /
//     filterSort.ts purity gate, this section imports ONLY types: it builds no
//     SQL and must NEVER import drizzle-orm or ../db/{client,schema}. It is
//     unit-tested in isolation against the literal lead-hunter CSV names.
//
//  2. IMPURE writer — importCsv + clearAllData (below). That section is the ONLY
//     part of this file that touches drizzle/schema (DATA-02 data-layer write).
//
// The two real phase landmines live in the writer section: NO db.transaction()
// (sqlite-proxy/pool — see companies.ts), and NO interaktionen row on import so
// deriveStatus stays "Neu" (IMPORT-07 / D-01).

// --- Pure section: type-only imports (purity gate) ---------------------------

/**
 * The frozen 13-column lead-hunter CSV schema, in order (IMPORT-01 / D-06).
 * The sole interface between lead-finding and the app; the header validator
 * checks an incoming file against this verbatim.
 */
export const HEADER = [
  "unternehmen",
  "fn",
  "branche",
  "groesse",
  "website",
  "ansprechpartner",
  "rolle",
  "telefon",
  "email",
  "linkedin",
  "lessons",
  "quelle",
  "notiz",
] as const;

/** A parsed CSV row keyed by the 13-column header (papaparse header:true shape). */
export type RawRow = Record<(typeof HEADER)[number], string>;

/**
 * A dedupe candidate: the minimal normalizable fields + the status the
 * classifier reads for D-04 (Tot → nicht-kontaktieren). Existing DB companies
 * are mapped into this shape; rows accepted earlier in the run are appended
 * (D-03), so matchCompany compares against existing ∪ accepted.
 */
export type Candidate = {
  name: string;
  status: string;
  fn: string;
  website: string;
};

/** The classification of one row plus its human reason (D-05 itemized report). */
export type RowKind = "neu" | "duplikat" | "nicht-kontaktieren" | "fehlerhaft";
export type ClassifiedRow = {
  row: RawRow;
  kind: RowKind;
  reason: string;
  /** The matched candidate (for duplikat / nicht-kontaktieren); null otherwise. */
  match: Candidate | null;
};

// Legal-form tokens stripped from the trailing position of a normalized name
// (D-02). Ordered LONGEST-FIRST so "gmbh & co kg" strips before "gmbh" and the
// multi-word "gesellschaft m b h" strips before "m b h". Punctuation is already
// collapsed to spaces by normName before this list is consulted, so the tokens
// are written in their post-collapse (space-separated, no dots) form.
const LEGAL_FORMS = [
  "gesellschaft m b h",
  "gmbh co kg", // "GmbH & Co. KG" → "&"/"."→space → "gmbh co kg"
  "ges m b h",
  "m b h",
  "gesmbh",
  "mbh",
  "gmbh",
  "ag",
  "kg",
  "og",
];

/**
 * Validate a parsed header against the frozen 13-column schema (IMPORT-01 / D-06).
 * Exact length + exact order; a wrong/short/reordered header is rejected, as is
 * a duplicate column (papaparse renames a 2nd "notiz" to "notiz_1", so the
 * exact-match check fails it — the desired "wrong file" rejection). The caller
 * MUST strip a leading UTF-8 BOM before validating: a "﻿unternehmen" first
 * column does not equal "unternehmen" and is (correctly) rejected here.
 */
export function validateHeader(fields: string[] | undefined): boolean {
  if (!fields || fields.length !== HEADER.length) return false;
  return HEADER.every((h, i) => fields[i] === h);
}

/**
 * Split a semicolon-separated email cell into trimmed, non-empty tokens
 * (IMPORT-02 / D-09). Extends contacts.ts:cleanEmails with the leading ";"
 * split. "a@x.at;b@x.at;" → ["a@x.at","b@x.at"]; "" / undefined → [].
 */
export function tokenizeEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Normalize a Firmenbuchnummer for comparison (IMPORT-03): strip a leading
 * "FN " prefix and whitespace, lowercase. "FN 123456a" → "123456a". An empty
 * FN normalizes to "" and (in matchCompany) falls through to the next rung.
 */
export function normFn(s: string): string {
  return s.replace(/^fn\s*/i, "").trim().toLowerCase();
}

/**
 * Normalize a website to a bare host for comparison (IMPORT-03): lowercase,
 * strip protocol, leading "www.", and any path/query/fragment.
 * "https://www.x.at/de?q=1" → "x.at". Empty → "".
 */
export function normDomain(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
}

/**
 * Normalize a company name for legal-form-insensitive comparison (D-02):
 * lowercase, collapse punctuation (".,&+-/") and whitespace to single spaces,
 * then strip ONE trailing legal-form token (LEGAL_FORMS, longest-first). So
 * "Himmelhoch GmbH" === normName("Himmelhoch"), while "Trauner Verlag GmbH" and
 * "Trauner Verlag + Buchservice GmbH" stay distinct (different descriptive stem).
 */
export function normName(s: string): string {
  let n = s
    .toLowerCase()
    .replace(/[.,&+/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const f of LEGAL_FORMS) {
    if (n === f) {
      n = "";
      break;
    }
    if (n.endsWith(" " + f)) {
      n = n.slice(0, n.length - f.length).trim();
      break;
    }
  }
  return n.replace(/\s+/g, " ").trim();
}

/**
 * Merge the CSV `lessons` and `notiz` columns into firmen.lessons (D-01): join
 * the non-empty trimmed values with " — "; `quelle` is never referenced; return
 * null when both are empty. ("","ACHTUNG…") → "ACHTUNG…"; ("a","b") → "a — b".
 */
export function mergeLessons(
  lessons: string | undefined,
  notiz: string | undefined,
): string | null {
  const parts = [lessons?.trim(), notiz?.trim()].filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

/**
 * Whether a row should produce a kontakte row (D-09): true iff ANY of
 * ansprechpartner / rolle / telefon / linkedin / email is non-empty. A row with
 * only unternehmen/branche/groesse (common in book1) produces no contact.
 */
export function hasAnyContactField(r: RawRow): boolean {
  return Boolean(
    r.ansprechpartner.trim() ||
      r.rolle.trim() ||
      r.telefon.trim() ||
      r.linkedin.trim() ||
      r.email.trim(),
  );
}

/**
 * Match a row against candidates by the FN → domain → name cascade (IMPORT-03 /
 * D-03). Each rung is tried in order; a positive match at an earlier rung wins
 * and stops the cascade. An empty value on EITHER side of a rung is skipped (it
 * falls through to the next rung) so two empty FNs never "match". Returns the
 * matched candidate (so the caller can read its status for D-04) or null.
 */
export function matchCompany(
  r: RawRow,
  candidates: readonly Candidate[],
): Candidate | null {
  const fn = normFn(r.fn);
  if (fn) {
    const hit = candidates.find((c) => normFn(c.fn) === fn);
    if (hit) return hit;
  }
  const domain = normDomain(r.website);
  if (domain) {
    const hit = candidates.find((c) => normDomain(c.website) === domain);
    if (hit) return hit;
  }
  const name = normName(r.unternehmen);
  if (name) {
    const hit = candidates.find((c) => normName(c.name) === name);
    if (hit) return hit;
  }
  return null;
}

/**
 * Classify every row as neu | duplikat | nicht-kontaktieren | fehlerhaft
 * (D-04 / D-05 / D-07), threading an accumulating accepted list (D-03):
 * - empty/whitespace unternehmen → fehlerhaft "leerer Firmenname" (never reaches
 *   the writer, D-07 — so addCompany's empty-name guard is never tripped);
 * - match to a Tot company → nicht-kontaktieren (the ONLY loud category, D-04);
 * - any other match (active OR Geparkt) → duplikat (D-04: Geparkt is NOT loud);
 * - within-file repeat → duplikat "bereits in dieser Datei" (first wins, D-03);
 * - otherwise → neu, and the row is appended to the accepted list as a candidate
 *   so later identical rows in the same file dedupe against it.
 */
export function classifyRows(
  rows: readonly RawRow[],
  existing: readonly Candidate[],
): ClassifiedRow[] {
  const accepted: Candidate[] = [];
  const out: ClassifiedRow[] = [];

  for (const r of rows) {
    if (!r.unternehmen.trim()) {
      out.push({ row: r, kind: "fehlerhaft", reason: "leerer Firmenname", match: null });
      continue;
    }

    const dbHit = matchCompany(r, existing);
    if (dbHit) {
      if (dbHit.status === "Tot") {
        out.push({
          row: r,
          kind: "nicht-kontaktieren",
          reason: "als Tot markiert — nicht kontaktieren",
          match: dbHit,
        });
      } else {
        out.push({ row: r, kind: "duplikat", reason: "bereits vorhanden", match: dbHit });
      }
      continue;
    }

    const runHit = matchCompany(r, accepted);
    if (runHit) {
      out.push({
        row: r,
        kind: "duplikat",
        reason: "bereits in dieser Datei",
        match: runHit,
      });
      continue;
    }

    accepted.push({
      name: r.unternehmen,
      status: "Neu",
      fn: r.fn,
      website: r.website,
    });
    out.push({ row: r, kind: "neu", reason: "neu", match: null });
  }

  return out;
}
