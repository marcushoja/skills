# Skills Hub

Ein statischer Katalog für AI-Agent-Skills mit Markdown-Vorschau und einem kopierbaren Installationsbefehl. Die drei Einträge zur Dokumentationsprüfung sind Beispiele; du kannst sie ersetzen oder löschen.

## Start mit Docker

```bash
docker build -t skills-hub .
docker run --rm -p 127.0.0.1:8080:80 skills-hub
```

Öffne <http://localhost:8080>. Der fertige Container braucht weder Node.js noch eine GitHub-API oder ein CDN. `npm ci` bezieht die festgeschriebenen Pakete nur beim Build; Markdown-Rendering und Sanitizing laufen mit lokalen Browser-Modulen.

**Privat oder öffentlich:** Das Git-Repo und der deployte Hub haben getrennte Sichtbarkeit. Der Hub hat keinen eingebauten Login. Wer ihn erreichen kann, kann die katalogisierten Skill-Dateien auch direkt abrufen. Betreibe ihn bei Bedarf intern, etwa hinter einem VPN, und lege keine Geheimnisse in auszuliefernden Skills ab. Verwende für öffentliches Hosting HTTPS. Standardmäßig kommen Vorschau und Downloads vom Hub selbst. Optional setzt `--build-arg DOWNLOAD_BASE_URL=https://downloads.example.org` nur für den Installationsbefehl eine andere Basis-URL; dort müssen dieselben Dateien verfügbar sein. Der Hub wird am Stamm einer HTTP(S)-Origin betrieben.

## Eigene Inhalte in `_SKILLS/` pflegen

Für eine eigene Sammlung kannst du [das Repo auf GitHub forken](https://github.com/marcushoja/skills/fork). Bei einem privaten Repo ist dafür Zugriff nötig. **Ersetze oder ergänze die Beispiele in [`_SKILLS/`](_SKILLS/).** Den Code des Hubs musst du dafür nicht anfassen.

- Lege Workflows unter `_SKILLS/workflows/` und wiederverwendbare Bausteine unter `_SKILLS/skills/` ab. Darunter kannst du nach Themen wie `dokumentation/` oder `java/` gruppieren und Kategorien beliebig tief verschachteln.
- Sobald ein Ordner eine `SKILL.md` enthält, zählt er als Skill. Dessen sichtbare reguläre Dateien (auch in Unterordnern) werden ausgeliefert. Versteckte Dateien, Windows-`Zone.Identifier`-Dateien und reine Kategorie-Dateien werden nicht veröffentlicht. Der Build lehnt sichtbare Symlinks ab.
- Skill-Ordner brauchen global eindeutige Namen aus Kleinbuchstaben, Zahlen und Bindestrichen. Verwende `mh-wf-` für Workflows und `mh-` für die übrigen Skills.
- Im YAML-Frontmatter muss `name` zum Ordner passen und `description` einen nicht leeren Text enthalten. Für Workflows empfiehlt sich `disable-model-invocation: true`.
- Referenziere einen existierenden Skill-Namen als Inline-Code im Markdown-Text (z. B. `` `mh-docs-style` ``), um ihn als Abhängigkeit aufzunehmen. Direkte und transitive Abhängigkeiten werden automatisch aufgelöst. Nach Änderungen wird der Hub neu gebaut und deployt.

## Skills installieren oder aktualisieren

Wähle die Skills und das Ziel-Tool, prüfe den kommentierten Befehl und führe ihn im Stamm des Zielprojekts aus. Die Tool-Auswahl wird in deinem Browser gespeichert. Benötigt werden Bash, `curl` und `sha256sum` oder `shasum`. Unterstützte Ziele sind `.claude/skills`, `.opencode/skills` und `.agents/skills`.

Der Befehl lädt zuerst die gesamte Auswahl in ein temporäres Verzeichnis und prüft jede Datei gegen die SHA-256-Prüfsumme im Manifest. Dann tauscht er nur ausgewählte, vom Hub verwaltete Ordner aus. Eigene oder anderweitig installierte Skills ohne passende `.skills-hub-managed`-Markierung werden nicht überschrieben; bei einer Namenskollision bricht der Befehl vor dem Austausch ab. Manuelle Änderungen in einem **Hub-verwalteten** Ordner werden beim Aktualisieren ersetzt. Nicht ausgewählte Ordner bleiben immer erhalten.

## Entwickeln und testen

```bash
npm ci --ignore-scripts
npm test
npm run build
```

Der Build legt die generierte Website in `dist/` ab. Die Projekt-Spezifikation steht in [`skills_hub_spezifikation.md`](skills_hub_spezifikation.md); bei der Installation gilt das oben beschriebene sichere Ersetzen statt eines globalen „Clean Sync“.
