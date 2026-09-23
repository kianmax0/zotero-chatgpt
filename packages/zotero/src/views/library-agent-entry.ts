import type { ActionTasks, ActionTaskRecord } from '../../../contracts/src/tasks.ts';
import type { NativeCollectionTarget } from '../../../contracts/src/native.ts';
import { mountTaskView } from '../chat/task-view.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';
const IDENTIFIER = /https?:\/\/[^\s<>"']+|\b10\.\d{4,9}\/[^\s<>"']+/giu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface LibraryCollection extends NativeCollectionTarget { name: string }
export interface LibraryAgentEntryOptions {
  document: Document;
  sessionId: string;
  getTasks(): Promise<ActionTasks>;
  collections(): Promise<LibraryCollection[]>;
  organizeSelected?(question: string, window: Window, sessionId: string): Promise<void>;
  startLogin?(): Promise<void>;
  openOutput(task: ActionTaskRecord, itemId: string): Promise<void>;
}

function identifierList(value: string): string[] {
  const found = [...value.matchAll(IDENTIFIER)].map(match => match[0].replace(/[.,;，。；]+$/u, ''));
  return [...new Set(found)];
}

function setStyle(element: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, style);
}

/** Adds the Zotero-library entry and an acquisition panel that owns no paper conversation. */
export function mountLibraryAgentEntry(options: LibraryAgentEntryOptions): () => void {
  if (!UUID.test(options.sessionId)) throw new Error('A stable library session UUID is required.');
  const doc = options.document;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => {
    const node = doc.createElementNS(XHTML, tag) as HTMLElementTagNameMap[K];
    if (text) node.textContent = text;
    return node;
  };
  const createXul = (tag: string): Element => {
    const xulDocument = doc as Document & { createXULElement?(name: string): Element };
    return xulDocument.createXULElement?.(tag) ?? doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);
  };
  const trigger: HTMLElement = (() => {
    const node = createXul('toolbarbutton') as HTMLElement;
    node.setAttribute('label', 'Agent'); node.setAttribute('tooltiptext', 'Open Zotero Agent for your library');
    node.setAttribute('class', 'zchatgpt-library-agent-button zotero-tb-button');
    node.setAttribute('data-zchatgpt-library-agent', '');
    if (node.localName === 'toolbarbutton') node.setAttribute('type', 'button');
    else { node.textContent = 'Agent'; node.setAttribute('type', 'button'); }
    node.setAttribute('style', 'min-width:56px;height:28px;margin-left:5px;padding:0 8px;border:1px solid currentColor;border-radius:6px;font-weight:600');
    return node;
  })();
  let menuItem: Element | null = null;
  // Zotero 9's library controls live in the center column, not in a #zotero-toolbar node. Place
  // the action beside its existing DOI lookup control so it is visible even with no selected item.
  const lookup = doc.getElementById('zotero-tb-lookup');
  if (lookup?.parentElement) lookup.after(trigger);
  else doc.getElementById('zotero-toolbar')?.append(trigger);
  const toolsMenu = doc.getElementById('menu_ToolsPopup');
  if (toolsMenu) {
    menuItem = createXul('menuitem'); menuItem.setAttribute('label', 'Zotero library Agent');
    menuItem.setAttribute('data-zchatgpt-library-agent-menu', '');
    toolsMenu.append(menuItem);
  }

  const panel = create('section'); panel.dataset.zchatgptLibraryAgentPanel = '';
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Zotero library Agent'); panel.setAttribute('aria-modal', 'false'); panel.hidden = true;
  setStyle(panel, { position: 'fixed', zIndex: '10000', top: '52px', right: '20px', width: 'min(520px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 72px)', overflow: 'auto', padding: '18px', background: 'var(--material-background, #fff)', color: 'var(--fill-primary, #222)', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)', borderRadius: '10px', boxShadow: '0 8px 28px rgb(0 0 0 / 24%)' });
  const heading = create('h2', 'Zotero library Agent');
  const explanation = create('p', 'Acquire an article from an explicit DOI or public article URL. Review the metadata and approve each Zotero write below.');
  const form = create('form');
  const collectionLabel = create('label', 'Save to collection'); collectionLabel.htmlFor = 'zchatgpt-library-agent-collection';
  const collection = create('select'); collection.id = collectionLabel.htmlFor; collection.required = true; collection.setAttribute('aria-label', 'Save to collection');
  const identifierLabel = create('label', 'DOI or public article URL'); identifierLabel.htmlFor = 'zchatgpt-library-agent-identifiers';
  const identifiers = create('textarea'); identifiers.id = identifierLabel.htmlFor; identifiers.rows = 3; identifiers.required = true; identifiers.placeholder = '10.1234/example or https://…'; identifiers.setAttribute('aria-label', identifierLabel.textContent ?? 'DOI or public article URL');
  const submit = create('button', 'Prepare acquisition review'); submit.type = 'submit';
  const organization = create('fieldset');
  const organizationLegend = create('legend', 'Organize selected library items');
  const loginExplanation = create('p', 'Sign in to Codex to organize selected items. DOI and URL acquisition works without signing in.');
  const login = create('button', options.startLogin ? 'Sign in to Codex' : 'Codex sign-in unavailable'); login.type = 'button'; login.disabled = !options.startLogin;
  login.dataset.zchatgptCodexLogin = '';
  const loginStatus = create('p'); loginStatus.dataset.zchatgptCodexLoginStatus = ''; loginStatus.setAttribute('role', 'status'); loginStatus.setAttribute('aria-live', 'polite');
  const organizationQuestion = create('textarea'); organizationQuestion.rows = 2; organizationQuestion.placeholder = 'Add useful tags and existing collections…'; organizationQuestion.setAttribute('aria-label', 'Organization instructions');
  const organize = create('button', options.organizeSelected ? 'Prepare organization review' : 'Organization unavailable'); organize.type = 'button'; organize.disabled = !options.organizeSelected;
  const organizationStatus = create('p'); organizationStatus.setAttribute('role', 'status'); organizationStatus.setAttribute('aria-live', 'polite');
  organization.append(organizationLegend, loginExplanation, login, loginStatus, organizationQuestion, organize, organizationStatus);
  if (!options.startLogin) loginStatus.textContent = 'Codex sign-in is not available in this Zotero window.';
  if (!options.organizeSelected) organizationStatus.textContent = 'Selected-item organization is being connected to the library Agent.';
  const close = create('button', 'Close'); close.type = 'button'; close.setAttribute('aria-label', 'Close Zotero library Agent');
  const status = create('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  for (const field of [collection, identifiers]) setStyle(field, { display: 'block', boxSizing: 'border-box', width: '100%', margin: '5px 0 14px', padding: '7px' });
  setStyle(form, { marginTop: '14px' }); setStyle(explanation, { lineHeight: '1.45' });
  const controls = create('div'); controls.append(submit, close);
  form.append(collectionLabel, collection, identifierLabel, identifiers, controls, status);
  const tasksRoot = create('div'); panel.append(heading, explanation, form, organization, tasksRoot);
  (doc.body ?? doc.documentElement).append(panel);

  let tasks: ActionTasks | undefined;
  let unobserve: (() => void) | undefined;
  let taskView: ReturnType<typeof mountTaskView> | undefined;
  let collectionOptions: LibraryCollection[] = [];
  let busy = false;
  let loginBusy = false;
  let disposed = false;
  const refresh = async () => {
    const controller = tasks ??= await options.getTasks();
    const records = await controller.list(options.sessionId);
    taskView?.update({ tasks: records });
    const latest = records[0];
    if (!latest) return;
    const target = latest.kind === 'organization' ? organizationStatus : status;
    if (latest.state === 'completed') target.textContent = 'Task completed. Open the saved output below.';
    else if (latest.state === 'partial') target.textContent = 'Task partly completed. Check the saved metadata and PDF outcome below.';
    else if (latest.state === 'uncertain') target.textContent = 'A write result is unconfirmed. Reconcile the task below before continuing.';
    else if (latest.state === 'conflict') target.textContent = 'A later Zotero change conflicts with this task. Review the details below.';
    else if (latest.state === 'failed') target.textContent = 'Task failed. Review the details below.';
    else if (latest.state === 'undone') target.textContent = 'Task undone.';
    return latest;
  };
  const labels = () => new Map(collectionOptions.map(target => [`${target.clientId}:${target.libraryId}:${target.collectionKey}`, target.name]));
  const collectionLabelFor = (target: NativeCollectionTarget) => labels().get(`${target.clientId}:${target.libraryId}:${target.collectionKey}`) ?? 'Zotero collection';
  const open = async () => {
    panel.hidden = false;
    identifiers.focus();
    status.textContent = 'Loading editable collections and saved acquisition reviews…';
    try {
      const [controller, available] = await Promise.all([options.getTasks(), options.collections()]);
      if (disposed) return;
      tasks = controller; collectionOptions = available;
      collection.replaceChildren();
      const prompt = create('option', 'Choose a collection'); prompt.value = ''; collection.append(prompt);
      for (const target of available) {
        const option = create('option', target.name); option.value = `${target.clientId}:${target.libraryId}:${target.collectionKey}`; collection.append(option);
      }
      if (!taskView) taskView = mountTaskView(tasksRoot, {
        approveSelected: async (id, selected, choices) => { const task = await controller.approve(id, selected, choices); await refresh(); return task; },
        cancel: async id => { const task = await controller.cancel(id); await refresh(); return task; },
        reconcile: async id => { const task = await controller.reconcile(id); await refresh(); return task; },
        undo: async id => { const task = await controller.undo(id); await refresh(); return task; },
        openSource: async () => {},
        openOutput: async (id, itemId) => { const task = await controller.get(id); await options.openOutput(task, itemId); },
        collectionLabel: collectionLabelFor,
        cancelReading: async () => {}, reconcileReading: async () => {}, openReadingOutput: async () => {},
      });
      unobserve ??= controller.subscribe(task => {
        if (task.conversationId === options.sessionId && !disposed) void refresh().catch(error => { status.textContent = error instanceof Error ? error.message : 'Saved task state could not be read.'; });
      });
      const latest = await refresh();
      if (!available.length) status.textContent = 'No editable collection is available. Create a collection in Zotero, then reopen Agent.';
      else if (!latest) status.textContent = '';
      if (!collectionOptions.some(option => option.clientId === selectedTarget?.clientId && option.libraryId === selectedTarget.libraryId && option.collectionKey === selectedTarget.collectionKey)) selectedTarget = null;
      if (selectedTarget) collection.value = `${selectedTarget.clientId}:${selectedTarget.libraryId}:${selectedTarget.collectionKey}`;
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'The library Agent could not be opened.'; }
  };
  let selectedTarget: NativeCollectionTarget | null = null;
  const onCollectionChange = () => { selectedTarget = collectionOptions.find(option => `${option.clientId}:${option.libraryId}:${option.collectionKey}` === collection.value) ?? null; };
  const onOpen = () => { void open(); };
  const onClose = () => { panel.hidden = true; trigger.focus(); };
  const onPanelKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault(); onClose();
  };
  const onLogin = () => {
    if (!options.startLogin || loginBusy) return;
    loginBusy = true; login.disabled = true; loginStatus.textContent = 'Opening the official Codex sign-in flow…';
    void options.startLogin().then(() => {
      if (!disposed) loginStatus.textContent = 'The official sign-in page is open. Complete sign-in there, then return to prepare an organization review.';
    }).catch(error => {
      if (!disposed) loginStatus.textContent = error instanceof Error ? error.message : 'Codex sign-in could not be completed.';
    }).finally(() => { loginBusy = false; login.disabled = !options.startLogin; });
  };
  const onOrganize = () => {
    const question = organizationQuestion.value.trim();
    if (!question) { organizationStatus.textContent = 'Describe how to organize the selected items.'; organizationQuestion.focus(); return; }
    if (!options.organizeSelected || busy) return;
    busy = true; organize.disabled = true; organizationStatus.textContent = 'Freezing the current Zotero selection and preparing a review…';
    void options.organizeSelected(question, doc.defaultView as unknown as Window, options.sessionId).then(async () => {
      await refresh(); organizationQuestion.value = ''; organizationStatus.textContent = 'Review the proposed changes below, then approve them.';
    }).catch(error => { organizationStatus.textContent = error instanceof Error ? error.message : 'The organization review could not be prepared.'; })
      .finally(() => { busy = false; organize.disabled = !options.organizeSelected; });
  };
  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (busy) return;
    onCollectionChange();
    const found = identifierList(identifiers.value);
    if (!selectedTarget) { status.textContent = 'Choose an editable Zotero collection.'; collection.focus(); return; }
    if (!found.length) { status.textContent = 'Enter at least one DOI or public article URL.'; identifiers.focus(); return; }
    if (found.length > 50) { status.textContent = 'Prepare at most 50 identifiers at a time.'; identifiers.focus(); return; }
    busy = true; submit.disabled = true; status.textContent = 'Resolving metadata and checking for duplicates…';
    void (async () => {
      try {
        const controller = tasks ??= await options.getTasks();
        const { clientId, libraryId, collectionKey } = selectedTarget;
        await controller.planAcquisition({ conversationId: options.sessionId, target: { clientId, libraryId, collectionKey }, question: `Acquire ${found.join(', ')}`, identifiers: found });
        identifiers.value = '';
        await refresh(); status.textContent = 'Review the verified metadata below, then approve the items you want to save.';
      } catch (error) { status.textContent = error instanceof Error ? error.message : 'The acquisition review could not be prepared.'; }
      finally { busy = false; submit.disabled = false; }
    })();
  };
  trigger.addEventListener('click', onOpen);
  menuItem?.addEventListener('command', onOpen);
  menuItem?.addEventListener('click', onOpen);
  collection.addEventListener('change', onCollectionChange);
  form.addEventListener('submit', onSubmit);
  close.addEventListener('click', onClose);
  panel.addEventListener('keydown', onPanelKeydown);
  login.addEventListener('click', onLogin);
  organize.addEventListener('click', onOrganize);

  return () => {
    disposed = true; unobserve?.(); taskView?.dispose(); trigger.removeEventListener('click', onOpen); trigger.remove();
    menuItem?.removeEventListener('command', onOpen); menuItem?.removeEventListener('click', onOpen); menuItem?.remove();
    collection.removeEventListener('change', onCollectionChange); form.removeEventListener('submit', onSubmit); close.removeEventListener('click', onClose); panel.removeEventListener('keydown', onPanelKeydown); login.removeEventListener('click', onLogin); organize.removeEventListener('click', onOrganize); panel.remove();
  };
}
