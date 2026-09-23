import type { ActionTaskRecord, ActionTasks } from '../../../contracts/src/tasks.ts';
import type { RuntimeSnapshot } from '../../../contracts/src/runtime.ts';
import { mountTaskView } from '../chat/task-view.ts';
import { clone as copy } from '../../../contracts/src/clone.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';
const XUL = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

export type LibraryMentionKind = 'library' | 'collection' | 'article';
export interface LibraryMentionOption { id: string; kind: LibraryMentionKind; label: string; detail?: string }
export interface LibrarySkillOption { id: string; name: string; description: string }
export interface LibraryAgentLine { id: string; role: 'user' | 'agent'; text: string; state?: 'running' | 'completed' | 'failed' | 'uncertain' }
export interface LibraryAgentWorkbenchState {
  lines: LibraryAgentLine[];
  busy: boolean;
  model: string | null;
  models: Array<{ id: string; label: string }>;
}
export interface LibraryAgentSend {
  question: string;
  skillId: string | null;
  mentions: LibraryMentionOption[];
  modelId: string | null;
}
export interface LibraryAgentWorkbenchOptions {
  document: Document;
  sessionId: string;
  /** Load the same stylesheet used by the Reader sidebar in this main window. */
  stylesheetURL?: string;
  showLibraryTab?(): void;
  load(): Promise<LibraryAgentWorkbenchState>;
  subscribe(listener: (state: LibraryAgentWorkbenchState) => void): () => void;
  send(input: LibraryAgentSend): Promise<void>;
  skills(): Promise<LibrarySkillOption[]>;
  searchMentions(query: string): Promise<LibraryMentionOption[]>;
  getTasks(): Promise<ActionTasks>;
  startLogin(onSnapshot: (snapshot: RuntimeSnapshot) => void): Promise<() => void>;
  readAutomaticContext?(): boolean;
  toggleAutomaticContext?(): boolean;
  openSelectedPdf?(): Promise<void>;
  showChat?(anchor: HTMLElement): Promise<{ title: string; contextStatus: 'bibliography-only' | 'context-disabled' | 'unbound' | 'selection-changed' }>;
  hideChat?(): void;
  openOutput(task: ActionTaskRecord, itemId: string): Promise<void>;
  collectionLabel?(key: string): string;
}
export type LibraryAgentWorkbenchMount = (() => void) & { onTabChange(isLibraryTab: boolean): void };

function failure(error: unknown): string { return error instanceof Error ? error.message : 'The action could not be completed.'; }

/** One main-window Agent workbench. Model output is rendered as text; native tasks stay in the task controller. */
export function mountLibraryAgentWorkbench(options: LibraryAgentWorkbenchOptions): LibraryAgentWorkbenchMount {
  const doc = options.document;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
    const node = doc.createElementNS(XHTML, tag) as HTMLElementTagNameMap[K];
    node.textContent = text;
    return node;
  };
  const keyboardActivate = (node: HTMLElement, run: () => void) => node.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run(); }
  });
  const xul = (tag: string): Element => (doc as Document & { createXULElement?(name: string): Element }).createXULElement?.(tag) ?? doc.createElementNS(XUL, tag);
  const trigger = create('button'); trigger.type = 'button'; trigger.className = 'zchatgpt-library-agent-button';
  trigger.setAttribute('aria-label', 'Open Zotero ChatGPT sidebar'); trigger.title = 'Open Zotero ChatGPT sidebar';
  trigger.dataset.zchatgptLibraryAgent = '';
  const glyph = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); glyph.setAttribute('width', '20'); glyph.setAttribute('height', '20'); glyph.setAttribute('viewBox', '0 0 20 20'); glyph.setAttribute('aria-hidden', 'true');
  const glyphPath = doc.createElementNS(glyph.namespaceURI, 'path'); glyphPath.setAttribute('d', 'M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8l-4 3v-3A1.5 1.5 0 0 1 2.5 13V5A1.5 1.5 0 0 1 4 3.5ZM6 7h8M6 10h5');
  glyphPath.setAttribute('fill', 'none'); glyphPath.setAttribute('stroke', 'currentColor'); glyphPath.setAttribute('stroke-width', '1.25'); glyphPath.setAttribute('stroke-linecap', 'round'); glyphPath.setAttribute('stroke-linejoin', 'round'); glyph.append(glyphPath); trigger.append(glyph);
  const toolbar = doc.getElementById('zotero-items-toolbar');
  const anchor = ['zotero-tb-search', 'zotero-tb-note-add', 'zotero-tb-attachment-add', 'zotero-tb-lookup', 'zotero-tb-add']
    .map(id => doc.getElementById(id)).find(node => node && (!toolbar || node.parentElement === toolbar));
  if (anchor) anchor.after(trigger); else (toolbar ?? doc.getElementById('zotero-toolbar'))?.append(trigger);
  const toolsMenu = doc.getElementById('menu_ToolsPopup');
  const menuItem = toolsMenu ? xul('menuitem') : null;
  if (menuItem) { menuItem.setAttribute('label', 'Zotero Agent'); menuItem.setAttribute('data-zchatgpt-library-agent-menu', ''); toolsMenu?.append(menuItem); }

  const sharedStyles = options.stylesheetURL ? create('link') : null;
  if (sharedStyles) { sharedStyles.rel = 'stylesheet'; sharedStyles.href = options.stylesheetURL!; (doc.head ?? doc.documentElement).append(sharedStyles); }
  const style = create('style'); style.textContent = `
    .zchatgpt-library-agent-button { appearance:none; display:inline-flex; align-items:center; justify-content:center; flex:0 0 32px; width:32px; height:32px; margin-inline-start:4px; border:0; border-radius:5px; color:var(--fill-secondary,GrayText); background:transparent; cursor:pointer; }
    .zchatgpt-library-agent-button:hover, .zchatgpt-library-agent-button[aria-pressed=true] { color:var(--fill-primary,CanvasText); background:var(--fill-quinary,ButtonFace); }
    .zchatgpt-library-agent-button:focus-visible { outline:2px solid var(--fill-secondary,GrayText); outline-offset:1px; }
    .zchatgpt-library-workbench { position:relative; z-index:5; width:var(--zchatgpt-library-width,min(360px,max(260px,50%))); min-width:0; height:100%; min-height:0; flex:0 0 var(--zchatgpt-library-width,min(360px,max(260px,50%))); display:flex; flex-direction:column; border-inline-start:1px solid var(--zchatgpt-border,GrayText); }
    .zchatgpt-library-workbench-floating { position:fixed; z-index:10000; inset:42px 0 0 auto; width:min(400px,100vw); height:auto; flex:0 0 auto; }
    #zotero-pane.zchatgpt-library-dock-open #zotero-items-pane { display:flex !important; flex-direction:row !important; align-items:stretch !important; justify-content:flex-start !important; min-width:0 !important; min-height:0 !important; }
    #zotero-pane.zchatgpt-library-dock-open #zotero-items-tree { flex:1 1 auto !important; min-width:0 !important; min-height:0 !important; }
    #zotero-pane.zchatgpt-library-dock-open #zotero-items-pane-container { flex:1 1 auto !important; min-width:0 !important; }
    .zchatgpt-library-resizer { flex:0 0 6px !important; width:6px !important; min-width:6px !important; max-width:6px !important; align-self:stretch; cursor:ew-resize; background:transparent; }
    .zchatgpt-library-resizer:hover, .zchatgpt-library-resizer:focus-visible { background:var(--fill-quinary,ButtonFace); }
    .zchatgpt-library-resizer:focus-visible { outline:2px solid var(--fill-secondary,GrayText); outline-offset:-2px; }
    .zchatgpt-library-resizer[hidden] { display:none !important; }
    .zchatgpt-library-workbench[hidden], .zchatgpt-library-workbench [hidden] { display:none !important; }
    .zchatgpt-library-workbench .zchatgpt-chrome { flex:0 0 auto; border-bottom:1px solid var(--zchatgpt-border,GrayText); }
    .zchatgpt-library-workbench button, .zchatgpt-library-workbench select { font:inherit; }
    .zchatgpt-library-workbench .zchatgpt-shell-title { margin:0; }
    .zchatgpt-library-workbench .zchatgpt-mode-option { font-size:12px; }
    .zchatgpt-library-header-actions { display:flex; align-items:center; gap:2px; flex:0 0 auto; }
    .zchatgpt-library-header-icon { appearance:none; display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; padding:4px; border:0; border-radius:5px; color:var(--fill-secondary,GrayText); background:transparent; cursor:pointer; }
    .zchatgpt-library-header-icon:hover, .zchatgpt-library-header-icon[aria-expanded=true] { color:var(--fill-primary,CanvasText); background:var(--fill-quinary,ButtonFace); }
    .zchatgpt-library-header-icon[aria-pressed=false] { opacity:.38; }
    .zchatgpt-library-header-icon[aria-pressed=true] { opacity:1; color:var(--fill-primary,CanvasText); }
    .zchatgpt-library-header-icon svg { width:18px; height:18px; }
    .zchatgpt-library-history { position:absolute; z-index:30; top:44px; left:8px; right:8px; max-height:min(300px,50vh); overflow:auto; padding:6px; border:1px solid var(--zchatgpt-border,GrayText); border-radius:8px; background:var(--material-background,Canvas); box-shadow:0 8px 24px color-mix(in srgb, CanvasText 18%, transparent); }
    .zchatgpt-library-history button { display:block; width:100%; min-height:28px; height:auto; padding:6px 8px; border:0; border-radius:5px; color:inherit; background:transparent; text-align:start; white-space:normal; overflow-wrap:anywhere; cursor:pointer; }
    .zchatgpt-library-history button:hover { background:var(--fill-quinary,ButtonFace); }
    .zchatgpt-library-workbench-scroll { position:relative; flex:1; min-height:0; overflow:auto; padding:12px; }
    .zchatgpt-library-empty { min-height:100%; display:flex; justify-content:center; align-items:center; }
    .zchatgpt-library-workbench .zchatgpt-agent-empty-card { max-width:320px; }
    .zchatgpt-library-workbench .zchatgpt-library-start { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
    .zchatgpt-library-workbench .zchatgpt-agent-empty-action { display:flex !important; align-items:center !important; flex-shrink:0; box-sizing:border-box; min-height:32px !important; height:auto !important; margin:0; padding:6px 8px !important; line-height:1.25 !important; }
    .zchatgpt-library-workbench .zchatgpt-agent-empty-action-title { display:block; white-space:normal; line-height:1.3; }
    .zchatgpt-library-line { display:flex; flex-direction:column; margin:0 0 12px; }
    .zchatgpt-library-line[data-state=running] { opacity:.7; }
    .zchatgpt-library-task-heading { margin:16px 0 8px; color:var(--zchatgpt-text-secondary); font-size:12px; font-weight:600; }
    .zchatgpt-library-draft { padding:8px 12px 12px; border-top:1px solid var(--zchatgpt-border,GrayText); }
    .zchatgpt-library-workbench .zchatgpt-composer { box-shadow:none; }
    .zchatgpt-library-workbench .zchatgpt-input:focus, .zchatgpt-library-workbench .zchatgpt-input:focus-visible { outline:none !important; box-shadow:none !important; border:0 !important; }
    .zchatgpt-library-draft .zchatgpt-picker { min-width:110px; max-width:140px; }
    .zchatgpt-library-workbench .zchatgpt-chrome .zchatgpt-picker { min-width:0; max-width:78px; }
    .zchatgpt-library-context { display:flex; flex-wrap:wrap; gap:5px; }
    .zchatgpt-library-chip { appearance:none; border:1px solid var(--zchatgpt-border,GrayText); border-radius:6px; padding:3px 7px; background:var(--fill-quinary,ButtonFace); color:inherit; font-size:12px; cursor:pointer; }
    .zchatgpt-library-send { appearance:none; border:0; border-radius:999px; width:29px; height:29px; background:var(--fill-primary,CanvasText); color:var(--material-background,Canvas); font-size:18px; line-height:1; cursor:pointer; }
    .zchatgpt-library-send:disabled { opacity:.38; cursor:default; }
    .zchatgpt-library-plus { appearance:none; border:0; border-radius:5px; width:28px; height:28px; padding:0; background:transparent; color:var(--fill-secondary,GrayText); font-size:23px; line-height:1; cursor:pointer; }
    .zchatgpt-library-plus:hover, .zchatgpt-library-plus[aria-expanded=true] { background:var(--fill-quinary,ButtonFace); }
    .zchatgpt-library-workbench .zchatgpt-plus-menu { bottom:calc(100% + 6px); }
    .zchatgpt-library-command-menu { position:absolute; inset:auto 12px 116px 12px; z-index:25; max-height:min(280px,45vh); overflow:auto; border:1px solid var(--zchatgpt-border,GrayText); border-radius:10px; background:var(--material-background,Canvas); box-shadow:0 8px 24px color-mix(in srgb, CanvasText 18%, transparent); padding:5px; }
    .zchatgpt-library-command-menu [role=option] { display:flex; flex-direction:column; align-items:stretch; gap:2px; width:100%; min-height:0; height:auto; box-sizing:border-box; text-align:start; padding:8px; background:transparent; color:inherit; border-radius:6px; cursor:pointer; }
    .zchatgpt-library-command-menu [role=option][aria-selected=true], .zchatgpt-library-command-menu [role=option]:hover { background:var(--fill-quinary,ButtonFace); }
    .zchatgpt-library-command-menu [role=option] > span, .zchatgpt-library-command-menu [role=option] > small { display:block; line-height:1.3; white-space:normal; }
    .zchatgpt-library-command-menu small { color:var(--fill-secondary,GrayText); }
    @media (max-width:1100px) { .zchatgpt-library-workbench .zchatgpt-chrome { gap:2px; padding-inline:5px; } .zchatgpt-library-workbench .zchatgpt-shell-title { display:none; } .zchatgpt-library-header-icon { width:24px; height:26px; padding:3px; } }
    @media (max-width:1150px) {
      #zotero-pane.zchatgpt-library-dock-open #zotero-items-pane { flex-direction:column !important; }
      #zotero-pane.zchatgpt-library-dock-open #zotero-items-tree { width:100% !important; min-height:140px !important; flex:1 1 0 !important; }
      .zchatgpt-library-resizer { flex:0 0 6px !important; width:100% !important; min-width:0 !important; max-width:none !important; height:6px !important; min-height:6px !important; max-height:6px !important; cursor:ns-resize; }
      .zchatgpt-library-workbench:not(.zchatgpt-library-workbench-floating) { width:100% !important; flex:0 0 var(--zchatgpt-library-height,55%) !important; height:var(--zchatgpt-library-height,55%) !important; border-inline-start:0; border-block-start:1px solid var(--zchatgpt-border,GrayText); }
    }
  `;
  (doc.head ?? doc.documentElement).append(style);

  const panel = create('section'); panel.className = 'zchatgpt-sidebar zchatgpt-library-workbench'; panel.dataset.zchatgptLibraryAgentPanel = '';
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Zotero Agent'); panel.hidden = true;
  const dock = doc.getElementById('zotero-items-pane');
  const page = doc.getElementById('zotero-pane');
  if (!dock || !page) panel.classList.add('zchatgpt-library-workbench-floating');
  const resizer = dock && page ? create('div') : null;
  if (resizer) { resizer.className = 'zchatgpt-library-resizer'; resizer.setAttribute('role', 'separator'); resizer.setAttribute('aria-label', 'Resize Zotero ChatGPT sidebar'); resizer.setAttribute('aria-orientation', 'vertical'); resizer.tabIndex = 0; resizer.hidden = true; }
  const header = create('div'); header.className = 'zchatgpt-chrome';
  const title = create('strong', 'Zotero Agent'); title.className = 'zchatgpt-shell-title';
  const modeSwitch = create('div'); modeSwitch.className = 'zchatgpt-mode-switch'; modeSwitch.setAttribute('role', 'group'); modeSwitch.setAttribute('aria-label', 'Mode');
  const chatMode = create('button', 'Chat'); chatMode.type = 'button'; chatMode.dataset.zchatgptLibraryMode = 'chat';
  const agentMode = create('button', 'Agent'); agentMode.type = 'button'; agentMode.dataset.zchatgptLibraryMode = 'agent';
  chatMode.className = agentMode.className = 'zchatgpt-mode-option';
  modeSwitch.append(chatMode, agentMode); modeSwitch.hidden = !options.showChat;
  const account = create('button', 'Sign in'); account.type = 'button'; account.className = 'zchatgpt-picker'; account.dataset.zchatgptCodexLogin = '';
  const headerActions = create('div'); headerActions.className = 'zchatgpt-library-header-actions';
  const headerIcon = (label: string, path: string) => {
    const button = create('button'); button.type = 'button'; button.className = 'zchatgpt-library-header-icon'; button.setAttribute('aria-label', label); button.title = label;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
    const stroke = doc.createElementNS(svg.namespaceURI, 'path'); stroke.setAttribute('d', path); stroke.setAttribute('fill', 'none'); stroke.setAttribute('stroke', 'currentColor'); stroke.setAttribute('stroke-width', '1.25'); stroke.setAttribute('stroke-linecap', 'round'); stroke.setAttribute('stroke-linejoin', 'round'); svg.append(stroke); button.append(svg); return button;
  };
  const automatic = headerIcon('Automatic article context', 'M9.5 5.5h1.75c.41 0 .75.34.75.75v6.5c0 .41-.34.75-.75.75h-6.5a.75.75 0 0 1-.75-.75v-6.5c0-.41.34-.75.75-.75H6.5M9.5 5.5v-.75c0-.41-.34-.75-.75-.75h-1.5a.75.75 0 0 0-.75.75v.75M6 8.25h4M6 10.5h4');
  const pdf = headerIcon('Open selected article PDF', 'M9.25 2.5H6.25A1.25 1.25 0 0 0 5 3.75v8.5c0 .69.56 1.25 1.25 1.25h5.5c.69 0 1.25-.56 1.25-1.25V6.75ZM9.25 2.5v3.5c0 .41.34.75.75.75h3M7 11h4');
  const history = headerIcon('Library Agent history', 'M8 2.75a5.25 5.25 0 1 1 0 10.5 5.25 5.25 0 0 1 0-10.5ZM8 5.25V8.2l2.15 1.25'); history.setAttribute('aria-expanded', 'false');
  headerActions.append(automatic, pdf, history, account); header.append(modeSwitch, title, headerActions);
  const historyPanel = create('div'); historyPanel.className = 'zchatgpt-library-history'; historyPanel.setAttribute('role', 'dialog'); historyPanel.setAttribute('aria-label', 'Library Agent history'); historyPanel.hidden = true;
  const accountStatus = create('p'); accountStatus.setAttribute('role', 'status'); accountStatus.dataset.zchatgptCodexLoginStatus = '';
  accountStatus.style.cssText = 'margin:0;padding:5px 12px;color:var(--fill-secondary,GrayText);font-size:11px;border-bottom:1px solid var(--zchatgpt-border,GrayText)'; accountStatus.hidden = true;
  const scroll = create('div'); scroll.className = 'zchatgpt-library-workbench-scroll';
  const lines = create('div'); lines.dataset.zchatgptLibraryMessages = ''; lines.setAttribute('aria-live', 'polite');
  const emptyWrap = create('div'); emptyWrap.className = 'zchatgpt-library-empty';
  const emptyCard = create('div'); emptyCard.className = 'zchatgpt-agent-empty-card';
  const starters = create('div'); starters.className = 'zchatgpt-agent-empty-actions zchatgpt-library-start';
  const starterItems: Array<{ label: string; prompt: string; skill: string }> = [
    { label: 'Find papers', prompt: 'Find recent open-access papers on ', skill: 'discover' },
    { label: 'Organize', prompt: 'Add useful tags and existing collection memberships to the selected papers.', skill: 'organize' },
    { label: 'Fill metadata', prompt: 'Fill missing metadata for the selected articles from their verified DOI.', skill: 'metadata' },
    { label: 'Write note', prompt: 'Write a short abstract-based summary note for the selected article.', skill: 'note' },
  ];
  for (const item of starterItems) {
    const action = create('div'); action.className = 'zchatgpt-agent-empty-action'; action.setAttribute('role', 'button'); action.tabIndex = 0;
    const name = create('span', item.label); name.className = 'zchatgpt-agent-empty-action-title';
    action.append(name);
    const choose = () => {
      selectedSkill = skills.find(skill => skill.id === item.skill) ?? null;
      question.value = item.prompt; question.focus(); question.setSelectionRange(question.value.length, question.value.length);
      renderContext(); render(current);
    };
    action.addEventListener('click', choose); keyboardActivate(action, choose);
    starters.append(action);
  }
  emptyCard.append(starters); emptyWrap.append(emptyCard);
  const taskHeading = create('h3', 'Tasks'); taskHeading.className = 'zchatgpt-library-task-heading'; taskHeading.hidden = true;
  const taskRoot = create('div'); scroll.append(emptyWrap, lines, taskHeading, taskRoot);
  const chatHost = create('div'); chatHost.hidden = true; chatHost.style.cssText = 'flex:1;min-height:0;position:relative';
  const chatNotice = create('p'); chatNotice.dataset.zchatgptLibraryChatNotice = '';
  chatNotice.style.cssText = 'margin:0;padding:5px 12px;color:var(--fill-secondary,GrayText);font-size:11px;border-bottom:1px solid var(--zchatgpt-border,GrayText)';
  chatNotice.hidden = true;
  const composer = create('div'); composer.className = 'zchatgpt-draft zchatgpt-library-draft';
  const composerCard = create('div'); composerCard.className = 'zchatgpt-composer';
  const context = create('div'); context.className = 'zchatgpt-composer-context zchatgpt-library-context'; context.dataset.zchatgptLibraryContext = '';
  const question = create('textarea'); question.className = 'zchatgpt-input'; question.setAttribute('aria-label', 'Message Zotero Agent'); question.placeholder = 'Ask Agent…';
  const actions = create('div'); actions.className = 'zchatgpt-composer-bar';
  const leading = create('div'); leading.className = 'zchatgpt-composer-leading';
  const trailing = create('div'); trailing.className = 'zchatgpt-composer-trailing';
  const plus = create('button', '+'); plus.type = 'button'; plus.className = 'zchatgpt-library-plus'; plus.setAttribute('aria-label', 'Add a skill or Zotero reference'); plus.setAttribute('aria-expanded', 'false');
  const toolMenu = create('div'); toolMenu.className = 'zchatgpt-plus-menu'; toolMenu.setAttribute('role', 'dialog'); toolMenu.setAttribute('aria-label', 'Add to Agent request'); toolMenu.hidden = true;
  const skillsButton = create('div'); skillsButton.className = 'zchatgpt-plus-row'; skillsButton.setAttribute('role', 'button'); skillsButton.tabIndex = 0; skillsButton.setAttribute('aria-label', 'Add a skill');
  skillsButton.append(create('span', 'Add a skill'), create('span', 'Choose what Agent should do')); skillsButton.firstElementChild!.className = 'zchatgpt-plus-row-title'; skillsButton.lastElementChild!.className = 'zchatgpt-plus-row-description';
  const mentionsButton = create('div'); mentionsButton.className = 'zchatgpt-plus-row'; mentionsButton.setAttribute('role', 'button'); mentionsButton.tabIndex = 0; mentionsButton.setAttribute('aria-label', 'Add a Zotero reference');
  mentionsButton.append(create('span', 'Add a Zotero reference'), create('span', 'Library, collection, or article')); mentionsButton.firstElementChild!.className = 'zchatgpt-plus-row-title'; mentionsButton.lastElementChild!.className = 'zchatgpt-plus-row-description';
  toolMenu.append(mentionsButton, skillsButton);
  const model = create('select'); model.className = 'zchatgpt-picker'; model.setAttribute('aria-label', 'Agent model');
  const send = create('button', '↑'); send.type = 'button'; send.className = 'zchatgpt-library-send'; send.dataset.zchatgptLibrarySend = ''; send.setAttribute('aria-label', 'Send to Agent');
  leading.append(plus); trailing.append(model, send); actions.append(leading, trailing); composerCard.append(context, question, actions, toolMenu); composer.append(composerCard);
  const commandMenu = create('div'); commandMenu.className = 'zchatgpt-library-command-menu'; commandMenu.setAttribute('role', 'listbox'); commandMenu.hidden = true;
  const error = create('p'); error.setAttribute('role', 'alert'); error.hidden = true; error.style.cssText = 'margin:0;padding:6px 12px;color:var(--accent-red,#c22)';
  panel.append(header, historyPanel, accountStatus, chatNotice, scroll, chatHost, commandMenu, error, composer);
  if (dock) { if (resizer) dock.append(resizer); dock.append(panel); }
  else (doc.body ?? doc.documentElement).append(panel);

  const resizePanel = (desired: number) => {
    if (!dock || !resizer) return;
    const vertical = doc.defaultView?.getComputedStyle(dock).flexDirection === 'column';
    resizer.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
    const available = vertical ? dock.getBoundingClientRect().height : dock.getBoundingClientRect().width;
    if (!Number.isFinite(available) || available < 300) return;
    const maximum = Math.max(160, Math.min(vertical ? 460 : 600, available - (vertical ? 140 : 180)));
    const minimum = Math.min(vertical ? 180 : 220, maximum);
    const size = Math.max(minimum, Math.min(maximum, Math.round(desired)));
    panel.style.setProperty(vertical ? '--zchatgpt-library-height' : '--zchatgpt-library-width', `${size}px`);
    resizer.setAttribute('aria-valuenow', String(size));
  };
  let drag: { coordinate: number; size: number; pointerId: number; vertical: boolean } | null = null;
  resizer?.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const vertical = doc.defaultView?.getComputedStyle(dock!).flexDirection === 'column';
    const rect = panel.getBoundingClientRect();
    drag = { coordinate: vertical ? event.clientY : event.clientX, size: vertical ? rect.height : rect.width, pointerId: event.pointerId, vertical };
    resizer.setPointerCapture?.(event.pointerId); event.preventDefault();
  });
  resizer?.addEventListener('pointermove', event => { if (drag?.pointerId === event.pointerId) resizePanel(drag.size + drag.coordinate - (drag.vertical ? event.clientY : event.clientX)); });
  const finishDrag = () => { drag = null; };
  resizer?.addEventListener('pointerup', finishDrag); resizer?.addEventListener('pointercancel', finishDrag);
  resizer?.addEventListener('keydown', event => {
    const vertical = doc.defaultView?.getComputedStyle(dock!).flexDirection === 'column';
    const grow = vertical ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
    const shrink = vertical ? event.key === 'ArrowDown' : event.key === 'ArrowRight';
    if (!grow && !shrink) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect(); resizePanel((vertical ? rect.height : rect.width) + (grow ? 24 : -24));
  });
  const onWindowResize = () => {
    if (panel.hidden || !dock || !resizer) return;
    const vertical = doc.defaultView?.getComputedStyle(dock).flexDirection === 'column';
    resizer.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
    const saved = panel.style.getPropertyValue(vertical ? '--zchatgpt-library-height' : '--zchatgpt-library-width');
    if (saved) resizePanel(Number.parseFloat(saved));
  };
  doc.defaultView?.addEventListener('resize', onWindowResize);

  let current: LibraryAgentWorkbenchState = { lines: [], busy: false, model: null, models: [] };
  let selectedSkill: LibrarySkillOption | null = null;
  const mentions: LibraryMentionOption[] = [];
  let skills: LibrarySkillOption[] = [];
  let menuEntries: Array<{ kind: 'skill' | 'mention'; id: string; label: string; detail: string }> = [];
  let menuIndex = 0;
  let triggerRange: { start: number; end: number } | null = null;
  let querySerial = 0; let composing = false; let busy = false; let disposed = false;
  let chosenModelId: string | null = null;
  let mode: 'agent' | 'chat' = options.showChat ? 'chat' : 'agent'; let modeGeneration = 0;
  let unsubscribe: (() => void) | undefined; let unsubscribeTasks: (() => void) | undefined; let unsubscribeLogin: (() => void) | undefined;
  let taskPort: ActionTasks | undefined;
  const selectionTree = doc.getElementById('zotero-items-tree');
  let selectionTimer: number | null = null;
  const paintChat = (result: { title: string; contextStatus: 'bibliography-only' | 'context-disabled' | 'unbound' | 'selection-changed' }) => {
    title.textContent = result.title ? `Chat · ${result.title}` : 'ChatGPT';
    chatNotice.textContent = result.contextStatus === 'bibliography-only' ? 'On send, ChatGPT receives available bibliography and saved abstract. No PDF body text.'
      : result.contextStatus === 'context-disabled' ? 'Automatic article context is off.'
        : result.contextStatus === 'selection-changed' ? 'Finish the current Chat draft before switching articles.'
          : 'Select one Zotero article to chat.';
    chatNotice.hidden = false;
  };
  const refreshSelectedChat = () => {
    if (disposed || panel.hidden || mode !== 'chat' || !options.showChat) return;
    const generation = modeGeneration;
    void options.showChat(chatHost).then(result => {
      if (disposed || panel.hidden || mode !== 'chat' || generation !== modeGeneration) return;
      paintChat(result); error.hidden = true;
    }).catch(caught => { if (!disposed && !panel.hidden && mode === 'chat') { error.textContent = failure(caught); error.hidden = false; } });
  };
  const scheduleSelectedChat = () => {
    if (selectionTimer !== null) doc.defaultView?.clearTimeout(selectionTimer);
    selectionTimer = doc.defaultView?.setTimeout(() => { selectionTimer = null; refreshSelectedChat(); }, 80) ?? null;
  };
  selectionTree?.addEventListener('click', scheduleSelectedChat, true);
  selectionTree?.addEventListener('keyup', scheduleSelectedChat, true);
  const selectionObserver = selectionTree && doc.defaultView?.MutationObserver
    ? new doc.defaultView.MutationObserver(scheduleSelectedChat) : null;
  selectionObserver?.observe(selectionTree!, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-selected'] });

  const paintAutomaticContext = () => {
    const enabled = options.readAutomaticContext?.() ?? true;
    automatic.setAttribute('aria-pressed', String(enabled));
    automatic.title = `Automatic article context: ${enabled ? 'on' : 'off'}`;
    automatic.disabled = !options.toggleAutomaticContext;
  };
  paintAutomaticContext();
  const closeHistory = () => { historyPanel.hidden = true; history.setAttribute('aria-expanded', 'false'); };
  const paintHistory = () => {
    historyPanel.replaceChildren();
    if (!current.lines.length) { historyPanel.append(create('p', 'No library Agent messages yet.')); return; }
    for (const line of current.lines.slice(-30).reverse()) {
      const row = create('button', `${line.role === 'user' ? 'You' : 'Agent'} · ${line.text.slice(0, 140)}`); row.type = 'button';
      row.addEventListener('click', () => {
        const target = [...lines.querySelectorAll<HTMLElement>('[data-zchatgpt-library-message-id]')].find(node => node.dataset.zchatgptLibraryMessageId === line.id);
        target?.scrollIntoView?.({ block: 'center' }); closeHistory();
      });
      historyPanel.append(row);
    }
  };

  const renderContext = () => {
    context.replaceChildren();
    const chip = (label: string, remove: () => void) => {
      const button = create('button', `${label} ×`); button.type = 'button'; button.className = 'zchatgpt-library-chip'; button.setAttribute('aria-label', `Remove ${label}`);
      button.addEventListener('click', remove); context.append(button);
    };
    if (selectedSkill) chip(`/${selectedSkill.name}`, () => { selectedSkill = null; renderContext(); render(current); question.focus(); });
    for (const mention of mentions) chip(`@${mention.label}`, () => { const index = mentions.findIndex(row => row.id === mention.id); if (index >= 0) mentions.splice(index, 1); renderContext(); render(current); question.focus(); });
  };
  const render = (state: LibraryAgentWorkbenchState) => {
    current = copy(state); emptyWrap.hidden = state.lines.length > 0 || !!question.value.trim() || !!selectedSkill || mentions.length > 0;
    const previousBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    lines.replaceChildren(...state.lines.map(line => {
      const node = create('article'); node.className = 'zchatgpt-message zchatgpt-library-line'; node.dataset.role = line.role === 'agent' ? 'assistant' : 'user'; node.dataset.state = line.state ?? 'completed';
      const body = create('div'); body.className = 'zchatgpt-message-body';
      const content = create('div', line.text); content.className = 'zchatgpt-message-text'; body.append(content); node.append(body);
      node.dataset.zchatgptLibraryMessageId = line.id; return node;
    }));
    if (previousBottom < 36) scroll.scrollTop = scroll.scrollHeight;
    const modelPlaceholder = create('option', 'Sign in for models'); modelPlaceholder.value = '';
    model.replaceChildren(...(state.models.length ? state.models.map(option => { const node = create('option', option.label); node.value = option.id; return node; }) : [modelPlaceholder]));
    model.disabled = state.models.length < 2;
    if (chosenModelId && !state.models.some(option => option.id === chosenModelId)) chosenModelId = null;
    model.value = chosenModelId ?? state.model ?? state.models[0]?.id ?? '';
    send.disabled = state.busy || busy || !question.value.trim();
    if (!historyPanel.hidden) paintHistory();
  };
  const renderTasks = async () => {
    if (!taskPort) return;
    const tasks = await taskPort.list(options.sessionId);
    taskHeading.hidden = tasks.length === 0;
    if (tasks.length) emptyWrap.hidden = true;
    else render(current);
    taskView?.update({ tasks });
  };
  let taskView: ReturnType<typeof mountTaskView> | undefined;
  const closeToolMenu = () => { toolMenu.hidden = true; plus.setAttribute('aria-expanded', 'false'); };
  const closeMenu = () => { commandMenu.hidden = true; commandMenu.replaceChildren(); menuEntries = []; triggerRange = null; };
  const chooseMenu = (index: number) => {
    const chosen = menuEntries[index]; if (!chosen) return;
    if (chosen.kind === 'skill') selectedSkill = skills.find(item => item.id === chosen.id) ?? null;
    else {
      const mention = mentionResults.find(item => item.id === chosen.id);
      if (mention && !mentions.some(item => item.id === mention.id)) mentions.push(copy(mention));
    }
    if (triggerRange) question.setRangeText('', triggerRange.start, triggerRange.end, 'end');
    closeMenu(); renderContext(); question.focus(); render(current);
  };
  let mentionResults: LibraryMentionOption[] = [];
  const showMenu = async (mode: 'skill' | 'mention', query: string, range: { start: number; end: number } | null) => {
    closeToolMenu(); const serial = ++querySerial; triggerRange = range;
    try {
      const optionsList = mode === 'skill'
        ? skills.filter(item => `${item.name} ${item.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item => ({ kind: 'skill' as const, id: item.id, label: `/${item.name}`, detail: item.description }))
        : (mentionResults = await options.searchMentions(query)).slice(0, 30).map(item => ({ kind: 'mention' as const, id: item.id, label: `@${item.label}`, detail: [item.kind, item.detail].filter(Boolean).join(' · ') }));
      if (disposed || serial !== querySerial) return;
      menuEntries = optionsList; menuIndex = 0; commandMenu.hidden = false;
      commandMenu.replaceChildren(...optionsList.map((entry, index) => {
        const row = create('div'); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === menuIndex)); row.tabIndex = -1;
        row.append(create('span', entry.label), create('small', entry.detail)); row.addEventListener('click', () => chooseMenu(index)); return row;
      }));
      if (!optionsList.length) commandMenu.append(create('p', mode === 'skill' ? 'No matching skills.' : 'No matching Zotero items or collections.'));
    } catch (caught) { if (!disposed && serial === querySerial) { error.textContent = failure(caught); error.hidden = false; closeMenu(); } }
  };
  const detectTrigger = () => {
    if (composing) return;
    const before = question.value.slice(0, question.selectionStart);
    const match = /(?:^|\s)([/@])([^\s/@]*)$/u.exec(before);
    if (!match) { closeMenu(); return; }
    const start = question.selectionStart - match[1]!.length - match[2]!.length;
    void showMenu(match[1] === '/' ? 'skill' : 'mention', match[2]!, { start, end: question.selectionStart });
  };
  const updateLogin = (snapshot: RuntimeSnapshot) => {
    const signedIn = snapshot.account.state === 'signedIn';
    account.disabled = signedIn; account.textContent = signedIn ? 'Signed in' : snapshot.login?.state === 'pending' ? 'Sign in pending' : 'Sign in';
    accountStatus.hidden = signedIn || !(snapshot.login?.state === 'pending' || snapshot.login?.state === 'failed' || snapshot.runtime === 'error');
    accountStatus.textContent = snapshot.login?.state === 'pending' ? 'Complete the official Codex sign-in in your browser.' : snapshot.login?.message ?? snapshot.error ?? '';
  };
  const onLogin = () => {
    if (account.disabled || disposed) return;
    account.disabled = true; account.textContent = 'Connecting…'; accountStatus.hidden = false; accountStatus.textContent = 'Opening official Codex sign-in…';
    void options.startLogin(updateLogin).then(stop => { if (disposed) stop(); else { unsubscribeLogin?.(); unsubscribeLogin = stop; } })
      .catch(caught => { if (!disposed) { account.disabled = false; account.textContent = 'Retry sign in'; accountStatus.textContent = failure(caught); } });
  };
  const onSend = () => {
    const text = question.value.trim(); if (!text || busy || current.busy) return;
    const input: LibraryAgentSend = { question: text, skillId: selectedSkill?.id ?? null, mentions: copy(mentions), modelId: chosenModelId ?? (model.value || null) };
    closeToolMenu(); closeMenu(); busy = true; send.disabled = true; error.hidden = true;
    void options.send(input).then(() => { if (disposed) return; question.value = ''; selectedSkill = null; mentions.splice(0); renderContext(); render(current); void renderTasks(); })
      .catch(caught => { if (!disposed) { error.textContent = failure(caught); error.hidden = false; } })
      .finally(() => { busy = false; if (!disposed) render(current); });
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.isComposing || composing) return;
    if (!commandMenu.hidden && menuEntries.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); menuIndex = (menuIndex + (event.key === 'ArrowDown' ? 1 : -1) + menuEntries.length) % menuEntries.length;
        for (const [index, row] of [...commandMenu.querySelectorAll('[role="option"]')].entries()) row.setAttribute('aria-selected', String(index === menuIndex));
        return;
      }
      if (event.key === 'Enter') { event.preventDefault(); chooseMenu(menuIndex); return; }
    }
    if (event.key === 'Escape' && !commandMenu.hidden) { event.preventDefault(); closeMenu(); return; }
    if (event.key === 'Escape' && !toolMenu.hidden) { event.preventDefault(); closeToolMenu(); return; }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onSend(); }
  };
  const loadAgent = () => {
    void Promise.all([options.load(), options.skills(), options.getTasks()]).then(async ([state, availableSkills, tasks]) => {
      if (disposed) return;
      skills = availableSkills; taskPort = tasks;
      taskView ??= mountTaskView(taskRoot, {
        approveSelected: async (id, selected, choices) => { const task = await tasks.approve(id, selected, choices); await renderTasks(); return task; },
        cancel: async id => { const task = await tasks.cancel(id); await renderTasks(); return task; },
        reconcile: async id => { const task = await tasks.reconcile(id); await renderTasks(); return task; },
        undo: async id => { const task = await tasks.undo(id); await renderTasks(); return task; },
        openSource: async () => {},
        openOutput: async (id, itemId) => { await options.openOutput(await tasks.get(id), itemId); },
        collectionLabel: target => options.collectionLabel?.(target.collectionKey) ?? target.collectionKey,
        cancelReading: async () => {}, reconcileReading: async () => {}, openReadingOutput: async () => {},
      });
      unsubscribe ??= options.subscribe(render);
      unsubscribeTasks ??= tasks.subscribe(task => { if (task.conversationId === options.sessionId) void renderTasks().catch(caught => { error.textContent = failure(caught); error.hidden = false; }); });
      render(state); await renderTasks();
    }).catch(caught => { if (!disposed) { error.textContent = failure(caught); error.hidden = false; } });
  };
  const onOpen = () => {
    panel.hidden = false;
    paintAutomaticContext();
    if (resizer) resizer.hidden = false;
    page?.classList.add('zchatgpt-library-dock-open'); trigger.setAttribute('aria-pressed', 'true'); trigger.setAttribute('aria-expanded', 'true');
    onWindowResize();
    if (mode === 'chat' && options.showChat) {
      chatHost.hidden = false; scroll.hidden = true; composer.hidden = true; account.hidden = true;
      void options.showChat(chatHost).then(result => { if (!disposed && !panel.hidden && mode === 'chat') paintChat(result); })
        .catch(caught => { if (!disposed && !panel.hidden) { error.textContent = failure(caught); error.hidden = false; } });
    } else { question.focus(); loadAgent(); }
  };
  const switchMode = (next: 'agent' | 'chat') => {
    if (next === mode || (next === 'chat' && !options.showChat)) return;
    closeHistory();
    const generation = ++modeGeneration;
    if (next === 'chat') {
      error.hidden = true;
      // The official browser measures its anchor when show() runs.
      chatHost.hidden = false;
      void options.showChat!(chatHost).then(result => {
        if (disposed || generation !== modeGeneration || panel.hidden) { options.hideChat?.(); return; }
        mode = 'chat'; paintChat(result);
        scroll.hidden = true; composer.hidden = true; account.hidden = true; accountStatus.hidden = true;
        chatMode.setAttribute('aria-pressed', 'true'); agentMode.setAttribute('aria-pressed', 'false');
      }).catch(caught => { chatHost.hidden = true; options.hideChat?.(); error.textContent = failure(caught); error.hidden = false; });
    } else {
      options.hideChat?.(); mode = 'agent'; title.textContent = 'Zotero Agent';
      chatHost.hidden = true; chatNotice.hidden = true; scroll.hidden = false; composer.hidden = false; account.hidden = false;
      chatMode.setAttribute('aria-pressed', 'false'); agentMode.setAttribute('aria-pressed', 'true'); question.focus(); loadAgent();
    }
  };
  chatMode.setAttribute('aria-pressed', String(mode === 'chat')); agentMode.setAttribute('aria-pressed', String(mode === 'agent'));
  chatMode.addEventListener('click', () => switchMode('chat')); agentMode.addEventListener('click', () => switchMode('agent'));
  const closeWorkbench = (restoreFocus: boolean) => { modeGeneration++; panel.hidden = true; chatNotice.hidden = true; if (resizer) resizer.hidden = true; page?.classList.remove('zchatgpt-library-dock-open'); trigger.setAttribute('aria-pressed', 'false'); trigger.setAttribute('aria-expanded', 'false'); options.hideChat?.(); closeMenu(); closeToolMenu(); closeHistory(); if (restoreFocus) trigger.focus(); };
  const onClose = () => closeWorkbench(true);
  const onMenuOpen = () => { options.showLibraryTab?.(); if (!panel.hidden) return; onOpen(); };
  trigger.addEventListener('click', () => { if (panel.hidden) onOpen(); else onClose(); }); menuItem?.addEventListener('command', onMenuOpen); menuItem?.addEventListener('click', onMenuOpen);
  account.addEventListener('click', onLogin); send.addEventListener('click', onSend);
  automatic.addEventListener('click', () => {
    options.toggleAutomaticContext?.(); paintAutomaticContext();
    if (mode === 'chat' && !chatNotice.hidden) refreshSelectedChat();
  });
  pdf.disabled = !options.openSelectedPdf;
  pdf.addEventListener('click', () => { void options.openSelectedPdf?.().catch(caught => { error.textContent = failure(caught); error.hidden = false; }); });
  history.addEventListener('click', () => { historyPanel.hidden = !historyPanel.hidden; history.setAttribute('aria-expanded', String(!historyPanel.hidden)); if (!historyPanel.hidden) { closeMenu(); closeToolMenu(); paintHistory(); } });
  plus.addEventListener('click', () => { closeMenu(); toolMenu.hidden = !toolMenu.hidden; plus.setAttribute('aria-expanded', String(!toolMenu.hidden)); });
  skillsButton.addEventListener('click', () => { void showMenu('skill', '', null); question.focus(); });
  mentionsButton.addEventListener('click', () => { void showMenu('mention', '', null); question.focus(); });
  keyboardActivate(skillsButton, () => { void showMenu('skill', '', null); question.focus(); });
  keyboardActivate(mentionsButton, () => { void showMenu('mention', '', null); question.focus(); });
  question.addEventListener('input', () => { detectTrigger(); render(current); });
  question.addEventListener('keydown', onKeydown); question.addEventListener('compositionstart', () => { composing = true; });
  question.addEventListener('compositionend', () => { composing = false; detectTrigger(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !historyPanel.hidden) { event.preventDefault(); closeHistory(); return; } if (event.key === 'Escape' && commandMenu.hidden && toolMenu.hidden && !event.isComposing) onClose(); });
  model.addEventListener('change', () => { chosenModelId = model.value; });
  const dispose = () => {
    disposed = true; unsubscribe?.(); unsubscribeTasks?.(); unsubscribeLogin?.(); taskView?.dispose();
    if (selectionTimer !== null) doc.defaultView?.clearTimeout(selectionTimer);
    selectionObserver?.disconnect(); selectionTree?.removeEventListener('click', scheduleSelectedChat, true); selectionTree?.removeEventListener('keyup', scheduleSelectedChat, true);
    doc.defaultView?.removeEventListener('resize', onWindowResize);
    page?.classList.remove('zchatgpt-library-dock-open');
    trigger.remove(); menuItem?.remove(); sharedStyles?.remove(); style.remove(); resizer?.remove(); panel.remove();
  };
  return Object.assign(dispose, { onTabChange: (isLibraryTab: boolean) => { if (!isLibraryTab && !panel.hidden) closeWorkbench(false); } });
}
