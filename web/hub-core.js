export const targets = Object.freeze({
  claude: '.claude/skills',
  opencode: '.opencode/skills',
  codex: '.agents/skills',
});

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

const installer = String.raw`set -euo pipefail
marker='.skills-hub-managed'

fail() { printf '%s\n' "$*" >&2; exit 1; }

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
command -v curl >/dev/null 2>&1 || fail 'curl wird benötigt.'
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail 'sha256sum oder shasum wird benötigt.'
[[ "$PWD" != / ]] || fail 'Bitte im Zielprojekt ausführen, nicht im Wurzelverzeichnis.'
ensure_dir "$(dirname -- "$target")"
ensure_dir "$target"
lock="$target/.skills-hub.lock"
stage=''
preserve=0
mkdir -- "$lock" || fail "Installationssperre vorhanden oder nicht anlegbar: $lock"

# Nur den selbst angelegten Arbeitsordner aufräumen. Bei einem Abbruch
# während des Austauschs bleiben dort vorhandene Sicherungen erhalten.
cleanup() {
  if [[ -n "$stage" ]]; then
    if [[ "$preserve" == 1 ]]; then
      printf 'Einbau unterbrochen. Sicherungen können hier liegen: %s/backup\n' "$stage" >&2
    else
      rm -rf -- "$stage" || true
    fi
  fi
  rmdir -- "$lock" || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for id in "$@"; do check_destination "$id"; done
stage=$(mktemp -d "$target/.skills-hub.XXXXXXXX")
mkdir -- "$stage/new" "$stage/backup"`;

export function generateInstallCommand(skills, manual, tool, downloadBaseUrl) {
  if (!Object.hasOwn(targets, tool)) throw new Error('Unbekanntes Ziel-Tool.');
  const { ids } = getSelection(skills, manual);
  if (!ids.length) return '';
  const base = normalizeBaseUrl(downloadBaseUrl);
  if (!base) throw new Error('Keine Download-URL verfügbar.');
  const redirects = base.startsWith('https:') ? '=https' : '=http,https';
  const lines = [
    "bash <<'SKILLS_HUB_INSTALL'",
    '# Im Projektstamm ausführen. Eigene und nicht ausgewählte Skill-Ordner bleiben unverändert.',
    '# Alle Dateien werden heruntergeladen und geprüft, bevor ein Hub-Skill ersetzt wird.',
    `target=${quote(`./${targets[tool]}`)}`,
    `set -- ${ids.map(quote).join(' ')}`,
    '',
    installer,
    '',
    '# Erst alles herunterladen und prüfen, dann bestehende Installationen ersetzen.',
  ];
  for (const id of ids) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Ungültiger Skill-Name im Manifest.');
    const skill = skills[id];
    for (const file of skill.files) {
      const parts = pathParts(file);
      if (parts.some((part) => part.startsWith('.'))) throw new Error('Versteckter Dateipfad im Manifest.');
      const url = fileUrl(base, skill.repoPath, file);
      const info = skill.fileInfo[file];
      if (!/^[a-f0-9]{64}$/.test(info?.sha256)) throw new Error('Ungültige Prüfsumme im Manifest.');
      const stagedFile = `"$stage/new/"${quote(`${id}/${file}`)}`;
      lines.push(
        `mkdir -p -- "$stage/new/"${quote([id, ...parts.slice(0, -1)].join('/'))}`,
        `curl --disable -fsSL --globoff --proto '=http,https' --proto-redir '${redirects}' -- ${quote(url)} > ${stagedFile}`,
        `check_hash '${info.sha256}' ${stagedFile}`,
      );
      if (info.executable) lines.push(`chmod +x -- ${stagedFile}`);
    }
    lines.push(`printf '%s\\n' ${quote(`skills-hub:${id}`)} > "$stage/new/"${quote(id)}/"$marker"`);
  }
  lines.push(
    '', '# Alle Downloads sind geprüft. Ziele erneut prüfen und die ausgewählten Skills einbauen.',
    'for id in "$@"; do check_destination "$id"; done', 'preserve=1',
    'for id in "$@"; do install_skill "$id"; done', 'preserve=0',
    "printf 'Installiert unter %s:\\n' \"$target\"", "printf '  %s\\n' \"$@\"", 'SKILLS_HUB_INSTALL', '',
  );
  return lines.join('\n');
}
