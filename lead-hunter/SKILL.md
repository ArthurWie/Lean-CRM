---
name: lead-hunter
description: "Findet B2B-Leads in einer Nische (Österreich/DACH) mit allen Kerndaten und schreibt eine import-fertige CSV für das ClickWise-CRM. Aufrufen mit Nische + Anzahl + optional Region, z.B. 'PR-Agenturen Wien, 20 Stück'."
allowed-tools:
  - WebSearch
  - WebFetch
  - Write
  - Read
---

# Lead-Hunter

## Zweck

Du findest für ClickWise (Verkäufer von Security-Awareness / IT-Sicherheit) neue B2B-Leads in
**einer** Nische und schreibst sie als **import-fertige CSV** für das schlanke CRM. Du recherchierst
nur die **Kerndaten**, die zum Erstkontakt (meist Telefon) nötig sind. Keine Deep-Research, kein
Scoring-Apparat, keine ICP-Rubrik. Schlank rein, anrufen kann der Mensch.

Die CSV ist die einzige Schnittstelle zur App. Halte das Format exakt ein.

## Eingabe

Beim Aufruf nennt der Nutzer:
- **Nische / Branche** (genau eine pro Lauf), z.B. "PR-Agenturen", "Stadtwerke", "Lebensmittelproduzenten".
- **Anzahl** gewünschter Leads (z.B. 20).
- **Region** (optional, Default Österreich / Wien-Umkreis).

Fehlt etwas, frag in einem Satz nach. Halte **eine Nische pro Lauf** (ein Batch = eine Branche).

## Vorgehen

1. **Dedupe-Liste laden (zuerst).** Wenn der Nutzer eine Export-Datei der bekannten CRM-Firmen nennt
   (z.B. `crm-known.csv` mit Spalten `unternehmen, fn, website, status`), lies sie zur Laufzeit. Halte
   daraus eine Sperrliste und gleiche jeden Kandidaten dagegen ab über: **FN-Nummer**, **Domain** und
   **normalisierten Firmennamen** (klein, ohne Rechtsform-Suffix wie GmbH / Ges.m.b.H. / & Co KG). Ein
   Treffer auf irgendeines davon = bekannt. Firmen mit `status` = `tot`/`geparkt`/"nicht kontaktieren"
   **niemals** wieder aufnehmen. Gibt es keine Datei, weiter, dann macht die App das Dedupe beim Import.
   **Wichtig: diese Liste niemals in den Skill schreiben.** Der Skill bleibt statisch und kurz; die
   bekannten Firmen kommen ausschließlich aus der externen Datei zur Laufzeit.
2. **Sourcing.** Über WebSearch echte Firmen der Nische in der Region finden (Branchenverzeichnisse,
   Herold, Firmenlisten, Verbände, LinkedIn). Sammle Kandidaten bis zur gewünschten Anzahl. Kandidaten,
   die auf der Sperrliste stehen, sofort verwerfen.
3. **Österreich-Identitätscheck (je Firma, ~2 Min, [DESK]).** Cheap, aber wertvoll:
   - **Impressum** der Website öffnen: exakter registrierter Firmenname + **FN-Nummer** + Registergericht.
     Der Handelsname weicht oft vom Rechtsnamen ab (Impressum gewinnt).
   - **evi.gv.at (Firmenbuch)** mit der FN prüfen: (a) aktuell registrierte/r **Geschäftsführer/in** als
     `ansprechpartner`, (b) **Insolvenzstatus** — ein laufendes/jüngst eröffnetes Insolvenzverfahren ist
     ein **sofortiger Ausschluss** (nicht in die CSV; im Bericht nennen). Die FN kommt ins `fn`-Feld und
     ist später der eindeutige Dedupe-Schlüssel.
   - Bei Nicht-AT-Firmen entfällt der Firmenbuch-Schritt; FN bleibt leer.
4. **Kerndaten je Firma** zusammentragen:
   - `unternehmen` — registrierter Firmenname (aus Impressum).
   - `fn` — Firmenbuchnummer, z.B. "FN 208959v". Leer wenn nicht-AT oder nicht auffindbar.
   - `branche` — die Nische, einheitlich für den Batch.
   - `groesse` — Mitarbeiter/Seats grob, als Bereich erlaubt ("~30–40"). Siehe Qualitätsregeln.
   - `website` — Domain ohne https, z.B. "beispiel.at".
   - `ansprechpartner` — die relevante Person, meist die per Firmenbuch bestätigte GF. Voller Name.
   - `rolle` — z.B. "Geschäftsführer", "Prokuristin", "IT-Leitung".
   - `telefon` — Hauptnummer im Format "+43 1 234 56 78". **Wichtigstes Feld**, hartnäckig suchen.
   - `email` — wenn auffindbar (office@, oder personenbezogen). **Mehrere Adressen mit Semikolon
     trennen** (kein Komma), z.B. `office@x.at;gf@x.at`. Sonst leer lassen.
   - `linkedin` — Profil-Pfad der Person, z.B. "in/max-mustermann", oder leer.
   - `lessons` — bleibendes Wissen/Argument; bei frischen Leads i.d.R. leer.
   - `quelle` — wo gefunden (kurz, z.B. "Herold", "PRVA-Mitgliederliste").
   - `notiz` — optional ein kurzer Hinweis (z.B. "GF auch IT-Verantwortlicher"), sonst leer.
5. **CSV schreiben** (siehe Format) und Pfad melden. Kurz zusammenfassen: wie viele Leads, wie viele
   mit Telefon, wie viele mit Email/LinkedIn, wie viele wegen Insolvenz oder Sperrliste ausgelassen,
   was fehlt.

## CSV-Format (exakt einhalten)

- UTF-8, Kopfzeile zuerst, **genau diese Spalten in dieser Reihenfolge**:

```
unternehmen,fn,branche,groesse,website,ansprechpartner,rolle,telefon,email,linkedin,lessons,quelle,notiz
```

- Eine Zeile = eine Firma mit ihrem primären Kontakt.
- `fn` (Firmenbuchnummer) ist der eindeutige Schlüssel fürs Dedupe beim Import. Leer lassen wenn nicht-AT.
- `lessons` = bleibendes Wissen/Argument zur Firma. Bei frisch recherchierten Leads normalerweise **leer**
  (entsteht erst durch Gespräche). Nur befüllen, wenn die Recherche etwas Dauerhaftes ergibt.
- Felder mit Komma, Anführungszeichen oder Zeilenumbruch in `"..."` setzen; enthaltene `"` verdoppeln.
- `email` darf mehrere Adressen enthalten, **mit Semikolon getrennt** (z.B. `office@x.at;gf@x.at`).
- Unbekannte Felder **leer** lassen (nicht "n/a", nicht raten). Telefon und Email niemals erfinden.
- Status, Bearbeiter, Datum **nicht** in die CSV: die setzt die App beim Import (Status "Neu").
- Dateiname: `leads-<nische>-<JJJJ-MM-TT>.csv`, z.B. `leads-pr-agenturen-2026-06-17.csv`.

Beispielzeile:
```
"Demner, Merlicek & Bergmann",FN 71006a,Werbeagentur,~100–110,dmb.at,Jürgen Vanicek,Geschäftsführer,+43 1 588 46-0,empfang@dmb.at,in/juergen-vanicek,,Herold,
```

## Qualitätsregeln

- **Telefonnummer hat Vorrang.** Eine Firma ohne Nummer ist fast wertlos für den Cold Call. Such die
  Nummer hartnäckig (Impressum, Kontaktseite, Herold). Notfalls aufnehmen, aber im `notiz`-Feld
  "Telefon fehlt" vermerken.
- **Zahlen ehrlich.** Mitarbeiterzahl/Größe ist oft geschätzt. Schreib einen Bereich, rate nicht
  präzise. Wenn unklar, grob halten ("~50–80") statt falscher Genauigkeit.
- **Nichts erfinden.** Lieber leer als falsch. Keine erfundenen Mails, Namen, Nummern.
- **Eine Nische pro Batch.** Vermisch keine Branchen in einer CSV.
- **Erreichbare Entscheider bevorzugen.** Kleinere/mittlere Firmen, wo der GF direkt ans Telefon
  geht, sind wertvoller als Konzerne mit eigener Security-Abteilung.

## Nische-Hinweise (ClickWise-spezifisch)

- Für **Medien/Kommunikation/Agenturen** ist NIS2 **kein** Aufhänger. Dort zählt Phishing-Risiko /
  Datenschutz (DSGVO), nicht NIS2. Vermerk das ggf. kurz in `notiz`, wenn relevant.
- Für **Energie/Versorger/Wasser** ist NIS2 sehr wohl ein Treiber.
- Konzerne mit erkennbar eigenem Security-Team eher auslassen (geringe Chance).
