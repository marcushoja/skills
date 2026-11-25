---
name: mh-wf-uebergabe
description: Verdichte das aktuelle Gespräch zu einer Übergabe, mit der eine neue Agenten-Session direkt weiterarbeiten kann.
argument-hint: "Woran soll die nächste Session weiterarbeiten?"
disable-model-invocation: true
---

# Session übergeben

Schreibe eine kurze Markdown-Übergabe für einen Agenten, der dieses Gespräch nicht kennt. Hat der Nutzer einen Schwerpunkt für die nächste Session genannt, richte die Übergabe daran aus.

- **Ziel und Stand:** Was soll erreicht werden, was ist erledigt und was wurde überprüft?
- **Entscheidungen und Rahmen:** Was wurde festgelegt oder bewusst verworfen? Welche Einschränkungen gelten weiterhin?
- **Offene Punkte und nächster Schritt:** Was ist ungeklärt und womit sollte die nächste Session anfangen?
- **Fundstellen:** Verweise auf relevante Dateien, Pläne, Tickets, Commits und Prüfergebnisse, statt sie abzuschreiben. Verwende eindeutige oder projektbezogene Pfade und URLs.
- **Empfohlene Skills:** Nenne nur tatsächlich verfügbare, passende Skill-IDs und wofür sie nützlich sind.

Entferne Zugangsdaten, API-Schlüssel und personenbezogene Informationen. Speichere die Datei in einem eindeutigen Pfad im temporären Verzeichnis, nicht im Projekt: in OpenCode bevorzugt im dafür vorgesehenen Temp-Verzeichnis, sonst unter `$TMPDIR` (Fallback `/tmp`) beziehungsweise unter `%TEMP%` unter Windows. Gib den Pfad aus, damit der Nutzer die Datei in der nächsten Session öffnen kann.
