import type { ToolbarEvent } from './host-types.ts';

export function createToolbarButton(doc: Document, toggle: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button'; button.className = 'toolbar-button'; button.tabIndex = -1;
  button.dataset.zchatgptToggle = '';
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8l-4 3v-3A1.5 1.5 0 0 1 2.5 13V5A1.5 1.5 0 0 1 4 3.5ZM6 7h8M6 10h5');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.25');
  path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); button.append(svg); button.addEventListener('click', toggle); updateToolbarButton(button, false);
  return button;
}
export function updateToolbarButton(button: HTMLButtonElement, active: boolean): void {
  button.title = active ? 'Hide Codex sidebar' : 'Show Codex sidebar';
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-pressed', String(active)); button.setAttribute('aria-expanded', String(active));
  button.classList.toggle('active', active);
}
export function insertToolbarButton(event: Pick<ToolbarEvent, 'doc' | 'append'>, button: HTMLButtonElement): void {
  event.doc.querySelector('[data-zchatgpt-toggle]')?.remove();
  const search = event.doc.querySelector('.toolbar .find');
  if (search?.parentElement) search.after(button);
  else event.append(button);
}
