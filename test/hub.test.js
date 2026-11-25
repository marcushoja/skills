import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildSite, createManifest } from '../web/build-manifest.mjs';
import { fileUrl, generateInstallCommand, getSelection, getSkillInvocations, normalizeBaseUrl, targets } from '../web/hub-core.js';

const exec = promisify(execFile);

test('Skill-Aufrufe verwenden die echten IDs und das Präfix des Ziel-Tools', () => {
  const manual = new Set(['mh-wf-plan-hinterfragen', 'mh-tdd']);
  assert.deepEqual(getSkillInvocations('claude', manual), ['/mh-tdd', '/mh-wf-plan-hinterfragen']);
  assert.deepEqual(getSkillInvocations('opencode', manual), ['@mh-tdd', '@mh-wf-plan-hinterfragen']);
  assert.deepEqual(getSkillInvocations('codex', manual), ['$mh-tdd', '$mh-wf-plan-hinterfragen']);
  assert.deepEqual(getSkillInvocations('opencode', new Set()), []);
});

test('Deutsches Startpaket liefert Abhängigkeiten, Begleitdateien und Lizenzen aus', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { skills } = createManifest(root);
  const entries = {
    'mh-wf-plan-hinterfragen': 'workflows/planung',
    'mh-wf-uebergabe': 'workflows/zusammenarbeit',
    'mh-plan-interview': 'skills/planung',
    'mh-tdd': 'skills/entwicklung',
    'mh-fehlerdiagnose': 'skills/entwicklung',
  };
  for (const [id, category] of Object.entries(entries)) {
    assert.equal(skills[id].repoPath, `${category}/${id}`);
    assert.ok(skills[id].files.includes('LICENSE'), id);
    assert.ok(skills[id].files.includes('agents/openai.yaml'), id);
  }
  const workflow = 'mh-wf-plan-hinterfragen';
  const interview = 'mh-plan-interview';
  const manual = new Set([workflow]);
  assert.deepEqual(skills[workflow].directDeps, [interview]);
  assert.deepEqual(getSelection(skills, manual).ids, [interview, workflow]);
  assert.deepEqual(getSkillInvocations('opencode', manual), [`@${workflow}`]);
  assert.ok(skills['mh-tdd'].files.includes('tests.md'));
  assert.ok(skills['mh-tdd'].files.includes('mocking.md'));
  assert.ok(skills['mh-fehlerdiagnose'].files.includes('scripts/hitl-loop.template.sh'));
  for (const id of ['mh-docs-checklist', 'mh-docs-style', 'mh-wf-docs-review']) {
    assert.equal(Object.hasOwn(skills, id), false, id);
  }
});

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-hub-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root, file, content) {
  const dest = path.join(root, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  return dest;
}

function addSkill(root, parent, id, body = '', header = `name: ${id}\ndescription: Ein Beispiel`) {
  return write(root, `_SKILLS/${parent}/${id}/SKILL.md`, `---\n${header}\n---\n\n${body}`);
}

test('YAML, tiefe Kategorien und zyklische Abhängigkeiten ohne Selbstreferenz', (t) => {
  const repo = tempDir(t);
  addSkill(repo, 'workflows/Kategorie/A', 'mh-wf-review', 'Mit `mh-alpha`, nicht `mh-fehlt`.\n\n```text\n`mh-delta`\n```',
    'name: mh-wf-review\ndescription: >-\n  Prüfung: mit\n  mehrzeiliger Beschreibung.');
  addSkill(repo, 'skills/Kategorie/B', 'mh-alpha', 'Weiter mit `mh-beta` oder `mh-alpha`.');
  addSkill(repo, 'skills', 'mh-beta', 'Siehe `mh-alpha`.');
  addSkill(repo, 'skills', 'mh-delta');
  const { tree, skills, downloadBaseUrl } = createManifest(repo, 'https://downloads.example/test/');
  assert.equal(downloadBaseUrl, 'https://downloads.example/test');
  assert.equal(tree.workflows[0].children[0].children[0].id, 'mh-wf-review');
  assert.equal(skills['mh-wf-review'].description, 'Prüfung: mit mehrzeiliger Beschreibung.');
  assert.deepEqual(skills['mh-wf-review'].directDeps, ['mh-alpha']);
  assert.deepEqual(skills['mh-wf-review'].allDeps, ['mh-alpha', 'mh-beta']);
  assert.deepEqual(skills['mh-alpha'].allDeps, ['mh-beta']);
  const selection = getSelection(skills, new Set(['mh-wf-review']));
  assert.deepEqual(selection.ids, ['mh-alpha', 'mh-beta', 'mh-wf-review']);
  assert.deepEqual(selection.requiredBy.get('mh-beta'), ['mh-wf-review']);
});

const invalidCases = [
  ['ungültige Zeichen', (root) => addSkill(root, 'skills', 'mh_FAKE'), /Ungültiger Skill-Name/],
  ['falsches Skill-Präfix', (root) => addSkill(root, 'skills', 'mh-wf-fake'), /Falsches Präfix/],
  ['falsches Workflow-Präfix', (root) => addSkill(root, 'workflows', 'mh-fake'), /Falsches Präfix/],
  ['doppelte Namen', (root) => { addSkill(root, 'skills', 'mh-fake'); addSkill(root, 'skills/A', 'mh-fake'); }, /Doppelter Skill-Name/],
  ['fehlender Name', (root) => addSkill(root, 'skills', 'mh-fake', '', 'description: Text'), /"name"/],
  ['abweichender Name', (root) => addSkill(root, 'skills', 'mh-fake', '', 'name: mh-other\ndescription: Text'), /"name"/],
  ['fehlende Beschreibung', (root) => addSkill(root, 'skills', 'mh-fake', '', 'name: mh-fake'), /"description"/],
  ['ungültiges YAML', (root) => addSkill(root, 'skills', 'mh-fake', '', 'name: mh-fake\ndescription: ['), /Ungültiges YAML/],
  ['Symlink im Skill', (root) => {
    const skill = addSkill(root, 'skills', 'mh-fake');
    fs.symlinkSync(skill, path.join(path.dirname(skill), 'link.md'));
  }, /Nur reguläre Dateien/],
];
for (const [label, prepare, error] of invalidCases) {
  test(`Build lehnt ${label} ab`, (t) => {
    const repo = tempDir(t);
    prepare(repo);
    assert.throws(() => buildSite(repo), error);
  });
}

test('Build liefert exakt die katalogisierten Skill-Dateien aus, auch nach erneutem Build', (t) => {
  const repo = tempDir(t);
  addSkill(repo, 'skills/Kategorie', 'mh-eins');
  write(repo, '_SKILLS/skills/Kategorie/README.md', 'nicht ausliefern');
  write(repo, '_SKILLS/skills/Kategorie/mh-eins/.env', 'nicht ausliefern');
  write(repo, '_SKILLS/skills/Kategorie/mh-eins/notes:Zone.Identifier', 'nicht ausliefern');
  write(repo, 'skills/mh-alt/SKILL.md', 'außerhalb des Katalogs');
  const reference = 'skills/Kategorie/mh-eins/references/Beispiel #1.md';
  const source = write(repo, `_SKILLS/${reference}`, 'Text');
  const { skills } = buildSite(repo);
  assert.deepEqual(Object.keys(skills), ['mh-eins']);
  const skill = skills['mh-eins'];
  assert.deepEqual(skill.files, ['SKILL.md', 'references/Beispiel #1.md']);
  assert.equal(fileUrl('http://localhost', skill.repoPath, skill.files[1]),
    'http://localhost/skills/Kategorie/mh-eins/references/Beispiel%20%231.md');
  assert.equal(fs.readFileSync(path.join(repo, 'dist', reference), 'utf8'), 'Text');
  assert.equal(fs.existsSync(path.join(repo, 'dist/_SKILLS')), false);
  assert.equal(fs.existsSync(path.join(repo, 'dist/skills/Kategorie/README.md')), false);
  assert.equal(fs.existsSync(path.join(repo, 'dist/skills/Kategorie/mh-eins/.env')), false);
  assert.equal(fs.existsSync(path.join(repo, 'dist/skills/Kategorie/mh-eins/notes:Zone.Identifier')), false);
  fs.unlinkSync(source);
  buildSite(repo);
  assert.equal(fs.existsSync(path.join(repo, 'dist', reference)), false);
  assert.throws(() => normalizeBaseUrl('https://user:pass@example.org'), /DOWNLOAD_BASE_URL/);
});

async function installFixture(t) {
  const repo = tempDir(t);
  const project = tempDir(t);
  addSkill(repo, 'workflows/Doku', 'mh-wf-demo', 'Erfordert `mh-doc-demo`.');
  addSkill(repo, 'skills/Doku', 'mh-doc-demo', 'Baustein.');
  const filename = "scripts/hello [1] # ' $(touch SHOULD_NOT_EXIST).sh";
  const content = '#!/bin/sh\nprintf "%s\\n" hello\n';
  fs.chmodSync(write(repo, `_SKILLS/skills/Doku/mh-doc-demo/${filename}`, content), 0o755);
  const { skills } = buildSite(repo);
  const requests = [];
  let override;
  const server = http.createServer((request, response) => {
    const file = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
    requests.push(file);
    if (override?.(file, response)) return;
    try { response.end(fs.readFileSync(path.join(repo, 'dist', file))); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  function install(tool = 'claude') {
    const command = generateInstallCommand(skills, new Set(['mh-wf-demo']), tool, `http://127.0.0.1:${server.address().port}`);
    const script = write(project, 'install.sh', command);
    return exec('bash', [script], { cwd: project, timeout: 5000 });
  }
  return { project, install, filename, content, requests, override: (fn) => { override = fn; } };
}

test('Echter Bash/curl-Install: alle Ziele, flach, Pfadzeichen, Ausführbarkeit und rückstandsfrei aktualisiert', async (t) => {
  const { project, install, filename, content } = await installFixture(t);
  for (const [tool, target] of Object.entries(targets)) {
    const skill = `${target}/mh-doc-demo`;
    write(project, `${target}/mein-skill/SKILL.md`, 'manuell');
    write(project, `${target}/mh-unselected/.skills-hub-managed`, 'skills-hub:mh-unselected\n');
    await install(tool);
    assert.equal(fs.readFileSync(path.join(project, skill, filename), 'utf8'), content);
    assert.notEqual(fs.statSync(path.join(project, skill, filename)).mode & 0o111, 0);
    assert.equal(fs.existsSync(path.join(project, `${target}/mh-wf-demo/SKILL.md`)), true);
    const stale = write(project, `${skill}/stale.md`, 'stale');
    await install(tool);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.readFileSync(path.join(project, `${target}/mein-skill/SKILL.md`), 'utf8'), 'manuell');
    assert.equal(fs.existsSync(path.join(project, `${target}/mh-unselected`)), true);
    assert.deepEqual(fs.readdirSync(path.join(project, target)).sort(), ['mein-skill', 'mh-doc-demo', 'mh-unselected', 'mh-wf-demo']);
  }
  assert.equal(fs.existsSync(path.join(project, 'SHOULD_NOT_EXIST')), false);
});

test('Eigener gleichnamiger Skill wird geschützt; Abbruch vor dem ersten Download', async (t) => {
  const { project, install, requests } = await installFixture(t);
  const custom = write(project, '.claude/skills/mh-wf-demo/SKILL.md', 'eigener Workflow');
  await assert.rejects(install(), /Nicht vom Skills Hub verwalteter Eintrag bleibt erhalten/);
  assert.deepEqual(requests, []);
  assert.equal(fs.readFileSync(custom, 'utf8'), 'eigener Workflow');
  assert.deepEqual(fs.readdirSync(path.join(project, '.claude/skills')), ['mh-wf-demo']);
});

test('Ein später HTTP-Fehler oder falsche Prüfsumme lässt alle alten Skill-Ordner intakt', async (t) => {
  const { project, install, override } = await installFixture(t);
  const target = path.join(project, '.claude/skills');
  await install();
  write(target, 'mh-doc-demo/SKILL.md', 'vorheriger Baustein');
  write(target, 'mh-wf-demo/SKILL.md', 'vorheriger Workflow');
  for (const [status, error] of [[404, /404/], [200, /Prüfsumme stimmt nicht/]]) {
    override((file, response) => {
      if (!file.startsWith('workflows/')) return false;
      response.writeHead(status).end('unerwarteter Inhalt');
      return true;
    });
    await assert.rejects(install(), error);
    assert.equal(fs.readFileSync(path.join(target, 'mh-doc-demo/SKILL.md'), 'utf8'), 'vorheriger Baustein');
    assert.equal(fs.readFileSync(path.join(target, 'mh-wf-demo/SKILL.md'), 'utf8'), 'vorheriger Workflow');
    assert.deepEqual(fs.readdirSync(target).sort(), ['mh-doc-demo', 'mh-wf-demo']);
  }
});

test('Ziel-Symlinks werden nicht verfolgt', async (t) => {
  const { project, install, requests } = await installFixture(t);
  const external = tempDir(t);
  fs.symlinkSync(external, path.join(project, '.claude'));
  await assert.rejects(install(), /Kein Einbau über einen Symlink/);
  assert.deepEqual(fs.readdirSync(external), []);
  assert.deepEqual(requests, []);
});
