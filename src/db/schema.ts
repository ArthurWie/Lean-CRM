// Drizzle SQLite schema — all 5 tables (DATA-03/04).
// Column names stay compatible with the lead-hunter CSV schema:
//   unternehmen→firmen.name, fn, branche, groesse, website, lessons,
//   ansprechpartner→kontakte.name, rolle, telefon, linkedin,
//   email→kontakt_mails.email, notiz→interaktionen.notiz.
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const firmen = sqliteTable("firmen", {
  id: text("id").primaryKey(), // UUID (crypto.randomUUID)
  name: text("name").notNull(),
  fn: text("fn"), // Firmenbuchnummer
  branche: text("branche"),
  groesse: text("groesse"), // free text e.g. "~37"
  status: text("status").notNull().default("Neu"), // Phase 1: static seed value, NOT derivation
  heiss: integer("heiss", { mode: "boolean" }).notNull().default(false),
  website: text("website"),
  lessons: text("lessons"),
  created_at: text("created_at").notNull(), // UTC ISO-8601
  updated_at: text("updated_at").notNull(), // UTC ISO-8601, set in data layer
});

export const kontakte = sqliteTable("kontakte", {
  id: text("id").primaryKey(),
  firma_id: text("firma_id")
    .notNull()
    .references(() => firmen.id),
  name: text("name"),
  rolle: text("rolle"),
  telefon: text("telefon"),
  linkedin: text("linkedin"),
  li_angenommen: integer("li_angenommen", { mode: "boolean" })
    .notNull()
    .default(false),
  relevant: integer("relevant", { mode: "boolean" }).notNull().default(false),
});

// DATA-04: many emails per contact.
export const kontakt_mails = sqliteTable("kontakt_mails", {
  id: text("id").primaryKey(),
  kontakt_id: text("kontakt_id")
    .notNull()
    .references(() => kontakte.id),
  email: text("email").notNull(),
});

export const interaktionen = sqliteTable("interaktionen", {
  id: text("id").primaryKey(),
  firma_id: text("firma_id")
    .notNull()
    .references(() => firmen.id),
  kontakt_id: text("kontakt_id").references(() => kontakte.id),
  datum: text("datum").notNull(), // UTC ISO
  kanal: text("kanal"), // Telefon/E-Mail/LinkedIn
  outcome: text("outcome"),
  notiz: text("notiz"),
  bearbeiter: text("bearbeiter").notNull().default("Arthur"),
});

export const followups = sqliteTable("followups", {
  id: text("id").primaryKey(),
  firma_id: text("firma_id")
    .notNull()
    .references(() => firmen.id),
  faellig_am: text("faellig_am").notNull(), // UTC ISO date
  grund: text("grund"),
  erledigt: integer("erledigt", { mode: "boolean" }).notNull().default(false),
});
