import { renderPowerShellInstaller } from './powershell-installer.js';

export const targets = Object.freeze({
  claude: '.claude/skills',
  opencode: '.opencode/skills',
  codex: '.agents/skills',
});

export const terminals = Object.freeze({
  bash: 'Bash',
  powershell: 'PowerShell',
});

export function getSkillInvocations(tool, manual) {
  const prefix = { claude: '/', opencode: '@', codex: '$' }[tool];
  return [...manual].sort().map((id) => `${prefix}${id}`);
}

export function splitFrontmatter(text) {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(text);
  return match?.index === 0
    ? { frontmatter: match[1], body: text.slice(match[0].length) }
    : { frontmatter: null, body: text };
}

export function normalizeBaseUrl(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { /* Report a build error with the setting name. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[?#]/.test(url.href)) {
    throw new Error('DOWNLOAD_BASE_URL muss eine absolute HTTP(S)-URL ohne Zugangsdaten, Query oder Fragment sein.');
  }
  return url.href.replace(/\/+$/, '');
}

function pathParts(path) {
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f\\]/.test(part))) {
    throw new Error(`Ungültiger relativer Dateipfad: ${path}`);
  }
  return parts;
}

export function fileUrl(baseUrl, repoPath, file) {
  const encoded = pathParts(`${repoPath}/${file}`).map(encodeURIComponent).join('/');
  return `${baseUrl}/${encoded}`;
}

export function getSelection(skills, manual) {
  const requiredBy = new Map();
  for (const id of manual) {
    for (const dep of skills[id].allDeps) {
      if (!requiredBy.has(dep)) requiredBy.set(dep, []);
      requiredBy.get(dep).push(id);
    }
  }
  return { ids: [...new Set([...manual, ...requiredBy.keys()])].sort(), requiredBy };
}

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const existingAgentsWarning = 'ACHTUNG: AGENTS.md existiert bereits und wurde nicht ersetzt.';
const existingAgentsHelp = 'Ergänze die Vorlage manuell oder sichere und entferne die vorhandene AGENTS.md und führe den Befehl erneut aus.';

const installer = String.raw`set -euo pipefail
marker='.skills-hub-managed'

fail() { printf '%s\n' "$*" >&2; exit 1; }

require_download_tools() {
  command -v curl >/dev/null 2>&1 || fail 'curl wird benötigt.'
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail 'sha256sum oder shasum wird benötigt.'
}

# Zielordner anlegen, ohne Symlinks zu folgen.
ensure_dir() {
  [[ ! -L "$1" ]] || fail "Kein Einbau über einen Symlink: $1"
  if [[ ! -d "$1" ]]; then mkdir -- "$1"; fi
}

# Bestehende Ordner nur akzeptieren, wenn sie für diesen Skill als Hub-Installation markiert sind.
check_destination() {
  local dest="$target/$1"
  if [[ -e "$dest" || -L "$dest" ]]; then
    [[ ! -L "$dest" && -d "$dest" && ! -L "$dest/$marker" && -f "$dest/$marker" ]] &&
      [[ "$(cat -- "$dest/$marker")" == "skills-hub:$1" ]] ||
      fail "Nicht vom Skills Hub verwalteter Eintrag bleibt erhalten: $dest"
  fi
}

# Jeden Download gegen die SHA-256-Prüfsumme im Katalog prüfen.
check_hash() {
  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum < "$2")
  else
    actual=$(shasum -a 256 < "$2")
  fi
  actual=$(printf '%s' "$actual" | cut -d ' ' -f 1)
  [[ "$actual" == "$1" ]] || fail "Prüfsumme stimmt nicht: $2 (bitte Hub neu laden)"
}

# Alten Hub-Ordner sichern und zurücklegen, falls der Austausch fehlschlägt.
install_skill() {
  local id="$1" dest="$target/$1"
  check_destination "$id"
  if [[ -d "$dest" ]]; then mv -- "$dest" "$stage/backup/"; fi
  if ! mv -- "$stage/new/$id" "$target/"; then
    if [[ -d "$stage/backup/$id" && ! -e "$dest" && ! -L "$dest" ]]; then
      mv -- "$stage/backup/$id" "$target/" || true
    fi
    fail "Einbau fehlgeschlagen: $dest"
  fi
}

# Ziel prüfen und parallele Hub-Installationen sperren.
[[ "$PWD" != / ]] || fail 'Bitte im Zielprojekt ausführen, nicht im Wurzelverzeichnis.'
lock=''
stage=''
template_stage=''
preserve=0

# Nur den selbst angelegten Arbeitsordner aufräumen. Bei einem Abbruch
# während des Austauschs bleiben dort vorhandene Sicherungen erhalten.
cleanup() {
  if [[ -n "$template_stage" ]]; then
    rm -f -- "$template_stage/AGENTS.md" || true
    rmdir -- "$template_stage" || true
  fi
  if [[ -n "$stage" ]]; then
    if [[ "$preserve" == 1 ]]; then
      printf 'Einbau unterbrochen. Sicherungen können hier liegen: %s/backup\n' "$stage" >&2
    else
      rm -rf -- "$stage" || true
    fi
  fi
  if [[ -n "$lock" ]]; then rmdir -- "$lock" || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if (( $# )); then
  require_download_tools
  ensure_dir "$(dirname -- "$target")"
  ensure_dir "$target"
  mkdir -- "$target/.skills-hub.lock" || fail "Installationssperre vorhanden oder nicht anlegbar: $target/.skills-hub.lock"
  lock="$target/.skills-hub.lock"
  for id in "$@"; do check_destination "$id"; done
  stage=$(mktemp -d "$target/.skills-hub.XXXXXXXX")
  mkdir -- "$stage/new" "$stage/backup"
fi`;

export function generateInstallCommand(skills, manual, tool, downloadBaseUrl, terminal = 'bash', projectTemplate = null) {
  if (!Object.hasOwn(targets, tool)) throw new Error('Unbekanntes Ziel-Tool.');
  if (!Object.hasOwn(terminals, terminal)) throw new Error('Unbekanntes Terminal.');
  const { ids } = getSelection(skills, manual);
  if (!ids.length && !projectTemplate) return '';
  const base = normalizeBaseUrl(downloadBaseUrl);
  if (!base) throw new Error('Keine Download-URL verfügbar.');
  const httpsOnly = base.startsWith('https:');
  const entries = ids.map((id) => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Ungültiger Skill-Name im Manifest.');
    const skill = skills[id];
    const files = skill.files.map((file) => {
      const parts = pathParts(file);
      if (parts.some((part) => part.startsWith('.'))) throw new Error('Versteckter Dateipfad im Manifest.');
      const url = fileUrl(base, skill.repoPath, file);
      const info = skill.fileInfo[file];
      if (!/^[a-f0-9]{64}$/.test(info?.sha256)) throw new Error('Ungültige Prüfsumme im Manifest.');
      return { file, parts, url, sha256: info.sha256, executable: info.executable };
    });
    return { id, files };
  });
  let template = null;
  if (projectTemplate) {
    const { id, repoPath, fileInfo } = projectTemplate;
    const file = 'AGENTS.md';
    const parts = pathParts(repoPath);
    const expectedId = [...parts.slice(1), file].join('/');
    const sha256 = fileInfo?.[file]?.sha256;
    if (parts[0] !== 'project-templates' || parts.some((part) => part.startsWith('.')) ||
        id !== expectedId || !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error('Ungültige Projektvorlage im Manifest.');
    }
    template = { url: fileUrl(base, repoPath, file), sha256, existingAgentsWarning, existingAgentsHelp };
  }
  const target = targets[tool];
  return terminal === 'powershell'
    ? renderPowerShellInstaller(target, entries, httpsOnly, template)
    : renderBashInstaller(target, entries, httpsOnly, template);
}

function renderBashInstaller(target, entries, httpsOnly, template) {
  const redirects = httpsOnly ? '=https' : '=http,https';
  const download = `curl --disable -fsSL --globoff --proto '=http,https' --proto-redir '${redirects}' --`;
  const lines = [
    "bash <<'SKILLS_HUB_INSTALL'",
    '# Im Projektstamm ausführen. Eigene und nicht ausgewählte Skill-Ordner bleiben unverändert.',
    '# Alle Dateien werden heruntergeladen und geprüft, bevor ein Hub-Skill ersetzt wird.',
    `target=${quote(`./${target}`)}`,
    `set -- ${entries.map(({ id }) => quote(id)).join(' ')}`,
    '',
    installer,
    '',
    '# Erst alles herunterladen und prüfen, dann bestehende Installationen ersetzen.',
  ];
  for (const { id, files } of entries) {
    for (const { file, parts, url, sha256, executable } of files) {
      const stagedFile = `"$stage/new/"${quote(`${id}/${file}`)}`;
      lines.push(
        `mkdir -p -- "$stage/new/"${quote([id, ...parts.slice(0, -1)].join('/'))}`,
        `${download} ${quote(url)} > ${stagedFile}`,
        `check_hash '${sha256}' ${stagedFile}`,
      );
      if (executable) lines.push(`chmod +x -- ${stagedFile}`);
    }
    lines.push(`printf '%s\\n' ${quote(`skills-hub:${id}`)} > "$stage/new/"${quote(id)}/"$marker"`);
  }
  if (template) lines.push(
    '', '# Die optionale AGENTS.md separat im Projektstamm vorbereiten.',
    'if [[ ! -e AGENTS.md && ! -L AGENTS.md ]]; then',
    ...(entries.length ? [] : ['  require_download_tools']),
    '  template_stage=$(mktemp -d ./.skills-hub-project.XXXXXXXX)',
    `  ${download} ${quote(template.url)} > "$template_stage/AGENTS.md"`,
    `  check_hash '${template.sha256}' "$template_stage/AGENTS.md"`,
    'fi',
  );
  if (entries.length) lines.push(
    '', '# Alle Downloads sind geprüft. Ziele erneut prüfen und die ausgewählten Skills einbauen.',
    'for id in "$@"; do check_destination "$id"; done', 'preserve=1',
    'for id in "$@"; do install_skill "$id"; done', 'preserve=0',
    "printf 'Installiert unter %s:\\n' \"$target\"", "printf '  %s\\n' \"$@\"",
  );
  if (template) lines.push(
    '', '# Ein Hardlink ins Projekt legt AGENTS.md atomar an, ohne vorhandene Einträge zu ersetzen.',
    'if [[ -n "$template_stage" && ! -e AGENTS.md && ! -L AGENTS.md ]] && ln -- "$template_stage/AGENTS.md" . 2>/dev/null; then',
    "  printf '%s\\n' 'Angelegt: AGENTS.md'",
    'elif [[ -z "$template_stage" || -e AGENTS.md || -L AGENTS.md ]]; then',
    `  printf '\\n%s\\n%s\\n' ${quote(template.existingAgentsWarning)} ${quote(template.existingAgentsHelp)} >&2`,
    'else',
    "  fail 'AGENTS.md konnte nicht angelegt werden.'",
    'fi',
  );
  lines.push('SKILLS_HUB_INSTALL', '');
  return lines.join('\n');
}
