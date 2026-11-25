---
name: mh-tdd
description: Entwickle Features und Fehlerkorrekturen testgetrieben in kleinen Schritten. Nutze den Skill bei Test-first, Rot–Grün oder wenn Integrationstests das gewünschte Verhalten absichern sollen.
---

# Testgetriebene Entwicklung (TDD)

Arbeite in kurzen **Rot–Grün-Zyklen**. Teste das Verhalten, das Aufrufer tatsächlich beobachten können. Lies bei der Erkundung das Projektglossar (`GLOSSARY.md`, falls vorhanden) und beachte relevante Architekturentscheidungen (ADRs). Nutze die Begriffe des Projekts auch in Tests und Schnittstellen.

## Teststellen vorab vereinbaren

Eine **Teststelle** (*seam*) ist hier die Stelle, an der ein Test Verhalten über eine öffentliche Schnittstelle auslöst und beobachtet. Greife nicht auf private Methoden oder interne Zustände zu. Eine gute Schnittstelle verbirgt Komplexität und erlaubt Aufrufern und Tests, dasselbe Verhalten auf demselben Weg auszulösen.

Schlage vor dem ersten Test die entscheidenden Teststellen vor. Gib jeweils knapp an, was der Test dort abdeckt und was nicht. Schreibe an einer Teststelle erst dann, wenn sie mit dem Nutzer vereinbart ist. Konzentriere dich auf wichtige Pfade und komplexes Verhalten, nicht auf möglichst viele Randfälle.

## Gute Tests erkennen

Gute Tests lesen sich wie eine Spezifikation: „Ein gültiger Warenkorb kann bestellt werden“ sagt, **was** funktioniert, nicht **wie**. Solche Tests bleiben gültig, wenn der Code intern umgebaut wird. Siehe [Testbeispiele](tests.md) und [Mocking-Regeln](mocking.md).

- **Nicht an Interna koppeln:** Mocks für eigene Module, Aufrufreihenfolgen und Datenbankabfragen am öffentlichen Ergebnis vorbei machen Tests unnötig fragil.
- **Den Sollwert unabhängig bestimmen:** Ein Erwartungswert aus der Spezifikation, einem durchgerechneten Beispiel oder einem bekannten Ergebnis kann einen Fehler aufdecken. Ein nachgebauter Algorithmus wiederholt womöglich denselben Fehler.
- **Nicht alle Tests auf Vorrat schreiben:** Wähle pro Runde einen kleinen Schritt, der bereits beobachtbares Verhalten liefert. Nutze das Ergebnis, um den nächsten Test zu bestimmen.

## Rot → Grün

1. **Rot:** Schreibe einen Test an einer vereinbarten Teststelle und führe ihn aus. Er muss wegen des fehlenden oder falschen Verhaltens scheitern, nicht wegen eines fehlerhaften Testaufbaus.
2. **Grün:** Ändere nur so viel Code, dass dieser Test besteht. Führe ihn erneut aus und prüfe betroffene bestehende Tests.
3. Wiederhole den Zyklus mit genau einem weiteren Verhaltensschritt. Halte strukturelles Refactoring aus dem Rot–Grün-Zyklus heraus; wenn es nötig ist, erledige es separat mit grünen Tests als Rückversicherung.
