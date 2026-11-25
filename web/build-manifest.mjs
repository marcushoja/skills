import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { parseDocument } from 'yaml';
import { normalizeBaseUrl, splitFrontmatter } from './hub-core.js';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const catalogDirectory = '_SKILLS';
const visibleEntries = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .filter(({ name }) => !name.startsWith('.') && !name.endsWith(':Zone.Identifier'));

function safeName(name) {
  if (/[\x00-\x1f\x7f\\]/.test(name)) throw new Error(`Nicht unterstützter Pfadname: ${JSON.stringify(name)}`);
  return name;
}

function listFiles(dir, prefix = '') {
  return visibleEntries(dir).flatMap((entry) => {
    const file = `${prefix}${safeName(entry.name)}`;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, `${file}/`);
    if (entry.isFile()) return [file];
    throw new Error(`Nur reguläre Dateien sind erlaubt: ${fullPath}`);
  });
}

function parseSkill(raw, file, id) {
  const { frontmatter, body } = splitFrontmatter(raw);
  if (frontmatter === null) throw new Error(`${file}: YAML-Frontmatter fehlt`);
  const document = parseDocument(frontmatter);
  if (document.errors.length) throw new Error(`${file}: Ungültiges YAML: ${document.errors[0].message}`);
  const name = document.get('name');
  const description = document.get('description');
  if (name !== id) throw new Error(`${file}: Frontmatter-Feld "name" muss "${id}" entsprechen`);
  if (typeof description !== 'string' || !description.trim()) {
    throw new Error(`${file}: Frontmatter-Feld "description" muss ein nicht leerer Text sein`);
  }

  const refs = new Set();
  marked.walkTokens(marked.lexer(body), (token) => {
    if (token.type === 'codespan' && token.text !== id) refs.add(token.text);
  });
  return { description: description.trim(), refs };
}

function scanProjectTemplates(catalogRoot) {
  const repoPath = 'project-templates';
  const dir = path.join(catalogRoot, repoPath);
  const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!stat) return [];
  if (!stat.isDirectory()) throw new Error(`Kein regulärer Vorlagen-Ordner: ${dir}`);
  return visibleEntries(dir).sort((a, b) => a.name.localeCompare(b.name, 'de')).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Symlinks sind nicht erlaubt: ${path.join(dir, entry.name)}`);
    if (!entry.name.endsWith('.md')) return [];
    const file = entry.name;
    const id = file.slice(0, -3);
    if (!entry.isFile() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`Ungültige Projektvorlage: ${path.join(dir, file)}`);
    }
    const bytes = fs.readFileSync(path.join(dir, file));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error(`Kein Markdown-Text: ${file}`);
    const title = text.match(/^[ \t]*#[ \t]+(.+?)[ \t]*$/m)?.[1] ?? id;
    return [{
      id, title, repoPath, files: [file],
      fileInfo: { [file]: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } },
    }];
  });
}

export function createManifest(root, downloadBaseUrl = '') {
  const skills = Object.create(null);
  const skillRefs = new Map();
  const catalogRoot = path.join(root, catalogDirectory);
  const catalogStat = fs.lstatSync(catalogRoot, { throwIfNoEntry: false });
  if (catalogStat && !catalogStat.isDirectory()) {
    throw new Error(`Kein regulärer Katalog-Ordner: ${catalogRoot}`);
  }

  function scan(publicDir, type) {
    const dir = path.join(catalogRoot, publicDir);
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!stat) return [];
    if (!stat.isDirectory()) throw new Error(`Kein regulärer Kategorie-Ordner: ${dir}`);
    return visibleEntries(dir).sort((a, b) => a.name.localeCompare(b.name, 'de')).flatMap((entry) => {
      if (entry.isSymbolicLink()) throw new Error(`Symlinks sind nicht erlaubt: ${path.join(dir, entry.name)}`);
      if (!entry.isDirectory()) return [];
      const id = safeName(entry.name);
      // Keep the manifest's public path stable even when sources move.
      const repoPath = `${publicDir}/${id}`;
      const fullPath = path.join(dir, id);
      const skillMd = path.join(fullPath, 'SKILL.md');
      const skillStat = fs.lstatSync(skillMd, { throwIfNoEntry: false });
      if (!skillStat) {
        const children = scan(repoPath, type);
        return children.length ? [{ kind: 'category', name: id, children }] : [];
      }

      if (!skillStat.isFile()) throw new Error(`Keine reguläre Datei: ${skillMd}`);
      if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Ungültiger Skill-Name: ${fullPath}`);
      if (type === 'workflow' ? !/^mh-wf-.+/.test(id) : !/^mh-.+/.test(id) || id.startsWith('mh-wf-')) {
        throw new Error(`Falsches Präfix für ${type}: ${fullPath}`);
      }
      if (Object.hasOwn(skills, id)) {
        throw new Error(`Doppelter Skill-Name "${id}": ${skills[id].repoPath} und ${repoPath}`);
      }

      const { description, refs } = parseSkill(fs.readFileSync(skillMd, 'utf8'), skillMd, id);
      const files = ['SKILL.md', ...listFiles(fullPath).filter((file) => file !== 'SKILL.md').sort()];
      const fileInfo = Object.fromEntries(files.map((file) => {
        const source = path.join(fullPath, file);
        const bytes = fs.readFileSync(source);
        return [file, {
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          executable: Boolean(fs.statSync(source).mode & 0o111),
        }];
      }));
      skills[id] = { id, type, repoPath, description, files, fileInfo, directDeps: [], allDeps: [] };
      skillRefs.set(id, refs);
      return [{ kind: 'skill', id }];
    });
  }

  const tree = { workflows: scan('workflows', 'workflow'), skills: scan('skills', 'skill') };
  for (const skill of Object.values(skills)) {
    skill.directDeps = [...skillRefs.get(skill.id)].filter((id) => Object.hasOwn(skills, id)).sort();
  }
  for (const skill of Object.values(skills)) {
    const visited = new Set([skill.id]);
    const pending = [...skill.directDeps];
    while (pending.length) {
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      pending.push(...skills[id].directDeps);
    }
    visited.delete(skill.id);
    skill.allDeps = [...visited].sort();
  }

  const projectTemplates = scanProjectTemplates(catalogRoot);
  return { generatedAt: new Date().toISOString(), downloadBaseUrl: normalizeBaseUrl(downloadBaseUrl), tree, skills, projectTemplates };
}

export function buildSite(root, downloadBaseUrl = '') {
  const manifest = createManifest(root, downloadBaseUrl);
  const out = path.join(root, 'dist');
  // dist/ is generated output, including skill files that may disappear between builds.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
  for (const file of ['index.html', 'app.js', 'style.css', 'hub-core.js', 'powershell-installer.js']) {
    fs.copyFileSync(path.join(webDir, file), path.join(out, file));
  }
  const modules = path.join(webDir, '..', 'node_modules');
  for (const [source, dest] of [
    ['marked/lib/marked.esm.js', 'marked.js'],
    ['marked/LICENSE', 'marked.LICENSE'],
    ['dompurify/dist/purify.es.mjs', 'purify.mjs'],
    ['dompurify/LICENSE', 'purify.LICENSE'],
  ]) {
    fs.copyFileSync(path.join(modules, source), path.join(out, 'vendor', dest));
  }
  for (const entry of [...Object.values(manifest.skills), ...manifest.projectTemplates]) {
    for (const file of entry.files) {
      const relative = `${entry.repoPath}/${file}`;
      const destination = path.join(out, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, catalogDirectory, relative), destination);
    }
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = buildSite(path.dirname(webDir), process.env.DOWNLOAD_BASE_URL);
    console.log(`Skills Hub gebaut: ${Object.keys(manifest.skills).length} Skills und Workflows, ${manifest.projectTemplates.length} Projektvorlagen in dist/.`);
  } catch (error) {
    console.error(`Build fehlgeschlagen: ${error.message}`);
    process.exitCode = 1;
  }
}
