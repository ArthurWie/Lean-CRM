# Handover: ClickWise CRM (Lean Rebuild)

Dieses Paket ist die komplette Übergabe für den Neubau des ClickWise-CRM in einem **frischen Projekt**.
Alles, was du brauchst, liegt hier drin. Der alte Vault/das alte Projekt werden nicht übernommen.

## Inhalt

- **`HANDOFF-clickwise-crm.md`** — die Spezifikation: Vision, die zwei Oberflächen, Datenmodell,
  Lead-Finding, Architektur (Tauri-Desktop, SQLite, ORM), Look, v1-Umfang. **Das ist das Hauptdokument.**
- **`lean-crm-mockup.html`** — das klickbare visuelle Ziel (Datenbank + Fokus + CSV-Import).
  Einfach im Browser öffnen.
- **`lead-hunter/SKILL.md`** — der Claude-Code-Skill, der Leads recherchiert und eine import-fertige
  CSV schreibt.
- **`leads-beispiel.csv`** — das CSV-Importformat als Vorlage + Testdatei (enthält bewusst ein
  Duplikat und eine tote Firma, um Dedupe und Dead-Company-Guard zu zeigen).
- **`leads-book1.csv`** — dein bestehender Excel-Bestand (39 Firmen), bereits ins CSV-Format
  konvertiert, zum Erst-Import.

## Schritte im neuen Projekt

1. Frisches Projekt/Repo anlegen.
2. Inhalt dieses Ordners hineinkopieren. Den Ordner `lead-hunter/` nach `.claude/skills/` legen,
   dann ist der Skill als `/lead-hunter` verfügbar.
3. `/gsd-new-project` starten und `HANDOFF-clickwise-crm.md` als Grundlage angeben.
4. App bauen. Danach `leads-book1.csv` importieren, um mit deinen echten Firmen zu starten.

## Nach dem Erst-Import von `leads-book1.csv` manuell prüfen

Drei Firmen sind in der `notiz`-Spalte markiert und gehören NICHT in den Anruf-Pool:

- **Chapter 4 GmbH** → "ACHTUNG: Nummer existiert nicht" → auf **Tot** setzen.
- **Milestones in Communication** → "ACHTUNG: Insolvenz" → auf **Tot/Geparkt** setzen.
- **Verlag Österreich GmbH** → "GEPARKT" → auf **Geparkt** setzen.

(Auf einer leeren DB greift der Dead-Company-Guard noch nicht, weil es keine bestehenden Einträge zum
Abgleichen gibt. Danach schützt er vor versehentlichem Re-Import.)
