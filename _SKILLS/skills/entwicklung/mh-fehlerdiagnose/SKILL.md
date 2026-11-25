---
name: mh-fehlerdiagnose
description: Untersuche schwer greifbare Fehler und Performance-Rückschritte. Nutze den Skill, wenn etwas fehlschlägt, falsche Ergebnisse liefert oder unerwartet langsam ist.
---

# Fehlerdiagnose

Überspringe Schritte nur mit ausdrücklicher Begründung. Lies das Projektglossar (`GLOSSARY.md`, falls vorhanden) und relevante Architekturentscheidungen (ADRs), um die beteiligten Module einzuordnen.

**Sensible Daten schützen:** Ersetze Geheimnisse in gezeigten Befehlen, Ausgaben und Diagnoseartefakten durch `<REDACTED>`. Nutze Umgebungsvariablen statt Zugangsdaten im Befehl. Zitiere nur relevante Zeilen und prüfe besonders Logs, aufgezeichnete Requests und Authentifizierungs-Header.

## 1. Eine schnelle Rückmeldung herstellen

Baue zuerst eine Prüfung, die **genau beim gemeldeten Symptom** fehlschlägt. Ohne sie sind Codelektüre, Hypothesen und Messungen kein Ersatz für einen verlässlichen Nachweis.

Wähle den kürzesten geeigneten Weg:

- Ein fehlschlagender Unit-, Integrations- oder End-to-End-Test. Alternativ: eine Abfrage gegen den Entwicklungsserver, ein CLI-Aufruf mit Testdaten oder ein Browserskript.
- Eine bereinigte Aufzeichnung in isolierter Umgebung wiedergeben oder das kleinste beteiligte Teilsystem separat starten.
- Bei sporadisch falschen Ergebnissen: Eingaben mit festem Zufalls-Seed variieren. Bei einem Rückschritt: bekannte gute und schlechte Stände mit derselben Eingabe vergleichen oder mit `git bisect run` eingrenzen.
- Wenn sich notwendige manuelle Schritte nicht automatisieren lassen, nutze die [interaktive Bash-Vorlage](scripts/hitl-loop.template.sh). Das Skript liest nur bereinigte Beobachtungen ein, keine Zugangsdaten.

Halte den Ablauf schnell, aussagekräftig und wiederholbar. Lasse unnötige Initialisierung weg, kontrolliere Zeit und Zufall, und prüfe das genaue Symptom statt bloß den Prozessstatus. Bei sporadischen Fehlern erhöhe die Trefferquote beispielsweise mit Wiederholungen oder kontrollierter Last und dokumentiere die beobachtete Rate.

**Weiter erst, wenn** du einen konkreten, bereits ausgeführten Befehl und seine bereinigte Ausgabe nennen kannst. Falls kein verlässlicher Nachweis gelingt, nenne die bisherigen Versuche. Bitte gezielt um eine geeignete Testumgebung, eine bereinigte Aufzeichnung oder die Freigabe für eine zeitlich begrenzte Messung. Stelle ohne belastbaren Nachweis keine Ursachenhypothesen auf.

## 2. Reproduzieren und verkleinern

Bestätige durch mehrere Läufe, dass wirklich das gemeldete Symptom auftritt. Halte Fehlermeldung, falsches Ergebnis oder Laufzeit fest. Entferne danach Eingaben, Aufrufer, Konfiguration, Daten und Schritte einzeln. Wiederhole die Prüfung nach jeder Änderung, bis der kleinste noch fehlschlagende Fall übrig ist.

## 3. Überprüfbare Hypothesen bilden

Formuliere drei bis fünf plausible Ursachen und ordne sie nach Wahrscheinlichkeit, bevor du sie prüfst. Nenne pro Hypothese eine Vorhersage: „Wenn X die Ursache ist, muss Änderung Y das Ergebnis Z bewirken.“ Zeige die Liste dem Nutzer vor der Prüfung: Vorwissen kann die Reihenfolge ändern. Warte nicht auf eine Antwort, sofern du im genehmigten Rahmen weiterprüfen kannst.

## 4. Gezielt messen

Ändere pro Versuch genau eine Variable und ordne jede Messung einer Vorhersage zu. Nutze bevorzugt einen Debugger oder eine REPL. Falls gezielte Logs besser passen, markiere sie mit einem eindeutigen Präfix wie `[DEBUG-a4f2]`, damit sie sich vollständig entfernen lassen. Vermeide flächendeckendes Logging.

Bei Performance-Rückschritten: Erfasse zuerst einen Vergleichswert mit einem Messskript, Profiler oder Abfrageplan. Vergleiche unter denselben Bedingungen. Miss zuerst, repariere danach.

## 5. Beheben und gegen Rückfälle absichern

Schreibe vor der Korrektur einen Regressionstest, wenn er den tatsächlichen Fehlerpfad über eine geeignete Schnittstelle erreicht. Wenn keine geeignete Teststelle existiert, dokumentiere die Lücke, statt einen Test zu schreiben, der nur scheinbar absichert.

Falls die Teststelle geeignet ist: Lass den minimierten Fall im Regressionstest erst scheitern, wende die Korrektur an und lass den Test bestehen. Führe zusätzlich die Prüfung aus Schritt 1 am ursprünglichen, nicht verkleinerten Szenario erneut aus.

## 6. Aufräumen

- Das ursprüngliche Symptom tritt bei der ursprünglichen Prüfung nicht mehr auf.
- Der Regressionstest besteht, oder die fehlende Teststelle ist dokumentiert.
- Temporäre Logs und Diagnoseänderungen sind entfernt. Suche nach dem Debug-Präfix.
- Eigene Wegwerfprototypen sind entfernt oder eindeutig als Diagnosematerial abgelegt.
- Halte die bestätigte Ursache und den Nachweis in der Zusammenfassung fest, beziehungsweise in Commit oder Pull Request, falls diese Teil des Auftrags sind.

Quelle: [Matt Pocock – diagnosing-bugs](https://github.com/mattpocock/skills/tree/d65391149dbb5fe76478e76fa8d5122b2aa5a70e/skills/engineering/diagnosing-bugs) · [MIT-Lizenz](LICENSE)
