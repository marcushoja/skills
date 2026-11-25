# Projekt-Spezifikation: Statischer AI-Skills-Manager (Skills Hub)

## 1. Ziel & Architektur-Überblick
Eine leichtgewichtige, rein statische Webanwendung ohne Backend, ohne Datenbank und ohne GitHub-API-Abhängigkeit, die im selben (privaten) Git-Repository wie die eigenen AI-Agent-Skills liegt.

Die Anwendung:
1. Liest beim Docker-Build alle `workflows/` und `skills/` ein, validiert Struktur und Metadaten und erzeugt eine statische `manifest.json`.
2. Stellt im Browser eine zweigeteilte Oberfläche bereit: links eine aufklappbare Kategorie-Baumstruktur mit Checkboxen, rechts die Vorschau der gewählten `SKILL.md` (inkl. Abhängigkeiten und lesbarer Zusatzdateien).
3. Generiert ein Copy-Paste-Shell-Kommando (`rm`, `mkdir`, `curl`), das alle ausgewählten Skills inkl. ihrer Abhängigkeiten **flach** in das Zielprojekt des Nutzers (für **Claude Code**, **OpenCode** oder **Codex**) kopiert.
4. Da Nginx die Ordner `workflows/` und `skills/` direkt mit ausliefert, lädt das generierte `curl`-Kommando die Dateien direkt vom eigenen Server (`window.location.origin`). Das Git-Repository kann dadurch komplett **privat** bleiben, und es gibt weder GitHub-API-Limits noch GitHub-Raw-Caching-Verzögerungen nach einem Redeploy.

---

## 2. Repository-Struktur & Konventionen

```text
<repo-root>/
├── workflows/                         # Workflow-Skills (Orchestratoren), beliebig tief kategorisierbar
│   └── java/
│       └── mh-wf-java-feature/
│           └── SKILL.md
├── skills/                            # Atomare Baustein-Skills, beliebig tief kategorisierbar
│   ├── java/
│   │   └── mh-java-clean-code/
│   │       └── SKILL.md
│   └── javascript/
│       └── extjs/
│           └── mh-extjs-components/
│               ├── SKILL.md
│               └── references/
│                   └── grid-patterns.md
├── web/
│   ├── build-manifest.mjs             # Node.js Build-Skript (Zero Dependencies)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── nginx.conf
└── Dockerfile
```

### Verbindliche Regeln
* **Skill vs. Kategorie:**
  * Enthält ein Ordner eine `SKILL.md`, ist er ein **Skill** (Blattknoten im Baum). Alle weiteren Dateien und Unterordner darin (`scripts/`, `references/`, etc.) gehören zu diesem Skill und werden komplett mitkopiert.
  * Enthält ein Ordner keine `SKILL.md`, ist er ein reiner **Kategorie-Ordner** (dient nur der Gliederung im UI, wird beim Kopieren ignoriert). Es werden keine Kategorie-`README.md`-Dateien ausgewertet.
* **Namenskonvention (Agent-Skills-Standard):**
  * Erlaubte Zeichen für Skill-Ordnernamen: ausschließlich Kleinbuchstaben, Zahlen und Bindestriche (`/^[a-z0-9-]+$/`, keine Unterstriche).
  * Workflows unter `workflows/` müssen mit `mh-wf-` beginnen.
  * Baustein-Skills unter `skills/` müssen mit `mh-` beginnen (und dürfen nicht mit `mh-wf-` beginnen).
  * Jeder Skill-Ordnername muss **repo-weit eindeutig** sein, da beim Kopieren ins Zielprojekt alle Kategorie-Ebenen abgeflacht werden.
* **YAML-Frontmatter:**
  * Jede `SKILL.md` muss ein YAML-Frontmatter mit mindestens `name` und `description` enthalten (Keys immer auf Englisch).
  * `name` im Frontmatter muss exakt dem Ordnernamen entsprechen.
  * Workflow-Skills sollten zusätzlich `disable-model-invocation: true` setzen, damit sie nicht versehentlich automatisch ausgelöst werden.
* **Abhängigkeiten (ohne eigene Metadaten-Tags):**
  * Referenziert eine `SKILL.md` einen anderen im Repo existierenden Skill-Namen in Backticks (z. B. `` `mh-java-clean-code` ``), wird dies beim Build automatisch als Abhängigkeit erkannt.

---

## 3. Build-Skript (`web/build-manifest.mjs`)

Läuft ausschließlich während des Docker-Builds mit Node.js (ohne externe `npm`-Pakete) und fungiert gleichzeitig als Qualitäts-Gate.

### Validierungsregeln (Build bricht mit Exit-Code `1` ab)
* Ungültige Zeichen im Skill-Ordnernamen (nicht `/^[a-z0-9-]+$/`).
* Falsches Präfix (`mh-wf-` für `workflows/`, `mh-` ohne `mh-wf-` für `skills/`).
* Doppelter Skill-Name im gesamten Repository.
* Fehlendes `name`-Feld im Frontmatter oder Abweichung vom Ordnernamen.

### Referenz-Implementierung (`web/build-manifest.mjs`)
```javascript
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
// Leer lassen => Frontend nutzt automatisch window.location.origin
const DOWNLOAD_BASE_URL = (process.env.DOWNLOAD_BASE_URL || '').replace(/\/+$/, '');
const VALID_NAME_REGEX = /^[a-z0-9-]+$/;

const skillsMap = new Map();

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      meta[key] = val;
    }
  }
  return meta;
}

function listFilesRecursive(dir, baseDir = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full, baseDir));
    } else {
      results.push(path.relative(baseDir, full).replaceAll('\\', '/'));
    }
  }
  return results.sort((a, b) => {
    if (a === 'SKILL.md') return -1;
    if (b === 'SKILL.md') return 1;
    return a.localeCompare(b);
  });
}

function scanTree(dir, type) {
  if (!fs.existsSync(dir)) return [];
  const nodes = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    const skillMdPath = path.join(fullPath, 'SKILL.md');

    if (fs.existsSync(skillMdPath)) {
      const id = entry.name;

      if (!VALID_NAME_REGEX.test(id)) {
        throw new Error(`Ungültiger Skill-Name "${id}" in "${fullPath}" (erlaubt: a-z, 0-9, -)`);
      }
      if (type === 'workflow' && !id.startsWith('mh-wf-')) {
        throw new Error(`Workflow "${id}" in "${fullPath}" muss mit "mh-wf-" beginnen`);
      }
      if (type === 'skill' && (!id.startsWith('mh-') || id.startsWith('mh-wf-'))) {
        throw new Error(`Skill "${id}" in "${fullPath}" muss mit "mh-" (aber nicht "mh-wf-") beginnen`);
      }
      if (skillsMap.has(id)) {
        throw new Error(`Doppelter Skill-Name "${id}" in "${fullPath}"`);
      }

      const rawMd = fs.readFileSync(skillMdPath, 'utf8');
      const meta = parseFrontmatter(rawMd);

      if (!meta.name) {
        throw new Error(`Fehlendes Frontmatter-Feld "name" in "${skillMdPath}"`);
      }
      if (meta.name !== id) {
        throw new Error(`Frontmatter name "${meta.name}" != Ordnername "${id}" in "${skillMdPath}"`);
      }

      const repoPath = path.relative(ROOT, fullPath).replaceAll('\\', '/');
      const files = listFilesRecursive(fullPath);

      skillsMap.set(id, {
        id,
        type,
        repoPath,
        description: meta.description || '',
        files,
        rawMd,
        directDeps: [],
        allDeps: []
      });

      nodes.push({ kind: 'skill', id });
    } else {
      const children = scanTree(fullPath, type);
      if (children.length > 0) {
        nodes.push({ kind: 'category', name: entry.name, children });
      }
    }
  }

  return nodes.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

const tree = {
  workflows: scanTree(path.join(ROOT, 'workflows'), 'workflow'),
  skills: scanTree(path.join(ROOT, 'skills'), 'skill')
};

// Direkte Abhängigkeiten über Backticks (`mh-...`) erkennen
const backtickRegex = /`([a-z0-9-]+)`/g;
for (const skill of skillsMap.values()) {
  const deps = new Set();
  for (const m of skill.rawMd.matchAll(backtickRegex)) {
    const candidate = m[1];
    if (candidate !== skill.id && skillsMap.has(candidate)) {
      deps.add(candidate);
    }
  }
  skill.directDeps = [...deps].sort();
}

// Transitive Abhängigkeiten rekursiv und zyklus-sicher auflösen
function resolveAllDeps(id, visited = new Set()) {
  const skill = skillsMap.get(id);
  for (const dep of skill.directDeps) {
    if (!visited.has(dep)) {
      visited.add(dep);
      resolveAllDeps(dep, visited);
    }
  }
  return [...visited].sort();
}

const skillsOutput = {};
for (const [id, skill] of skillsMap.entries()) {
  skillsOutput[id] = {
    id: skill.id,
    type: skill.type,
    repoPath: skill.repoPath,
    description: skill.description,
    files: skill.files,
    directDeps: skill.directDeps,
    allDeps: resolveAllDeps(id)
  };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  downloadBaseUrl: DOWNLOAD_BASE_URL,
  tree,
  skills: skillsOutput
};

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`Manifest erfolgreich gebaut: ${skillsMap.size} Skills/Workflows.`);
```

### Ziel-Schema `manifest.json`
```json
{
  "generatedAt": "2026-11-25T08:00:00.000Z",
  "downloadBaseUrl": "",
  "tree": {
    "workflows": [
      {
        "kind": "category",
        "name": "java",
        "children": [
          { "kind": "skill", "id": "mh-wf-java-feature" }
        ]
      }
    ],
    "skills": [
      {
        "kind": "category",
        "name": "java",
        "children": [
          { "kind": "skill", "id": "mh-java-clean-code" }
        ]
      }
    ]
  },
  "skills": {
    "mh-wf-java-feature": {
      "id": "mh-wf-java-feature",
      "type": "workflow",
      "repoPath": "workflows/java/mh-wf-java-feature",
      "description": "Kurzbeschreibung aus dem Frontmatter",
      "files": ["SKILL.md"],
      "directDeps": ["mh-java-clean-code"],
      "allDeps": ["mh-java-clean-code"]
    }
  }
}
```

---

## 4. Web-Oberfläche (`web/index.html`, `web/app.js`, `web/style.css`)

* **Stack:** Reines HTML, CSS und Vanilla JavaScript (kein Frontend-Bundler).
* **Markdown-Rendering:** `marked` + `DOMPurify` (über gepinnte CDN-Version oder lokal unter `web/vendor/`).

### Layout & Funktionsumfang
1. **Linke Seitenleiste (Baumstruktur):**
   * Zwei aufklappbare Hauptbereiche: **Workflows** und **Skills**.
   * Kategorie-Ordner sind auf- und zuklappbar (optional mit Kategorie-Checkbox zum gesammelten An-/Abwählen aller enthaltenen Skills).
   * Jeder Skill zeigt eine Checkbox und seinen klickbaren Namen (lädt rechts die Vorschau).
   * **Abhängigkeits-Logik:** Wird ein Skill mit `allDeps` angehakt, werden alle benötigten Skills im Baum automatisch mitmarkiert, als *„benötigt von …“* gekennzeichnet und gegen manuelles Abwählen gesperrt, solange mindestens ein abhängiger Skill angehakt ist.
2. **Rechter Hauptbereich (Vorschau):**
   * **Kopfzeile:** Skill-ID, Typ-Badge (`Workflow` / `Skill`) und `description`.
   * **Abhängigkeits-Box (nur wenn `directDeps.length > 0`):** Farblich hervorgehobener Hinweisblock über dem Inhalt, der alle benötigten Skills als klickbare Chips anzeigt (Klick öffnet deren Vorschau).
   * **Dateileiste / Tabs:** Zeigt `SKILL.md` sowie alle vorhandenen Zusatzdateien (`scripts/...`, `references/...`), damit der Nutzer genau sieht, was kopiert wird. Ein Klick lädt die Datei per `fetch('./' + repoPath + '/' + file)` direkt vom eigenen Nginx.
   * **Inhaltsbereich:** `.md`-Dateien werden als gerendertes Markdown dargestellt (YAML-Frontmatter optional sauber abgetrennt oder als Metadatenblock); alle anderen Dateitypen als `<pre><code>`-Block.
3. **Unterer Bereich (Shell-Kommando-Generator):**
   * **Ziel-Tool-Auswahl (Radio/Select):**
     * **Claude Code** -> `.claude/skills`
     * **OpenCode** -> `.opencode/skills`
     * **Codex** -> `.agents/skills`
   * **Checkbox „Clean Sync“ (Standard: deaktiviert):** Fügt vorab `rm -rf <target>` ein, um den gesamten Ziel-`skills/`-Ordner zu leeren.
   * **Readonly-Textarea + Copy-Button:** Zeigt das generierte Shell-Kommando live an und bietet Ein-Klick-Kopieren in die Zwischenablage.

---

## 5. Shell-Kommando-Generierung

* **Basis-URL:** `manifest.downloadBaseUrl || window.location.origin` (ohne abschließenden Slash).
* **Auswahlmenge:** Vereinigungsmenge aller manuell angehakten Skills + deren `allDeps` (dedupliziert, alphabetisch sortiert).
* **Generierungslogik:**
  1. Ist „Clean Sync“ aktiv, beginnt der Befehl mit `rm -rf <target> && \`.
  2. Für jeden ausgewählten Skill `<id>`:
     * Gezieltes Vorab-Löschen des einzelnen Skill-Ordners (Standard, nicht optional – verhindert Dateileichen nach Umbenennungen/Löschungen):
       `rm -rf <target>/<id> && \`
     * Anlegen des Skill-Ordners sowie aller benötigten Unterordner aus `skill.files` (z. B. `references/`, `scripts/`):
       `mkdir -p <target>/<id> <target>/<id>/references && \`
     * Download jeder einzelnen Datei per `curl`:
       `curl -fsSL "<baseUrl>/<repoPath>/<file>" -o "<target>/<id>/<file>"`
  3. Verknüpfung aller Schritte mit `&& \`.

### Beispiel-Output (Claude Code, ohne Clean Sync)
```bash
rm -rf .claude/skills/mh-java-clean-code && \
mkdir -p .claude/skills/mh-java-clean-code && \
curl -fsSL "https://skills.example.de/skills/java/mh-java-clean-code/SKILL.md" -o ".claude/skills/mh-java-clean-code/SKILL.md" && \
rm -rf .claude/skills/mh-wf-java-feature && \
mkdir -p .claude/skills/mh-wf-java-feature && \
curl -fsSL "https://skills.example.de/workflows/java/mh-wf-java-feature/SKILL.md" -o ".claude/skills/mh-wf-java-feature/SKILL.md"
```

---

## 6. Deployment: `Dockerfile` & `nginx.conf`

### `Dockerfile` (Multi-Stage)
```dockerfile
# Stage 1: Skills validieren und manifest.json generieren
FROM node:22-alpine AS builder
WORKDIR /app

ARG DOWNLOAD_BASE_URL=""
ENV DOWNLOAD_BASE_URL=$DOWNLOAD_BASE_URL

COPY workflows ./workflows
COPY skills ./skills
COPY web/build-manifest.mjs ./web/build-manifest.mjs

RUN node web/build-manifest.mjs

# Stage 2: Schlanker statischer Nginx
FROM nginx:alpine

# Frontend + generiertes Manifest
COPY web/index.html web/app.js web/style.css /usr/share/nginx/html/
COPY --from=builder /app/dist/manifest.json /usr/share/nginx/html/manifest.json

# Original-Ordner für Vorschau & curl-Downloads
COPY workflows /usr/share/nginx/html/workflows
COPY skills /usr/share/nginx/html/skills

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
```

### `nginx.conf`
```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;
    charset utf-8;

    types {
        text/html              html htm;
        text/css               css;
        application/javascript js mjs;
        application/json       json;
        text/markdown          md;
        text/plain             txt sh py ts yaml yml;
        image/svg+xml          svg;
        image/png              png;
        image/x-icon           ico;
    }

    location = /manifest.json {
        add_header Cache-Control "no-cache";
    }

    location ^~ /skills/ {
        add_header Cache-Control "no-cache";
    }

    location ^~ /workflows/ {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 7. Abnahmekriterien (Definition of Done)
- [ ] `docker build` bricht mit klarer Fehlermeldung ab, wenn ein Skill-Name doppelt vorkommt, ungültige Zeichen enthält, das Präfix (`mh-` / `mh-wf-`) nicht passt oder `name` im Frontmatter vom Ordnernamen abweicht.
- [ ] `docker run -p 8080:80 <image>` liefert die komplette Anwendung ohne externe API-Aufrufe aus.
- [ ] Workflows und Skills erscheinen korrekt kategorisiert im linken Baum.
- [ ] Anhaken eines Workflows hakt alle direkten und transitiven Abhängigkeiten automatisch mit an und sperrt sie gegen manuelles Abwählen.
- [ ] Die rechte Vorschau rendert `SKILL.md` sauber, zeigt erkannte Abhängigkeiten hervorgehoben an und erlaubt das Anklicken und Lesen vorhandener Zusatzdateien.
- [ ] Das generierte Shell-Kommando kopiert alle gewählten Skills flach in `.claude/skills/`, `.opencode/skills/` oder `.agents/skills/`, zieht die Dateien direkt vom eigenen Server und ersetzt bestehende Skill-Ordner rückstandsfrei.
- [ ] Nach einem Redeploy des Docker-Images liefern Browser und `curl` ohne manuelles Cache-Leeren sofort die aktuellen Skills aus.