import { Window } from 'happy-dom';
import { expect, it } from 'vitest';
import * as toolbar from '../../../packages/zotero/src/reader/toolbar.ts';
import { createToolbarButton, insertToolbarButton, updateToolbarButton } from '../../../packages/zotero/src/reader/toolbar.ts';

function documentOf(): Document {
  return new Window({ url: 'https://zchatgpt.test/' }).document as unknown as Document;
}

it('places a pressed toggle immediately after Find and never invents a second button', () => {
  const doc = documentOf();
  const find = doc.createElement('button');
  find.className = 'find';
  const host = doc.createElement('div');
  host.className = 'toolbar';
  host.append(find);
  doc.body.append(host);
  const button = createToolbarButton(doc, () => undefined);
  insertToolbarButton({ doc, append: (...nodes) => { find.before(...nodes); } }, button);
  expect(button.previousElementSibling).toBe(find);
  expect(host.lastElementChild).toBe(button);
  expect(doc.querySelectorAll('[data-zchatgpt-toggle]')).toHaveLength(1);
  expect(button.getAttribute('aria-pressed')).toBe('false');
  updateToolbarButton(button, true);
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.getAttribute('aria-label')).toBe('Hide Codex sidebar');
});

it('hosts only a Codex sidebar toggle and never New chat, history, or a paper title', () => {
  const doc = documentOf();
  const find = doc.createElement('button');
  find.className = 'find';
  const host = doc.createElement('div');
  host.className = 'toolbar';
  host.append(find);
  doc.body.append(host);
  const button = createToolbarButton(doc, () => undefined);
  insertToolbarButton({ doc, append: (...nodes) => { find.before(...nodes); } }, button);
  expect(button.className).toBe('toolbar-button');
  expect(button.getAttribute('aria-label')).toMatch(/Show Codex sidebar/u);
  expect(button.textContent).not.toMatch(/New chat|Chat history|p\./u);
  expect(host.querySelector('[data-zchatgpt-action="new-conversation"]')).toBeNull();
  expect(host.querySelector('[data-zchatgpt-action="history"]')).toBeNull();
  expect(host.querySelector('[data-zchatgpt-context-title]')).toBeNull();
  expect(host.querySelector('.zchatgpt-chrome')).toBeNull();
  expect(host.children).toHaveLength(2);
  expect([...host.children]).toEqual([find, button]);
});

it('does not measure or impersonate the native reader toolbar height', () => {
  expect(toolbar).not.toHaveProperty('measureReaderToolbarHeight');
  expect(toolbar).not.toHaveProperty('applyReaderToolbarHeight');
  expect(toolbar).not.toHaveProperty('READER_TOOLBAR_HEIGHT_VAR');
  expect(toolbar).not.toHaveProperty('DEFAULT_READER_TOOLBAR_HEIGHT');
});
