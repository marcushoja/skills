# Tiefgehende Codebasis-Prüfung – Version 0.2-DE
Universeller Agent-Skill im reinen Berichtsmodus. Kopiere diesen Ordner in das von deinem Agenten unterstützte Skill-Verzeichnis oder weise ihn an, SKILL.md zu lesen. Erkennung und Werkzeugberechtigungen hängen vom jeweiligen Agenten ab. Die Skill-Texte benötigen keine Abhängigkeiten; optionale Skripte nutzen Python 3.9+ und dessen Standardbibliothek. Der JSON-Validator benötigt ein bereits installiertes Paket jsonschema.

Beispiel: „Verwende mh-audit-security für eine Standardprüfung dieses Repositorys. Berichte auf Deutsch. Ändere keinen Code, führe keinen Projektcode aus und kontaktiere keine externen Dienste.“

Skripte sind optional und vor Ausführung zu prüfen. Sie schreiben Ergebnisse auf die Standardausgabe und ändern das geprüfte Repository nicht. Eine Dateiliste ist kein Beleg für eine semantische Prüfung. Prüfe Berichte auf sensible Pfade und Daten vor der Weitergabe. Technische Dateinamen, JSON-Schlüssel, Statuswerte und Python-Bezeichner bleiben zur Kompatibilität unverändert.

Grundlagen: https://agentskills.io/specification ; https://github.com/trailofbits/skills ; https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html ; https://csrc.nist.gov/projects/ssdf

Eigenständiger Entwurf, keine offizielle Implementierung dieser Projekte. Noch nicht an einer realen Codebasis oder in einer Multi-Agent-Laufzeit evaluiert. Das Evaluationsverfahren steht in evals/README.md.
