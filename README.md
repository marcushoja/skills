# Skills Hub

Skills zentral im Team pflegen, aber nur dort installieren, wo sie gebraucht werden: Java-Konventionen ins Java-Projekt, Python-Konventionen ins Python-Projekt. Checkt die installierten Skills ins Projekt-Repo ein, damit alle mit demselben Stand arbeiten. Änderungen im Hub landen erst durch ein bewusstes Update im Projekt.

## Eigene Skillsets anlegen

[Forke das Repo](https://github.com/marcushoja/skills/fork) und ersetze oder ergänze die Inhalte in [`_SKILLS/`](_SKILLS/). Den Hub-Code musst du dafür nicht ändern.

1. **Bausteine anlegen:** Lege wiederverwendbare Skills unter `_SKILLS/skills/` ab, etwa `java/mh-java-tests/SKILL.md`. Passende Skripte und Vorlagen kommen in denselben Skill-Ordner.
2. **Im Workflow verknüpfen:** Lege den Workflow unter `_SKILLS/workflows/` ab, etwa `java/mh-wf-java/SKILL.md`. Schreibe die exakten Ordnernamen der benötigten Skills als Inline-Code (in Backticks) in den Markdown-Text:

   ```markdown
   Prüfe zuerst die Projektstruktur mit `mh-java-struktur`.
   Schreibe anschließend die Tests nach `mh-java-tests`.
   ```

3. **Workflow auswählen:** Nach dem Neubau des Hubs reicht ein Häkchen beim Java-Workflow. Der Hub nimmt die referenzierten Skills und deren Abhängigkeiten automatisch in den Installationsbefehl auf. Nicht referenzierte Python-Skills bleiben draußen.

**Namensregeln:** Ordnernamen müssen im ganzen Katalog eindeutig sein und dürfen nur Kleinbuchstaben, Ziffern und Bindestriche enthalten. Workflows beginnen mit `mh-wf-`, Skills mit `mh-`. Jede `SKILL.md` braucht YAML-Frontmatter mit `name` (identisch zum Ordnernamen) und `description` (nicht leer). Für manuell aufgerufene Workflows empfiehlt sich `disable-model-invocation: true`.

**Aufruf:** Die Vorschau zeigt für das gewählte Ziel-Tool, ob der Assistent den Skill bei passender Aufgabe selbst auswählen kann, und nennt den manuellen Aufruf, sofern verfügbar. Für Claude Code und OpenCode schaltet `disable-model-invocation: true` die automatische Auswahl ab. In OpenCode V2 hat `metadata.opencode/autoinvoke` Vorrang. Für Codex setze `policy.allow_implicit_invocation: false` in `agents/openai.yaml`.

## Projektvorlagen für `AGENTS.md`

Lege in jedem passenden Ordner unter [`_SKILLS/project-templates/`](_SKILLS/project-templates/) eine `AGENTS.md` ab. Die Ordner bilden den Baum; die erste `#`-Überschrift ist der Anzeigename. Ein Ordner kann eine eigene Vorlage und weitere Unterordner haben, zum Beispiel:

```text
entwicklung/java/AGENTS.md
entwicklung/java/spring-boot/AGENTS.md
marketing/praesentationen/AGENTS.md
```

Klicke auf den Namen für die Vorschau oder wähle über den Radiobutton genau eine Vorlage aus. Sie kann auch ohne Skills installiert werden. Bei Spring Boot wird nur dessen Datei übernommen, nicht zusätzlich die Java-Vorlage darüber.

Der Installer legt `AGENTS.md` für alle Ziel-Tools im Projektstamm an. Eine schon vorhandene Datei bleibt unverändert: Die ausgewählten Skills werden trotzdem installiert, und am Ende erscheint ein Hinweis zur manuellen Übernahme. Checkt die angepasste `AGENTS.md` ins Projekt-Repo ein.

## Installieren und aktualisieren

Für die manuelle Installation klicke in der Vorschau auf **ZIP herunterladen**. Das Archiv enthält den Ordner des geöffneten Skills oder Workflows samt Begleitdateien, aber keine abhängigen Skills. Entpacke den Ordner in das Skills-Verzeichnis deines Ziel-Tools.

Wähle im Hub Workflow oder Skills, Ziel-Tool und Terminal (Bash oder PowerShell). Prüfe den erzeugten Befehl und führe ihn im Stamm des Zielprojekts aus. Für ein Update wählst du die Einträge erneut aus. Der Installer prüft die Downloads und ersetzt nur ausgewählte, vom Hub verwaltete Skill-Ordner. **Lokale Änderungen in diesen Ordnern gehen beim Update verloren**; prüft Updates deshalb am besten per Git-Diff im Pull Request.

## Hub starten

```bash
docker build -t skills-hub .
docker run --rm -p 127.0.0.1:8080:80 skills-hub
```

Öffne <http://localhost:8080>. Der Hub hat keinen Login: Ein privates Git-Repo schützt den laufenden Hub nicht. Betreibt interne Kataloge geschützt, etwa hinter einem VPN.

## Entwickeln und testen

```bash
npm ci --ignore-scripts
npm test
npm run build
```

Der Build schreibt nach `dist/`. Für die PowerShell-Integrationstests braucht es `pwsh` oder ein über `SKILLS_HUB_POWERSHELL` angegebenes Programm. Weitere Details stehen in der [Projekt-Spezifikation](skills_hub_spezifikation.md).

Die mitgelieferten Skills und Workflows basieren auf [Matt Pococks Skills](https://github.com/mattpocock/skills/tree/d65391149dbb5fe76478e76fa8d5122b2aa5a70e) (MIT).
