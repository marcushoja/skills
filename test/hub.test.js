import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import { buildSite, createManifest } from '../web/build-manifest.mjs';
import { fileUrl, generateInstallCommand, getAgentPackage, getSelection, getSkillInvocations, normalizeBaseUrl, targets } from '../web/hub-core.js';

const exec = promisify(execFile);

test('Skill-Aufrufe verwenden die echten IDs und das Präfix des Ziel-Tools', () => {
  const manual = new Set(['mh-wf-plan-hinterfragen', 'mh-tdd']);
  assert.deepEqual(getSkillInvocations('claude', manual), ['/mh-tdd', '/mh-wf-plan-hinterfragen']);
  assert.deepEqual(getSkillInvocations('opencode', manual), ['@mh-tdd', '@mh-wf-plan-hinterfragen']);
  assert.deepEqual(getSkillInvocations('codex', manual), ['$mh-tdd', '$mh-wf-plan-hinterfragen']);
  for (const tool of ['antigravity', 'cursor', 'copilot']) {
    assert.deepEqual(getSkillInvocations(tool, manual), ['/mh-tdd', '/mh-wf-plan-hinterfragen']);
  }
  assert.deepEqual(getSkillInvocations('opencode', new Set()), []);
});

test('ADHS-Modus ist ein eigenständiger Skill mit MIT-Lizenz und MH-Aufruf', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { skills } = createManifest(root);
  const id = 'mh-adhs-modus';
  assert.equal(skills[id].repoPath, `skills/produktivitaet/${id}`);
  assert.deepEqual(skills[id].files, ['SKILL.md', 'LICENSE']);
  assert.deepEqual(skills[id].invocation, {
    claude: { automatic: false, manual: true },
    opencode: { automatic: false, manual: true },
    codex: { automatic: true, manual: true },
    antigravity: { automatic: false, manual: true },
    cursor: { automatic: false, manual: true },
    copilot: { automatic: false, manual: true },
  });
  assert.deepEqual(getSelection(skills, new Set([id])).ids, [id]);
  assert.deepEqual(getSkillInvocations('opencode', new Set([id])), [`@${id}`]);
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

test('Aufrufstatus beachtet Defaults, OpenCode-Vorrang und Codex-Policy getrennt', (t) => {
  const repo = tempDir(t);
  addSkill(repo, 'skills', 'mh-default');
  addSkill(repo, 'skills', 'mh-off', '', `name: mh-off
description: Beispiel
user-invocable: off
disable-model-invocation: true
metadata:
  opencode/autoinvoke: true`);
  addSkill(repo, 'skills', 'mh-background', '', `name: mh-background
description: Beispiel
user-invocable: false`);
  addSkill(repo, 'workflows', 'mh-wf-manual', '', `name: mh-wf-manual
description: Beispiel
metadata:
  opencode/autoinvoke: false`);
  write(repo, '_SKILLS/workflows/mh-wf-manual/agents/openai.yaml', 'policy:\n  allow_implicit_invocation: false\n');
  const { skills } = createManifest(repo);
  const both = { automatic: true, manual: true };
  const manual = { automatic: false, manual: true };
  assert.deepEqual(skills['mh-default'].invocation, {
    claude: both, opencode: both, codex: both, antigravity: both, cursor: both, copilot: both,
  });
  assert.deepEqual(skills['mh-off'].invocation, {
    claude: { automatic: false, manual: false }, opencode: both, codex: both,
    antigravity: manual, cursor: manual, copilot: manual,
  });
  assert.deepEqual(skills['mh-wf-manual'].invocation, {
    claude: both, opencode: manual, codex: manual, antigravity: both, cursor: both, copilot: both,
  });
  const selected = new Set(['mh-off', 'mh-wf-manual']);
  assert.deepEqual(getSkillInvocations('claude', selected, skills), ['/mh-wf-manual']);
  assert.deepEqual(getSkillInvocations('opencode', selected, skills), ['@mh-off', '@mh-wf-manual']);
  for (const tool of ['cursor', 'copilot']) {
    assert.deepEqual(skills['mh-background'].invocation[tool], { automatic: true, manual: false });
    assert.deepEqual(getSkillInvocations(tool, new Set(['mh-background', 'mh-off']), skills), ['/mh-off']);
  }
  assert.deepEqual(getSkillInvocations('antigravity', new Set(['mh-background', 'mh-off']), skills), ['/mh-background', '/mh-off']);
});

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

test('ZIP enthält genau den gewählten Skill-Ordner mit Begleitdateien, ohne Abhängigkeiten', (t) => {
  const repo = tempDir(t);
  addSkill(repo, 'skills', 'mh-beispiel');
  const workflow = 'mh-wf-beispiel';
  const source = `_SKILLS/workflows/${workflow}`;
  addSkill(repo, 'workflows', workflow, 'Lade `mh-beispiel`.');
  write(repo, `${source}/LICENSE`, 'MIT');
  write(repo, `${source}/references/Übung #1.md`, 'Begleitdatei');
  const script = write(repo, `${source}/scripts/start.sh`, '#!/bin/sh\n');
  fs.chmodSync(script, 0o755);
  write(repo, `${source}/.intern`, 'nicht ausliefern');
  write(repo, '_SKILLS/project-templates/beispiel/AGENTS.md', '# Vorlage');
  const { skills } = buildSite(repo, 'https://downloads.example/');
  assert.deepEqual(skills[workflow].directDeps, ['mh-beispiel']);
  assert.equal(skills[workflow].archive, `downloads/${workflow}.zip`);
  const archive = fs.readFileSync(path.join(repo, 'dist', skills[workflow].archive));
  const entries = unzipSync(archive);
  assert.deepEqual(Object.keys(entries), skills[workflow].files.map((file) => `${workflow}/${file}`));
  for (const file of skills[workflow].files) {
    assert.deepEqual(Buffer.from(entries[`${workflow}/${file}`]), fs.readFileSync(path.join(repo, source, file)));
  }
  fs.unlinkSync(script);
  buildSite(repo);
  assert.equal(Object.hasOwn(unzipSync(fs.readFileSync(path.join(repo, 'dist', skills[workflow].archive))), `${workflow}/scripts/start.sh`), false);
});

test('Projektpakete bewahren Zielpfade und enthalten verschachtelte Abhängigkeiten; der Prompt verlinkt dasselbe ZIP', (t) => {
  const repo = tempDir(t);
  const id = 'mh-wf-spring-boot';
  const category = 'Java/Spring Boot';
  addSkill(repo, `workflows/${category}`, id, 'Nutze `mh-java`.');
  addSkill(repo, 'skills/Java', 'mh-java', 'Nutze `mh-tests`.');
  addSkill(repo, 'skills/Qualität', 'mh-tests', 'Nutze `mh-java`.');
  addSkill(repo, 'skills/Java', 'mh-unrelated');
  write(repo, '_SKILLS/skills/Qualität/mh-tests/references/Tests.md', 'Begleitdatei');
  write(repo, '_SKILLS/project-templates/java/AGENTS.md', '# Projekt');
  const { skills } = buildSite(repo, 'https://separate-downloads.example/');
  const skill = skills[id];
  const pageUrl = 'https://hub.example/team/index.html';
  const expected = {
    claude: ['Claude Code', '.claude/skills', 'claude', true],
    opencode: ['OpenCode', '.opencode/skills', 'opencode', false],
    codex: ['Codex', '.agents/skills', 'codex', false],
    antigravity: ['Google Antigravity', '.agents/skills', 'agents', true],
    cursor: ['Cursor', '.agents/skills', 'agents', true],
    copilot: ['GitHub Copilot', '.agents/skills', 'agents', true],
  };
  for (const [tool, [name, prefix, layout, flat]] of Object.entries(expected)) {
    const { archive, projectPath, sha256 } = skill.packages[tool];
    assert.equal(targets[tool], prefix);
    const file = (folder, relative = 'SKILL.md') =>
      `${prefix}/${flat ? folder.split('/').at(-1) : folder}/${relative}`;
    assert.equal(archive, `downloads/${layout}/${category}/${id}.zip`);
    assert.equal(`${projectPath}/SKILL.md`, file(`${category}/${id}`));
    const bytes = fs.readFileSync(path.join(repo, 'dist', archive));
    const entries = unzipSync(bytes);
    assert.deepEqual(Object.keys(entries).sort(), [
      file(`${category}/${id}`), file('Java/mh-java'), file('Qualität/mh-tests'),
      file('Qualität/mh-tests', 'references/Tests.md'),
    ].sort());
    assert.equal(Buffer.from(entries[file('Qualität/mh-tests', 'references/Tests.md')]).toString(), 'Begleitdatei');
    assert.equal(sha256, createHash('sha256').update(bytes).digest('hex'));
    const { url, prompt } = getAgentPackage(skill, tool, pageUrl);
    assert.equal(url, `https://hub.example/team/downloads/${layout}/Java/Spring%20Boot/${id}.zip`);
    assert.ok(prompt.includes(`für ${name} im aktuellen Projekt`));
    assert.ok(prompt.includes('mh-java, mh-tests'));
    assert.ok(prompt.includes(`ZIP: ${url}\nSHA-256: ${sha256}`));
    assert.ok(prompt.includes(`${projectPath}/SKILL.md`));
  }
  assert.deepEqual(Object.keys(unzipSync(fs.readFileSync(path.join(repo, 'dist', skills['mh-unrelated'].packages.opencode.archive)))),
    ['.opencode/skills/Java/mh-unrelated/SKILL.md']);
  assert.deepEqual(buildSite(repo).skills[id].packages, skill.packages);
  assert.equal(getAgentPackage(skill, 'toString', pageUrl), null);
  assert.equal(getAgentPackage(undefined, 'opencode', pageUrl), null);
});

const parentTemplatePath = 'project-templates/entwicklung/java/AGENTS.md';
const templatePath = 'project-templates/entwicklung/java/spring-boot/AGENTS.md';
const templateText = '# Spring Boot\n\n- Schreibe Tests für geändertes Verhalten.\n';

test('Build katalogisiert AGENTS.md in Eltern- und Unterordnern separat und ignoriert andere Dateien', (t) => {
  const repo = tempDir(t);
  const source = write(repo, `_SKILLS/${templatePath}`, templateText);
  write(repo, `_SKILLS/${parentTemplatePath}`, '# Java allgemein');
  write(repo, '_SKILLS/project-templates/.privat/AGENTS.md', '# Privat');
  write(repo, '_SKILLS/project-templates/entwicklung/java/spring-boot/README.md', '# Kein Eintrag');
  addSkill(repo, 'skills', 'mh-java', 'Siehe `entwicklung/java/AGENTS.md`.');
  const { tree, skills, projectTemplates } = buildSite(repo);
  assert.deepEqual(skills['mh-java'].allDeps, []);
  assert.deepEqual(projectTemplates.map(({ id, title }) => [id, title]), [
    ['entwicklung/java/AGENTS.md', 'Java allgemein'],
    ['entwicklung/java/spring-boot/AGENTS.md', 'Spring Boot'],
  ]);
  assert.deepEqual(tree.projectTemplates, [{
    kind: 'category', name: 'entwicklung', children: [{
      kind: 'category', name: 'java', children: [
        { kind: 'template', id: 'entwicklung/java/AGENTS.md' },
        { kind: 'category', name: 'spring-boot', children: [{ kind: 'template', id: 'entwicklung/java/spring-boot/AGENTS.md' }] },
      ],
    }],
  }]);
  assert.equal(fs.readFileSync(path.join(repo, 'dist', parentTemplatePath), 'utf8'), '# Java allgemein');
  assert.equal(fs.readFileSync(path.join(repo, 'dist', templatePath), 'utf8'), templateText);
  assert.equal(fs.existsSync(path.join(repo, 'dist/project-templates/.privat')), false);
  assert.equal(fs.existsSync(path.join(repo, 'dist', path.dirname(templatePath), 'README.md')), false);
  const linked = path.join(repo, '_SKILLS/project-templates/anderes');
  fs.mkdirSync(linked);
  fs.symlinkSync(source, path.join(linked, 'AGENTS.md'));
  assert.throws(() => buildSite(repo), /Symlinks sind nicht erlaubt/);
});

const powershell = process.env.SKILLS_HUB_POWERSHELL || 'pwsh';
const skipPowerShell = !process.env.SKILLS_HUB_POWERSHELL &&
  spawnSync(powershell, ['-NoProfile', '-Command', 'exit 0']).error?.code === 'ENOENT'
  ? 'PowerShell nicht verfügbar' : false;

async function installFixture(t, terminal = 'bash') {
  const repo = tempDir(t);
  const project = path.join(tempDir(t), 'Projekt [1] mit Leerzeichen');
  fs.mkdirSync(project);
  const workflow = addSkill(repo, 'workflows/Doku', 'mh-wf-demo', 'Erfordert `mh-doc-demo`.');
  addSkill(repo, 'skills/Doku', 'mh-doc-demo', 'Baustein.');
  const filename = "scripts/hello [1] # ' ’ ä $(touch SHOULD_NOT_EXIST).sh";
  const content = '#!/bin/sh\nprintf "%s\\n" hello\n';
  fs.chmodSync(write(repo, `_SKILLS/skills/Doku/mh-doc-demo/${filename}`, content), 0o755);
  write(repo, `_SKILLS/${templatePath}`, templateText);
  write(repo, `_SKILLS/${parentTemplatePath}`, '# Nicht mitinstallieren');
  const { skills, projectTemplates } = buildSite(repo);
  const template = projectTemplates.find(({ repoPath }) => `${repoPath}/AGENTS.md` === templatePath);
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
  function install(tool = 'claude', { withTemplate = false, withSkills = true } = {}) {
    const manual = new Set(withSkills ? ['mh-wf-demo'] : []);
    const command = generateInstallCommand(skills, manual, tool, `http://127.0.0.1:${server.address().port}`, terminal, withTemplate ? template : null);
    if (terminal === 'powershell') {
      write(project, 'install.ps1', command);
      // Execute the text as pasted input, without changing the execution policy.
      return exec(powershell, ['-NoProfile', '-NonInteractive', '-Command',
        "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Set-Location -LiteralPath ([IO.Directory]::GetCurrentDirectory()); & ([scriptblock]::Create([IO.File]::ReadAllText('install.ps1')))"],
      { cwd: project, timeout: 15000 });
    }
    const script = write(project, 'install.sh', command);
    return exec('bash', [script], { cwd: project, timeout: 5000 });
  }
  return { project, install, filename, content, workflowBody: fs.readFileSync(workflow, 'utf8'), requests, override: (fn) => { override = fn; } };
}

for (const terminal of ['bash', 'powershell']) {
  const skip = terminal === 'powershell' ? skipPowerShell : false;
  test(`${terminal}: Vorlage ist optional, kann allein installiert werden und ersetzt AGENTS.md nie`, { skip }, async (t) => {
    const { project, install, requests } = await installFixture(t, terminal);
    const agents = path.join(project, 'AGENTS.md');
    const claude = write(project, 'CLAUDE.md', 'Eigene Claude-Anweisungen.');
    const { stdout } = await install('claude', { withTemplate: true, withSkills: false });
    assert.match(stdout, /Angelegt: AGENTS\.md/);
    assert.equal(fs.readFileSync(agents, 'utf8'), templateText);
    assert.equal(fs.existsSync(path.join(project, '.claude')), false);
    assert.equal(fs.readFileSync(claude, 'utf8'), 'Eigene Claude-Anweisungen.');
    assert.deepEqual(requests, [templatePath]);

    fs.writeFileSync(agents, 'Projektregeln: Nicht anrühren.');
    const skipped = await install('codex', { withTemplate: true });
    assert.match(skipped.stdout + skipped.stderr, /ACHTUNG: AGENTS\.md existiert bereits und wurde nicht ersetzt\./);
    assert.match(skipped.stdout + skipped.stderr, /Ergänze die Vorlage manuell/);
    assert.equal(fs.readFileSync(agents, 'utf8'), 'Projektregeln: Nicht anrühren.');
    assert.ok(fs.existsSync(path.join(project, targets.codex, 'mh-wf-demo/SKILL.md')));
    assert.equal(requests.filter((file) => file === templatePath).length, 1);

    fs.unlinkSync(agents);
    await install('opencode');
    assert.equal(fs.existsSync(agents), false);
    await install('opencode', { withTemplate: true });
    assert.equal(fs.readFileSync(agents, 'utf8'), templateText);
    assert.ok(!requests.includes(parentTemplatePath));
    assert.equal(fs.readFileSync(claude, 'utf8'), 'Eigene Claude-Anweisungen.');
    assert.ok(fs.readdirSync(project).every((file) => !file.startsWith('.skills-hub-project.')));
  });

  test(`${terminal}: prüft Vorlagen vor dem Austausch und schützt zwischenzeitlich angelegte Dateien`, { skip }, async (t) => {
    const { project, install, override } = await installFixture(t, terminal);
    const agents = path.join(project, 'AGENTS.md');
    await install();
    const skill = write(project, '.claude/skills/mh-doc-demo/SKILL.md', 'vorheriger Stand');
    override((file, response) => {
      if (file !== templatePath) return false;
      response.end('Falsche Vorlage');
      return true;
    });
    await assert.rejects(install('claude', { withTemplate: true }), /Prüfsumme stimmt nicht/);
    assert.equal(fs.existsSync(agents), false);
    assert.equal(fs.readFileSync(skill, 'utf8'), 'vorheriger Stand');
    assert.ok(fs.readdirSync(project).every((file) => !file.startsWith('.skills-hub-project.')));

    override((file, response) => {
      if (file !== templatePath) return false;
      fs.writeFileSync(agents, 'Zwischenzeitlich erstellt.');
      response.end(templateText);
      return true;
    });
    const result = await install('claude', { withTemplate: true });
    assert.match(result.stdout + result.stderr, /ACHTUNG: AGENTS\.md existiert bereits/);
    assert.equal(fs.readFileSync(agents, 'utf8'), 'Zwischenzeitlich erstellt.');
    assert.notEqual(fs.readFileSync(skill, 'utf8'), 'vorheriger Stand');

    fs.unlinkSync(agents);
    fs.symlinkSync(path.join(project, 'nicht-vorhanden.md'), agents, 'file');
    const symlink = await install('claude', { withTemplate: true, withSkills: false });
    assert.match(symlink.stdout + symlink.stderr, /ACHTUNG: AGENTS\.md existiert bereits/);
    assert.ok(fs.lstatSync(agents).isSymbolicLink());
    assert.equal(fs.existsSync(path.join(project, 'nicht-vorhanden.md')), false);
  });
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

test('PowerShell-Generator lehnt POSIX-Dateinamen ab, die unter Windows ungültig sind', () => {
  const filename = 'references/aux.txt';
  const skills = { 'mh-demo': {
    allDeps: [],
    repoPath: 'skills/mh-demo',
    files: [filename],
    fileInfo: { [filename]: { sha256: '0'.repeat(64) } },
  } };
  const manual = new Set(['mh-demo']);
  assert.match(generateInstallCommand(skills, manual, 'claude', 'http://localhost'), /^bash /);
  assert.throws(() => generateInstallCommand(skills, manual, 'claude', 'http://localhost', 'powershell'),
    /Unter Windows ist dieser Dateipfad nicht möglich/);
});

test('PowerShell installiert und aktualisiert Abhängigkeiten, Sonderzeichen und alle Ziele', { skip: skipPowerShell }, async (t) => {
  const { project, install, filename, content, workflowBody, override } = await installFixture(t, 'powershell');
  const external = tempDir(t);
  const untouched = write(external, 'untouched.txt', 'bleibt erhalten');
  // Follow a permitted relative redirect, serving the original bytes at its target.
  override((file, response) => {
    if (file === 'workflows/Doku/mh-wf-demo/SKILL.md') response.writeHead(302, { Location: '/redirected' }).end();
    else if (file === 'redirected') response.end(workflowBody);
    else return false;
    return true;
  });
  for (const [tool, target] of Object.entries(targets)) {
    const skill = `${target}/mh-doc-demo`;
    const own = write(project, `${target}/mein-skill/SKILL.md`, 'manuell');
    const unselected = write(project, `${target}/mh-unselected/.skills-hub-managed`, 'skills-hub:mh-unselected\n');
    const { stdout } = await install(tool);
    assert.match(stdout, /Installiert unter/);
    const installedPath = stdout.split(/\r?\n/)[0].slice('Installiert unter '.length, -1);
    assert.ok(fs.existsSync(path.join(project, skill)), `Unerwarteter Installationspfad: ${installedPath}`);
    assert.equal(fs.readFileSync(path.join(project, skill, filename), 'utf8'), content);
    assert.equal(fs.readFileSync(path.join(project, `${target}/mh-wf-demo/SKILL.md`), 'utf8'), workflowBody);
    assert.equal(fs.readFileSync(path.join(project, skill, '.skills-hub-managed'), 'utf8'), 'skills-hub:mh-doc-demo\n');
    const stale = write(project, `${skill}/stale.md`, 'stale');
    fs.symlinkSync(external, path.join(project, skill, 'verlinkt'), process.platform === 'win32' ? 'junction' : 'dir');
    await install(tool);
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(path.join(project, skill, 'verlinkt')), false);
    assert.equal(fs.readFileSync(untouched, 'utf8'), 'bleibt erhalten');
    assert.equal(fs.readFileSync(own, 'utf8'), 'manuell');
    assert.equal(fs.existsSync(unselected), true);
    assert.deepEqual(fs.readdirSync(path.join(project, target)).sort(), ['mein-skill', 'mh-doc-demo', 'mh-unselected', 'mh-wf-demo']);
  }
  assert.equal(fs.existsSync(path.join(project, 'SHOULD_NOT_EXIST')), false);
});

test('PowerShell schützt eigene Skills und respektiert die Installationssperre', { skip: skipPowerShell }, async (t) => {
  const { project, install, requests } = await installFixture(t, 'powershell');
  const target = path.join(project, '.claude/skills');
  const custom = write(target, 'mh-wf-demo/SKILL.md', 'eigener Workflow');
  const lock = path.join(target, '.skills-hub.lock');
  for (const makeLock of [() => fs.mkdirSync(lock), () => fs.writeFileSync(lock, 'parallel')]) {
    makeLock();
    await assert.rejects(install(), /Installationssperre vorhanden/);
    assert.ok(fs.existsSync(lock));
    fs.rmSync(lock, { recursive: true });
  }
  await assert.rejects(install(), /Nicht vom Skills Hub verwalteter Eintrag bleibt erhalten/);
  assert.deepEqual(requests, []);
  assert.equal(fs.readFileSync(custom, 'utf8'), 'eigener Workflow');
  assert.deepEqual(fs.readdirSync(target), ['mh-wf-demo']);
});

test('PowerShell erhält alte Skills bei HTTP-, Redirect- und Prüfsummenfehlern', { skip: skipPowerShell }, async (t) => {
  const { project, install, override } = await installFixture(t, 'powershell');
  const target = path.join(project, '.claude/skills');
  await install();
  const previous = write(target, 'mh-doc-demo/SKILL.md', 'vorheriger Baustein');
  const workflow = write(target, 'mh-wf-demo/SKILL.md', 'vorheriger Workflow');
  for (const [status, headers, error] of [
    [404, {}, /HTTP 404/],
    [302, { Location: 'file:///unexpected' }, /Nicht erlaubtes Download-Protokoll/],
    [200, {}, /Prüfsumme stimmt nicht/],
  ]) {
    override((file, response) => {
      if (!file.startsWith('workflows/')) return false;
      response.writeHead(status, headers).end('unerwarteter Inhalt');
      return true;
    });
    await assert.rejects(install(), error);
    assert.equal(fs.readFileSync(previous, 'utf8'), 'vorheriger Baustein');
    assert.equal(fs.readFileSync(workflow, 'utf8'), 'vorheriger Workflow');
    assert.deepEqual(fs.readdirSync(target).sort(), ['mh-doc-demo', 'mh-wf-demo']);
  }
});

test('PowerShell folgt weder Ziel-Junctions/Symlinks noch verlinkten Skill-Ordnern', { skip: skipPowerShell }, async (t) => {
  const { project, install, requests } = await installFixture(t, 'powershell');
  const external = tempDir(t);
  write(external, '.skills-hub-managed', 'skills-hub:mh-doc-demo\n');
  const targetParent = path.join(project, '.claude');
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(external, targetParent, type);
  await assert.rejects(install(), /Kein Einbau über einen Symlink oder eine Junction/);
  fs.unlinkSync(targetParent);
  const target = path.join(targetParent, 'skills');
  fs.mkdirSync(target, { recursive: true });
  fs.symlinkSync(external, path.join(target, 'mh-doc-demo'), type);
  await assert.rejects(install(), /Nicht vom Skills Hub verwalteter Eintrag bleibt erhalten/);
  assert.deepEqual(fs.readdirSync(external), ['.skills-hub-managed']);
  assert.deepEqual(requests, []);
});
