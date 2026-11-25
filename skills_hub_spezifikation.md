# Projekt-Spezifikation: Statischer AI-Skills-Manager (Skills Hub)

## 1. Ziel & Architektur-Überblick
Eine leichtgewichtige, rein statische Webanwendung ohne Backend, ohne Datenbank und ohne GitHub-API-Abhängigkeit, die im selben (privaten) Git-Repository wie die eigenen AI-Agent-Skills liegt.

Die Anwendung:
1. Liest beim Build `_SKILLS/workflows/`, `_SKILLS/skills/` und `_SKILLS/project-templates/` ein, validiert Struktur und Metadaten und erzeugt eine statische `manifest.json`.
2. Stellt im Browser eine zweigeteilte Oberfläche bereit: links eine aufklappbare Kategorie-Baumstruktur mit Checkboxen, rechts die Vorschau der gewählten `SKILL.md` (inkl. Abhängigkeiten und lesbarer Zusatzdateien).
3. Generiert einen kopierbaren Block für Bash oder PowerShell, der alle ausgewählten Skills inkl. ihrer Abhängigkeiten **flach** in das Zielprojekt kopiert. Ziel-Tools: **Claude Code**, **OpenCode**, **Codex**, **Google Antigravity**, **Cursor** und **GitHub Copilot**.
4. Installiert auf Wunsch eine Projektvorlage als `AGENTS.md` im Projektstamm, ohne vorhandene Projektanweisungen zu überschreiben.
5. Der Build kopiert die katalogisierten Dateien nach `dist/workflows/`, `dist/skills/` und `dist/project-templates/`. Nginx liefert sie unter `/workflows/`, `/skills/` und `/project-templates/` aus; `_SKILLS/` ist nur der Quellordner. Standardmäßig lädt der Installationsbefehl die Dateien direkt vom eigenen Server (`window.location.origin`), sodass das Git-Repository privat bleiben kann.

---

## 2. Repository-Struktur & Konventionen

```text
<repo-root>/
├── _SKILLS/                           # Inhalte, die beim Fork angepasst werden
│   ├── workflows/
│   │   └── java/
│   │       └── mh-wf-java-feature/
│   │           └── SKILL.md
│   ├── skills/
│   │   ├── java/
│   │   │   └── mh-java-clean-code/
│   │   │       └── SKILL.md
│   │   └── javascript/
│   │       └── extjs/
│   │           └── mh-extjs-components/
│   │               ├── SKILL.md
│   │               └── references/
│   │                   └── grid-patterns.md
│   └── project-templates/
│       └── entwicklung/
│           └── java/
│               ├── AGENTS.md
│               └── spring-boot/
│                   └── AGENTS.md
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
  * Workflows unter `_SKILLS/workflows/` müssen mit `mh-wf-` beginnen.
  * Baustein-Skills unter `_SKILLS/skills/` müssen mit `mh-` beginnen (und dürfen nicht mit `mh-wf-` beginnen).
  * Jeder Skill-Ordnername muss **repo-weit eindeutig** sein, da beim Kopieren ins Zielprojekt alle Kategorie-Ebenen abgeflacht werden.
* **YAML-Frontmatter:**
  * Jede `SKILL.md` muss ein YAML-Frontmatter mit mindestens `name` und `description` enthalten (Keys immer auf Englisch).
  * `name` im Frontmatter muss exakt dem Ordnernamen entsprechen.
  * Workflow-Skills sollten zusätzlich `disable-model-invocation: true` setzen, damit sie nicht versehentlich automatisch ausgelöst werden.
* **Abhängigkeiten (ohne eigene Metadaten-Tags):**
  * Referenziert eine `SKILL.md` einen anderen im Repo existierenden Skill-Namen in Backticks (z. B. `` `mh-java-clean-code` ``), wird dies beim Build automatisch als Abhängigkeit erkannt.
* **Projektvorlagen:** Der Verzeichnisbaum unter `_SKILLS/project-templates/` kann pro Ordner eine `AGENTS.md` enthalten, auch wenn derselbe Ordner weitere Unterordner mit Vorlagen enthält. Der relative Dateipfad ist die ID, die erste `#`-Überschrift der Anzeigename. Das Manifest führt die Vorlagen separat von Skills; sie haben keine automatischen Abhängigkeiten und erben nichts von Elternordnern.

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
const CATALOG_ROOT = path.join(ROOT, '_SKILLS');
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

      const repoPath = path.relative(CATALOG_ROOT, fullPath).replaceAll('\\', '/');
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
  workflows: scanTree(path.join(CATALOG_ROOT, 'workflows'), 'workflow'),
  skills: scanTree(path.join(CATALOG_ROOT, 'skills'), 'skill')
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
   * Aufklappbare Hauptbereiche: **Workflows**, **Skills** und **Projektvorlagen**. Im Vorlagenbaum lädt der Name die Vorschau, ein Radiobutton wählt unabhängig von den Skills höchstens eine Vorlage aus.
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
     * **Codex**, **Google Antigravity**, **Cursor**, **GitHub Copilot** -> `.agents/skills`
   * **Terminal-Auswahl:** Bash (Standard; Linux, macOS, WSL) oder PowerShell (Windows; 5.1 und 7). Terminal und Ziel-Tool werden unabhängig in `localStorage` gespeichert. Die Skill-Auswahl ändert sich beim Umschalten nicht.
   * **Readonly-Textarea + Copy-Button:** Zeigt das generierte Shell-Kommando live an und bietet Ein-Klick-Kopieren in die Zwischenablage.

---

## 5. Shell-Kommando-Generierung

* **Basis-URL:** `manifest.downloadBaseUrl || window.location.origin` (ohne abschließenden Slash).
* **Auswahlmenge:** Vereinigungsmenge aller manuell angehakten Skills + deren `allDeps` (dedupliziert, alphabetisch sortiert).
* **Installation:** Beide Varianten prüfen den Zielpfad, sperren parallele Installationen und laden alle ausgewählten Dateien zuerst in einen temporären Ordner auf demselben Dateisystem. Jede Datei muss die im Manifest hinterlegte SHA-256-Prüfsumme erfüllen.
* **Aktualisierung:** Nur ausgewählte Ordner mit passender `.skills-hub-managed`-Markierung werden ersetzt. Eigene und nicht ausgewählte Ordner bleiben unverändert. Wird der Einbau eines gesicherten Ordners unterbrochen, versucht der Befehl beim fehlgeschlagenen Austausch die Sicherung zurückzulegen; sonst bleibt sie zur manuellen Wiederherstellung erhalten.
* **Projektvorlage:** Nur eine ausdrücklich gewählte Vorlage wird installiert, für alle Ziel-Tools als `AGENTS.md` im Projektstamm. Bei vorhandener `AGENTS.md` wird sie übersprungen, ausgewählte Skills werden trotzdem installiert und das Skript weist am Ende auf die manuelle Übernahme hin.

---

## 6. Deployment: `Dockerfile` & `nginx.conf`

### `Dockerfile` (Multi-Stage)
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --ignore-scripts
COPY . .
ARG DOWNLOAD_BASE_URL=""
RUN DOWNLOAD_BASE_URL="$DOWNLOAD_BASE_URL" npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/ /usr/share/nginx/html/
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
