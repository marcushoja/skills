import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { marked } from 'marked';
import { parseDocument } from 'yaml';
import { normalizeBaseUrl, splitFrontmatter, targets } from './hub-core.js';

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

function parseYaml(text, file) {
  const document = parseDocument(text);
  if (document.errors.length) throw new Error(`${file}: Ungültiges YAML: ${document.errors[0].message}`);
  return document;
}

function claudeBoolean(value, fallback) {
  if (/^(true|yes|on|1)$/i.test(String(value))) return true;
  if (/^(false|no|off|0)$/i.test(String(value))) return false;
  return fallback;
}

function parseSkill(raw, file, id) {
  const { frontmatter, body } = splitFrontmatter(raw);
  if (frontmatter === null) throw new Error(`${file}: YAML-Frontmatter fehlt`);
  const document = parseYaml(frontmatter, file);
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
  const disableModel = document.get('disable-model-invocation');
  const openCodeAuto = document.getIn(['metadata', 'opencode/autoinvoke']);
  const invocation = {
    claude: {
      automatic: !claudeBoolean(disableModel, false),
      manual: claudeBoolean(document.get('user-invocable'), true),
    },
    opencode: {
      automatic: typeof openCodeAuto === 'boolean' ? openCodeAuto : disableModel !== true,
      manual: true,
    },
  };
  return { description: description.trim(), invocation, refs };
}

function scanProjectTemplates(catalogRoot) {
  const base = 'project-templates';
  const root = path.join(catalogRoot, base);
  const stat = fs.lstatSync(root, { throwIfNoEntry: false });
  const templates = [];
  if (!stat) return { nodes: [], templates };
  if (!stat.isDirectory()) throw new Error(`Kein regulärer Vorlagen-Ordner: ${root}`);

  function scan(parents = []) {
    const repoPath = [base, ...parents].join('/');
    const dir = path.join(catalogRoot, repoPath);
    const entries = visibleEntries(dir).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const nodes = [];
    const file = 'AGENTS.md';
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`Symlinks sind nicht erlaubt: ${path.join(dir, entry.name)}`);
    }
    const own = entries.find(({ name }) => name === file);
    if (own) {
      const source = path.join(dir, file);
      if (!own.isFile()) throw new Error(`Keine reguläre Projektvorlage: ${source}`);
      const bytes = fs.readFileSync(source);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error(`Kein Markdown-Text: ${source}`);
      const id = [...parents, file].join('/');
      const title = text.match(/^[ \t]*#[ \t]+(.+?)[ \t]*$/m)?.[1] ?? parents.at(-1) ?? file;
      templates.push({
        id, title, repoPath, files: [file],
        fileInfo: { [file]: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } },
      });
      nodes.push({ kind: 'template', id });
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = safeName(entry.name);
      const children = scan([...parents, name]);
      if (children.length) nodes.push({ kind: 'category', name, children });
    }
    return nodes;
  }

  return { nodes: scan(), templates };
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

      const { description, invocation, refs } = parseSkill(fs.readFileSync(skillMd, 'utf8'), skillMd, id);
      const files = ['SKILL.md', ...listFiles(fullPath).filter((file) => file !== 'SKILL.md').sort()];
      const codexFile = 'agents/openai.yaml';
      let codexAuto;
      const fileInfo = Object.fromEntries(files.map((file) => {
        const source = path.join(fullPath, file);
        const bytes = fs.readFileSync(source);
        if (file === codexFile) {
          codexAuto = parseYaml(bytes.toString('utf8'), source).getIn(['policy', 'allow_implicit_invocation']);
        }
        return [file, {
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          executable: Boolean(fs.statSync(source).mode & 0o111),
        }];
      }));
      invocation.codex = { automatic: codexAuto !== false, manual: true };
      const archive = `downloads/${id}.zip`;
      skills[id] = { id, type, repoPath, description, invocation, archive, files, fileInfo, directDeps: [], allDeps: [] };
      skillRefs.set(id, refs);
      return [{ kind: 'skill', id }];
    });
  }

  const { nodes: templateNodes, templates: projectTemplates } = scanProjectTemplates(catalogRoot);
  const tree = { workflows: scan('workflows', 'workflow'), skills: scan('skills', 'skill'), projectTemplates: templateNodes };
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

  return { generatedAt: new Date().toISOString(), downloadBaseUrl: normalizeBaseUrl(downloadBaseUrl), tree, skills, projectTemplates };
}

export function buildSite(root, downloadBaseUrl = '') {
  const manifest = createManifest(root, downloadBaseUrl);
  const out = path.join(root, 'dist');
  // dist/ is generated output, including skill files that may disappear between builds.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
  for (const file of ['index.html', 'app.js', 'style.css', 'hub-core.js', 'powershell-installer.js', 'tabler.LICENSE']) {
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
    const archiveFiles = entry.archive ? Object.create(null) : null;
    for (const file of entry.files) {
      const relative = `${entry.repoPath}/${file}`;
      const destination = path.join(out, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(root, catalogDirectory, relative), destination);
      if (archiveFiles) {
        archiveFiles[`${entry.id}/${file}`] = zipFile(out, entry, file);
      }
    }
    if (archiveFiles) {
      const destination = path.join(out, entry.archive);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, zipSync(archiveFiles));
    }
  }
  for (const skill of Object.values(manifest.skills)) {
    skill.packages = Object.fromEntries(Object.entries(targets).map(([tool, target]) => {
      const files = Object.create(null);
      const catalogPath = (entry) => entry.repoPath.slice(entry.repoPath.indexOf('/') + 1);
      // Claude Code documents skill directories as direct children of .claude/skills.
      const projectPath = (entry) => `${target}/${tool === 'claude' ? entry.id : catalogPath(entry)}`;
      for (const entry of [skill, ...skill.allDeps.map((id) => manifest.skills[id])]) {
        for (const file of entry.files) files[`${projectPath(entry)}/${file}`] = zipFile(out, entry, file);
      }
      const archive = `downloads/${tool}/${catalogPath(skill)}.zip`;
      const destination = path.join(out, archive);
      // The ZIP hash in the agent prompt should not change just because the site was rebuilt.
      const bytes = zipSync(files, { mtime: new Date(2000, 0, 1) });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
      return [tool, { archive, projectPath: projectPath(skill), sha256: createHash('sha256').update(bytes).digest('hex') }];
    }));
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function zipFile(out, entry, file) {
  const mode = entry.fileInfo[file].executable ? 0o100755 : 0o100644;
  return [fs.readFileSync(path.join(out, entry.repoPath, file)), { os: 3, attrs: mode << 16 }];
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
