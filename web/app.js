import { marked } from './vendor/marked.js';
import DOMPurify from './vendor/purify.mjs';
import { fileUrl, generateInstallCommand, getSelection, getSkillInvocations, splitFrontmatter, targets, terminals } from './hub-core.js';

const $ = (id) => document.getElementById(id);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, className) => {
  const node = element('button', text, className);
  node.type = 'button';
  return node;
};
const sourceBase = window.location.origin;
const preferences = [
  ['tool', 'skills-hub.target-tool', targets],
  ['terminal', 'skills-hub.terminal', terminals],
];
const manual = new Set();
const projectTemplates = new Map();
const skillRows = new Map();
const fileButtons = new Map();
const toolHelp = document.querySelectorAll('[data-tool-help]');
const templateChoices = $('template-choices');
let manifest;
let activePreview;
let previewRequest;

function renderTree(nodes, parent) {
  const list = element('ul', undefined, 'tree-list');
  for (const node of nodes) {
    const item = element('li');
    if (node.kind === 'category') {
      const section = element('details');
      section.open = true;
      section.append(element('summary', node.name));
      renderTree(node.children, section);
      item.append(section);
    } else if (node.kind === 'template') {
      const template = projectTemplates.get(node.id);
      const row = element('div', undefined, 'skill-row');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'project-template';
      radio.value = node.id;
      radio.setAttribute('aria-label', `Vorlage ${template.title} installieren`);
      const name = button(template.title, 'skill-name');
      name.addEventListener('click', () => showProjectTemplate(template, name));
      row.append(radio, name);
      item.append(row);
    } else {
      const row = element('div', undefined, 'skill-row');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `${node.id} installieren`);
      const name = button(node.id, 'skill-name');
      const reason = element('small', undefined, 'required');
      reason.id = `required-${node.id}`;
      reason.hidden = true;
      checkbox.setAttribute('aria-describedby', reason.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) manual.add(node.id);
        else manual.delete(node.id);
        updateSelection();
      });
      name.addEventListener('click', () => showSkill(node.id));
      row.append(checkbox, name, reason);
      item.append(row);
      skillRows.set(node.id, { checkbox, name, reason });
    }
    list.append(item);
  }
  parent.append(list);
}

async function copyField(field, status) {
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = 'Kopiert.';
  } catch {
    field.select();
    status.textContent = document.execCommand('copy') ? 'Kopiert.' : 'Befehl markiert. Bitte manuell kopieren.';
  }
}

function updateInvocations(tool) {
  for (const help of toolHelp) help.hidden = help.dataset.toolHelp !== tool;
  const list = $('skill-invocations');
  const status = $('invocation-status');
  const invocations = getSkillInvocations(tool, manual);
  status.textContent = '';
  list.hidden = !invocations.length;
  list.replaceChildren(...invocations.map((invocation) => {
    const item = element('li', undefined, 'controls');
    const field = element('input', undefined, 'invocation');
    field.value = invocation;
    field.readOnly = true;
    field.setAttribute('aria-label', `Skill-Aufruf ${invocation}`);
    const copy = button('Aufruf kopieren', 'quiet');
    copy.setAttribute('aria-label', `Aufruf ${invocation} kopieren`);
    copy.addEventListener('click', () => copyField(field, status));
    item.append(field, copy);
    return item;
  }));
}

function updateSelection() {
  const tool = $('tool').value;
  const terminal = $('terminal').value;
  $('target').textContent = targets[tool];
  $('command-help').textContent = `Kopiere den gesamten Block und füge ihn im Projektstamm in ${terminals[terminal]} ein.`;
  $('copy-status').textContent = '';
  updateInvocations(tool);
  if (!manifest) return;
  const template = projectTemplates.get(templateChoices.querySelector('input:checked')?.value);
  const { ids, requiredBy } = getSelection(manifest.skills, manual);
  for (const [id, { checkbox, reason }] of skillRows) {
    const required = requiredBy.get(id);
    checkbox.checked = manual.has(id) || Boolean(required);
    checkbox.disabled = Boolean(required);
    reason.hidden = !required;
    reason.textContent = required ? `Benötigt von: ${required.join(', ')}` : '';
  }
  const selected = [];
  if (ids.length) selected.push(`${ids.length} Skills insgesamt · ${manual.size} direkt ausgewählt`);
  if (template) selected.push(`AGENTS.md: ${template.title} (falls nicht vorhanden)`);
  $('selection').textContent = selected.join(' · ') || 'Keine Auswahl';
  $('clear').disabled = !manual.size && !template;
  document.querySelector('.after-install').hidden = Boolean(template && !ids.length);
  try {
    $('command').value = generateInstallCommand(manifest.skills, manual, tool, manifest.downloadBaseUrl || sourceBase, terminal, template);
  } catch (error) {
    $('command').value = '';
    $('copy-status').textContent = error.message;
  }
  $('copy').disabled = !$('command').value;
}

function setActivePreview(name) {
  activePreview?.removeAttribute('aria-current');
  activePreview = name;
  activePreview.setAttribute('aria-current', 'true');
}

function showProjectTemplate(template, name) {
  setActivePreview(name);
  $('preview-title').textContent = template.title;
  $('skill-type').textContent = 'Projektvorlage';
  $('skill-type').hidden = false;
  $('description').textContent = 'Wird als AGENTS.md im Projektstamm angelegt, wenn die Datei noch fehlt.';
  $('dependencies').hidden = true;
  $('files').hidden = true;
  fileButtons.clear();
  void showFile(template, template.files[0]);
}

function showSkill(id) {
  const skill = manifest.skills[id];
  setActivePreview(skillRows.get(id).name);
  $('preview-title').textContent = id;
  $('skill-type').textContent = skill.type === 'workflow' ? 'Workflow' : 'Skill';
  $('skill-type').hidden = false;
  $('description').textContent = skill.description;

  const deps = $('dependencies');
  deps.replaceChildren();
  deps.hidden = !skill.directDeps.length;
  if (skill.directDeps.length) {
    deps.append(element('strong', 'Direkte Abhängigkeiten'));
    const chips = element('div', undefined, 'chips');
    for (const dependency of skill.directDeps) {
      const chip = button(dependency, 'chip');
      chip.addEventListener('click', () => showSkill(dependency));
      chips.append(chip);
    }
    deps.append(chips);
  }

  const files = $('files');
  files.hidden = false;
  files.replaceChildren();
  fileButtons.clear();
  for (const file of skill.files) {
    // License notices ship with the skill but don't need a preview tab.
    if (file === 'LICENSE') continue;
    const tab = button(file, 'file');
    tab.addEventListener('click', () => showFile(skill, file));
    fileButtons.set(file, tab);
    files.append(tab);
  }
  void showFile(skill, 'SKILL.md');
}

function renderMarkdown(skill, file, text, url) {
  const fragment = DOMPurify.sanitize(marked.parse(text), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['img', 'video', 'audio', 'picture', 'source', 'track', 'form', 'input', 'style'],
    FORBID_ATTR: ['style'],
    RETURN_DOM_FRAGMENT: true,
  });
  const paths = new Map(skill.files.map((name) => [fileUrl(sourceBase, skill.repoPath, name), name]));
  for (const link of fragment.querySelectorAll('a[href]')) {
    let dest;
    try { dest = new URL(link.getAttribute('href'), url); } catch { /* Invalid URL. */ }
    if (dest && paths.has(dest.origin + dest.pathname) && !dest.search) {
      const filename = paths.get(dest.origin + dest.pathname);
      link.href = dest.href;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        if (filename !== file) void showFile(skill, filename);
      });
    } else if (dest && ['http:', 'https:'].includes(dest.protocol) && dest.origin !== sourceBase) {
      link.href = dest.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.removeAttribute('href');
    }
  }
  const markdown = element('div', undefined, 'markdown');
  markdown.append(fragment);
  return markdown;
}

async function showFile(skill, file) {
  previewRequest?.abort();
  const request = new AbortController();
  previewRequest = request;
  for (const [name, tab] of fileButtons) tab.setAttribute('aria-pressed', String(name === file));
  const content = $('content');
  content.scrollTop = 0;
  content.scrollLeft = 0;
  const size = skill.fileInfo[file].size;
  if (size > 512 * 1024) {
    content.replaceChildren(element('p', 'Datei zu groß für die Vorschau (max. 512 KiB). Sie wird trotzdem mit installiert.', 'muted'));
    return;
  }
  content.replaceChildren(element('p', 'Datei wird geladen …', 'muted'));
  try {
    const url = fileUrl(sourceBase, skill.repoPath, file);
    const response = await fetch(url, { signal: request.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (request.signal.aborted) return;
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Binary data. */ }
    if (text === undefined || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
      content.replaceChildren(element('p', 'Keine Textvorschau verfügbar. Die Datei wird trotzdem mit installiert.', 'muted'));
    } else if (/\.md$/i.test(file)) {
      const { body, frontmatter } = splitFrontmatter(text);
      const markdown = renderMarkdown(skill, file, body, url);
      content.replaceChildren(markdown);
      if (frontmatter !== null) {
        const meta = element('details', undefined, 'metadata');
        meta.append(element('summary', 'YAML-Frontmatter'), element('pre', frontmatter.trimEnd()));
        content.prepend(meta);
      }
    } else {
      const pre = element('pre');
      pre.append(element('code', text));
      content.replaceChildren(pre);
    }
  } catch (error) {
    if (!request.signal.aborted) content.replaceChildren(element('p', `Datei konnte nicht geladen werden: ${error.message}`));
  }
}

for (const [id, key] of preferences) {
  $(id).addEventListener('change', () => {
    try { window.localStorage.setItem(key, $(id).value); } catch { /* Storage is optional. */ }
    updateSelection();
  });
}
templateChoices.addEventListener('change', updateSelection);
$('clear').addEventListener('click', () => {
  manual.clear();
  $('no-project-template').checked = true;
  updateSelection();
});
$('copy').addEventListener('click', () => copyField($('command'), $('copy-status')));

async function init() {
  for (const [id, key, options] of preferences) {
    $(id).selectedIndex = 0;
    try {
      const saved = window.localStorage.getItem(key);
      if (Object.hasOwn(options, saved)) $(id).value = saved;
    } catch { /* Fall back to the default if storage is unavailable. */ }
  }
  updateSelection();
  try {
    const response = await fetch('./manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json();
    for (const [key, title, description] of [
      ['workflows', 'Workflows', 'Verbinden mehrere Skills zu einem Ablauf.'],
      ['skills', 'Skills', 'Wiederverwendbare Arbeitsanweisungen für einzelne Aufgaben.'],
    ]) {
      const group = element('details', undefined, 'group');
      group.open = true;
      group.append(element('summary', title), element('p', description, 'group-description'));
      const nodes = manifest.tree[key];
      if (nodes.length) renderTree(nodes, group);
      else group.append(element('p', 'Noch keine Einträge.', 'muted'));
      $('tree').append(group);
    }
    if (manifest.tree.projectTemplates?.length) {
      for (const template of manifest.projectTemplates) projectTemplates.set(template.id, template);
      renderTree(manifest.tree.projectTemplates, templateChoices);
      $('project-templates').hidden = false;
    }
    const count = Object.keys(manifest.skills).length;
    const templateCount = projectTemplates.size;
    $('catalog-status').textContent = `${count} ${count === 1 ? 'Skill' : 'Skills'} inkl. Workflows`
      + (templateCount ? ` · ${templateCount} ${templateCount === 1 ? 'Projektvorlage' : 'Projektvorlagen'}` : '');
    updateSelection();
  } catch (error) {
    $('catalog-status').textContent = `Katalog konnte nicht geladen werden: ${error.message}`;
  }
}

void init();
