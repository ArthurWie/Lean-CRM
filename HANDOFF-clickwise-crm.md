# Handoff-Brief: ClickWise CRM (Lean Rebuild)

> Dieses Dokument bündelt Vision, Anforderungen und Architektur für den Neubau des ClickWise-CRM
> in einem **frischen Projekt**. Es ist die Grundlage für `/gsd-new-project`. Selbsterklärend gehalten,
> das neue Projekt hat den alten Vault-Kontext nicht.
>
> Begleitende Artefakte im selben Ordner: `lean-crm-mockup.html` (visuelles Ziel, klickbar),
> `lead-hunter/SKILL.md` (Lead-Recherche-Skill), `leads-beispiel.csv` (Import-Format + Testdatei).

---

## 1. Worum es geht

Ein schlankes Vertriebs-CRM für **eine** Person (Arthur), die per Cold Call und Follow-up Kunden für
ClickWise (Security-Awareness / IT-Sicherheit) gewinnt. Der Vorgänger war über mehrere Milestones zu
einer Research-Plattform angewachsen (3D-Wissensgraph, Insights-Dashboard, Dossiers, Sequences-Editor,
Obsidian-Vault) und wurde als overengineered verworfen. Dieser Neubau ist die radikale Vereinfachung.

**Der echte Use Case sind zwei Dinge:**
1. Leads finden, nur die Kerndaten (kein tiefes Research-Gerüst).
2. Sauberer Überblick über kontaktierte Firmen: wen angesprochen, was gesagt, was gelernt; keine
   Antwort = dokumentieren und weiter; nie ein Follow-up vergessen.

---

## 2. Die zwei Oberflächen

### A. Datenbank (Heimat, Startansicht)
Eine Excel-artige Tabelle über alle Firmen. Spalten:
`Unternehmen · Branche · Größe · Ansprechpartner · Kontakt · Status · Nächster Schritt · Notizen · Lessons learned`

- **Kontakt-Spalte:** klickbare Felder **Tel · Mail · in** (Anruf via `tel:`, Outlook via `mailto:`,
  LinkedIn-Profil). Hover zeigt die jeweilige Adresse. Ausgegraut, wenn nichts hinterlegt.
- **Heiß-Markierung:** kleine 🔥 rechts neben dem Firmennamen, sortiert die Firma nach oben. Wird beim
  Loggen gesetzt (nicht vorab), wenn jemand am Telefon begeistert war.
- **Notizen-Spalte:** zeigt die neueste Gesprächsnotiz mit Datum + Kanal; blauer Punkt = neu seit
  letztem Blick. Volle Historie im aufklappbaren Zeilen-Detail.
- **Zeile anklicken** klappt darunter ein Eintrag-Panel auf (Ansprechpartner, Verlauf, Logging). Das
  ersetzt eine separate Detailseite.
- Sticky erste Spalte, horizontales Scrollen, Gitterlinien. Tote/geparkte Firmen ausgegraut, per Filter
  ausblendbar. Knöpfe: "+ Neue Firma", "CSV importieren".

### B. Fokus (Durchböller-Modus)
Eine Firma groß und allein im Fenster, zum Abarbeiten vieler Calls hintereinander ohne Ablenkung.
- Name (mit 🔥 wenn heiß), klein Branche + Größe, eine Zeile **warum jetzt dran** (z.B. "Rückruf war
  vereinbart", "frischer Lead").
- **Großer Telefon-Button** (ein Klick ruft an), Mail/LinkedIn klein daneben.
- **Notizen (zuletzt)** als Kontext + **Lessons learned**, damit das Argument vor dem Wählen parat ist.
- Dokumentieren wie in der Datenbank.
- Unten "Speichern & weiter" und "Überspringen". Zähler "Firma X von Y". Am Ende ein Abschluss-Screen.
- **Kein Datums-/Terminkalender-Charakter.** Das Tool reicht die nächste Firma automatisch (heiße
  zuerst), der Nutzer sortiert nichts. Fällige Follow-ups tauchen einfach hier im Strom wieder auf.

### Logging (an beiden Orten gleich, der zentrale Handgriff)
Kanal wählen (Telefon/E-Mail/LinkedIn) → Outcome wählen → ein Satz Notiz → optional Follow-up →
optional 🔥. **Die Outcomes hängen vom Kanal ab:**
- Telefon: Gesprochen · Nicht erreicht · Rückruf vereinbart · Warteschlange · Termin vereinbart · Kein Interesse
- E-Mail: Gesendet · Antwort erhalten · Keine Antwort · Termin vereinbart · Kein Interesse
- LinkedIn: Anfrage gesendet · Angenommen · Nachricht gesendet · Geantwortet · Kein Interesse

**Aus einem Logging leitet die App automatisch ab:** Status, letzter Kontakt, Notiz (mit Datum/Kanal/
Bearbeiter), Nächster Schritt und (falls Follow-up gesetzt) den Wiedervorlage-Eintrag. Ein Satz tippen,
fünf Felder gefüllt. Das ist der Kern-Mehrwert gegenüber Excel.

---

## 3. Datenmodell

Vier Tabellen (SQLite):

```
firmen        (id, name, fn, branche, groesse, status, heiss, website, lessons, created_at, updated_at)
kontakte      (id, firma_id, name, rolle, telefon, linkedin, li_angenommen, relevant)
kontakt_mails (id, kontakt_id, email)        -- ein Kontakt kann mehrere Mails haben
interaktionen (id, firma_id, kontakt_id, datum, kanal, outcome, notiz, bearbeiter)
followups     (id, firma_id, faellig_am, grund, erledigt)
```

**Mehrere E-Mails pro Kontakt** sind erlaubt (Office, IT, GF), daher die eigene Tabelle `kontakt_mails`.
In der UI wird pro Adresse ein Mail-Link gezeigt. Im Import-CSV stehen mehrere Mails im `email`-Feld
mit **Semikolon** getrennt (`office@x.at;gf@x.at`).

- **Status** (abgeleitet aus dem letzten Outcome, nie von Hand gesetzt):
  `Neu · Offen · Im Gespräch · Termin · Kein Interesse · Tot/Geparkt`.
  - Neu = nie kontaktiert. Offen = versucht / wartet auf Antwort. Im Gespräch = mit der richtigen Person
    gesprochen, Dialog läuft. Termin = Termin/Angebot vereinbart (Ziel). Kein Interesse = abgelehnt.
    Tot = nicht kontaktierbar / "nicht kontaktieren". Geparkt = bewusst später.
- **`heiss`** = die Reaktions-Markierung (🔥), gesetzt beim Loggen. Kein vorab vergebener hot/warm/cold-Score.
- **`bearbeiter`** = wer den Kontakt gemacht hat (eigene Spalte, nicht im Notiztext). Solange allein:
  immer "Arthur". Brücke zum späteren Team.
- **Notizen** = die `interaktionen`-Einträge (laufendes Protokoll). **Lessons learned** = das bleibende
  Wissen pro Firma (eigenes Feld, ändert sich selten).
- IDs als UUID/Text, Zeitstempel UTC + `updated_at` (Grundlage für späteren Team-Sync).

---

## 4. Lead-Finding (außerhalb der App)

Die App stößt **selbst keine Recherche** an. Lead-Finding ist eine Claude-Session-Aufgabe über den
Skill `lead-hunter` (siehe `lead-hunter/SKILL.md`), dessen Ausgabe eine import-fertige CSV ist.

**CSV-Format (Skill schreibt, App importiert, exakt einhalten):**
```
unternehmen,fn,branche,groesse,website,ansprechpartner,rolle,telefon,email,linkedin,lessons,quelle,notiz
```
Eine Zeile = eine Firma mit primärem GF-Kontakt. `email` darf mehrere Adressen mit **Semikolon**
enthalten (`office@x.at;gf@x.at`). `lessons` ist bei frischen Leads leer (entsteht erst durch Gespräche),
wird aber bei der Migration des Excel-Bestands befüllt. Status/Bearbeiter/Datum setzt die App beim Import.

**Der Skill** sourct eine Nische (ein Batch = eine Branche), macht den österreichischen
Firmenbuch-Check (Impressum → evi.gv.at: FN, bestätigte/r GF, Insolvenz = Ausschluss), sammelt die
Kerndaten (Telefon hat Vorrang) und dedupliziert gegen eine **externe** Export-Datei der bekannten
Firmen. Die bekannte-Firmen-Liste steht nie im Skill, sondern kommt zur Laufzeit aus dieser Datei, so
bleibt der Skill kurz.

**Import-Regel in der App (maßgeblicher Schutz):** Beim CSV-Import matcht die App jede Zeile gegen
**alle** Firmen (Schlüssel: FN → Domain → normalisierter Name). Bei Treffer auf eine
**Tot/„nicht kontaktieren"**-Firma: überspringen und laut melden, nie neu anlegen, nie hochspülen
(Dead-Company-Guard). Bei sonstigem Treffer: überspringen (kein Duplikat). Bericht danach:
"X neu, Y übersprungen (davon Z nicht-kontaktieren)".

Es gibt **kein** Lead→Target mit Deep Research mehr. Eine Firma ist einfach "Neu" bis du sie anrufst.
Die alte `icp/`-, `markets/`-, `wiki/`-Maschinerie entfällt komplett.

---

## 5. Architektur & Technik

- **Desktop-App**, Empfehlung **Tauri** (React/TS-Frontend, schlank, SQLite dabei). Electron als Alternative.
- **Speicher: SQLite**, eine lokale Datei, hinter einer **dünnen Datenschicht** + **portablem ORM**
  (Drizzle oder Prisma). Der Rest der App kennt kein SQL. So ist ein späterer Wechsel auf Postgres
  (Team) billig: nur die Datenschicht/Verbindung tauschen.
- **`tel:` und `mailto:` über das Betriebssystem öffnen** (OS-Shell, nicht im eingebetteten Webview),
  damit Apple Continuity greift: Klick am Mac → Anruf über das iPhone (Voraussetzung im iPhone:
  "Anrufe auf anderen Geräten erlauben"). Arthur nutzt iPhone, also funktioniert das out of the box.
- **Backup:** die SQLite-Datei in einem synchronisierten Ordner (iCloud/Dropbox) genügt.

**Bewusst NICHT jetzt bauen** (Überengineering-Falle): Login, Rechte, Multi-User, Sync, Kalender-API.
Nur die Tür offen halten (ORM, UUIDs, `bearbeiter`, `updated_at`).

---

## 6. Look & Feel

Corporate / Excel-nah, nicht verspielt: kantige Ecken (2px), Tabellen-Gitterlinien, gedämpfte
Navy-Palette, Text-Buttons (Tel/Mail/in) statt Emoji-Icons. **Einzige Ausnahme: die 🔥-Flamme für
„heiß" bleibt** als Emoji, klein und dezent. Referenz: `lean-crm-mockup.html`.

---

## 7. v1-Umfang vs. später

**v1 (dieser Bau):** Datenbank-Tabelle (inkl. + Neue Firma, CSV-Import mit Dedupe/Guard), Fokus-Modus,
Logging mit Ableitung, Kontakt-Klickaktionen, Status/Heiß/Notizen/Lessons/Bearbeiter, SQLite.

**Später (nicht v1):** Kalender-Anbindung (.ics, dann evtl. volle Outlook-API), Team-Modus
(Postgres/Hosting/Login), eventuelle weitere Filter/Auswertungen. v1 nutzt allein den Fokus-Strom als
Erinnerung; Follow-ups werden gespeichert und spülen die Firma im Fokus wieder hoch.

---

## 8. Datenübernahme

Arthurs bestehendes Excel (~40 Medien/PR-Firmen) wird einmalig in das CSV-Format konvertiert und
importiert, damit der Start nicht bei null ist. Der alte Vault und `.crm/crm.json` werden archiviert,
nichts davon wird übernommen außer den reinen Firmendaten.

---

## 9. Mitgelieferte Artefakte (ins neue Projekt kopieren)

- `lean-crm-mockup.html` — klickbares visuelles Ziel (Datenbank + Fokus + Import).
- `lead-hunter/` — den Ordner nach `.claude/skills/` legen, dann als `/lead-hunter` verfügbar.
- `leads-beispiel.csv` — Import-Format und Testdatei (enthält bewusst ein Duplikat + eine tote Firma).
- Dieses Dokument als Eingabe für `/gsd-new-project`.
