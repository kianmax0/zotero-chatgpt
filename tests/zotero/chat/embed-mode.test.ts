import { Window } from 'happy-dom';
import { expect, it, vi } from 'vitest';
import { mountChatView, renderReaderShell, type EmbedClipboardOutcome } from '../../../packages/zotero/src/chat/view.ts';
import type { ConversationPresenter, PresenterState } from '../../../packages/zotero/src/chat/presenter.ts';
import { workspaceDraft } from '../../../packages/zotero/src/chat/draft.ts';
import type { PaperIdentity, RequestMode } from '../../../packages/contracts/src/index.ts';
import { paperA } from '../../contracts/factories.ts';
import { presenterContext } from '../presenter-context.ts';

/**
 * A presenter only as far as `mountChatView` observes it: state, a render subscription, and the mode
 * control. The real presenter's routing is covered by its own tests; this file is about which
 * surface Chat mode renders when the host hosts the real ChatGPT application.
 */
function stubPresenter(mode: RequestMode = 'chat', identity?: PaperIdentity) {
  const listeners = new Set<(state: PresenterState) => void>();
  const state: PresenterState = {
    connection: 'ready', runtime: null, conversation: null, openConversations: [], newChatOpen: true,
    conversations: [],
    draft: workspaceDraft({ settings: null, paper: paperA, question: '', citations: [], images: [] }),
    pendingExplain: null, message: null, generating: false, mode, chatUnavailable: 'Chat is unavailable in this build. Use Agent mode.',
    focusToken: 0, workspace: null, history: [], historyQuery: '', scrollTop: 0, persistence: 'session',
    tasks: [], readingJobs: [], contextReport: null, queueing: false, messageFocus: null,
    acquisitionTarget: null, collectionOptions: [], document: presenterContext(paperA, 'Synthetic Paper A', identity),
  };
  const presenter = {
    snapshot: () => state,
    bind: (render: (value: PresenterState) => void) => { listeners.add(render); render(state); return () => { listeners.delete(render); }; },
    setScrollTop: () => undefined,
    setMode(next: RequestMode) { state.mode = next; for (const listener of [...listeners]) listener(state); },
    closeConversation: () => false,
    acknowledgeContext: () => undefined,
    newConversation: () => Promise.resolve(),
    focusInput: () => undefined,
  };
  return presenter as unknown as ConversationPresenter;
}

/** A journal article with real fields, so the bibliographic action has something true to copy. */
const paperIdentity: PaperIdentity = {
  title: 'Synthetic Paper A', authors: ['Ada Lovelace'], itemType: 'journalArticle',
  publicationTitle: 'Nature', year: '2026', doi: 'https://doi.org/10.1000/xyz', abstractNote: 'A stored abstract.',
};

function mount(mode: RequestMode = 'chat', identity: PaperIdentity = paperIdentity) {
  const doc = new Window({ url: 'https://zchatgpt.test/' }).document as unknown as Document;
  const body = doc.createElement('div');
  doc.body.append(body);
  const root = renderReaderShell(body, { title: 'Synthetic Paper A', key: paperA.attachmentKey, libraryID: paperA.libraryId });
  const embed = {
    show: vi.fn(), hide: vi.fn(), reload: vi.fn(),
    copyPaperContext: vi.fn<() => Promise<EmbedClipboardOutcome>>(() => Promise.resolve<EmbedClipboardOutcome>({ copied: true, kind: 'paper' })),
    copyPdfFile: vi.fn<() => Promise<EmbedClipboardOutcome>>(() => Promise.resolve<EmbedClipboardOutcome>({ copied: true, kind: 'file' })),
  };
  const presenter = stubPresenter(mode, identity);
  const teardown = mountChatView(root, presenter, { chatEmbed: embed });
  return { root, embed, presenter, teardown };
}

/** The toolbar's short-lived answer line for the last paper action. */
function feedbackOf(root: ParentNode): HTMLElement {
  return root.querySelector<HTMLElement>('[data-zchatgpt-shell-feedback]')!;
}
const copyPaper = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-paper-context"]')!;
const copyPdf = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="copy-pdf-file"]')!;
/** Let the copy action's promise chain settle; the view announces the outcome after it resolves. */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

it('renders the hosted application instead of the native chat while Chat mode is selected', () => {
  const { root, embed } = mount('chat');
  const native = root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!;
  const section = root.querySelector<HTMLElement>('[data-zchatgpt-embed]')!;
  const slot = root.querySelector<HTMLElement>('[data-zchatgpt-embed-slot]')!;
  expect(native.hidden).toBe(true);
  expect(section.hidden).toBe(false);
  expect(root.getAttribute('data-zchatgpt-embed-active')).toBe('true');
  // The host is handed the slot, not the whole dock: the mode control stays usable beside it.
  expect(embed.show).toHaveBeenCalledWith(slot);
  expect(embed.hide).not.toHaveBeenCalled();
});

it('never shows the Agent composer, approvals or task surface in hosted Chat mode', () => {
  const { root } = mount('chat');
  const native = root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!;
  const composer = root.querySelector<HTMLTextAreaElement>('[data-zchatgpt-input]')!;
  expect(native.hidden).toBe(true);
  // The native chat keeps its DOM (a switch back must not rebuild it) but nothing in it is reachable
  // while Chat is the web application, including the composer that would freeze a Chat request.
  expect(native.contains(composer)).toBe(true);
  // `hidden` on the ancestor is what makes it unreachable: the composer cannot be typed into, so no
  // Chat request can be frozen from this build's (unconfigured) native Chat transport.
  expect(composer.closest('[hidden]')).toBe(native);
  expect(root.dataset.zchatgptEmbedActive).toBe('true');
});

it('keeps exactly one mode control, fixed in the common single-row shell bar in both modes', () => {
  const { root, presenter, embed } = mount('chat');
  const switches = () => root.querySelectorAll('[data-zchatgpt-mode-switch]');
  expect(switches()).toHaveLength(1);
  const bar = root.querySelector('[data-zchatgpt-shell-bar]')!;
  expect(bar.contains(switches()[0]!)).toBe(true);
  expect(root.querySelector('[data-zchatgpt-composer-leading]')!.contains(switches()[0]!)).toBe(false);
  // There is no second bar in the hosted surface and no permanent context row anywhere.
  expect(root.querySelector('[data-zchatgpt-embed-bar]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-embed-actions]')).toBeNull();
  expect(root.querySelector('[data-zchatgpt-shell-context]')).toBeNull();
  expect(root.querySelectorAll('[data-zchatgpt-shell-bar]')).toHaveLength(1);
  (root.querySelector('[data-zchatgpt-action="mode-agent"]') as HTMLButtonElement).click();
  expect(presenter.snapshot().mode).toBe('agent');
  // Agent mode is the native surface again: the same control stays exactly where it was.
  expect(switches()).toHaveLength(1);
  expect(root.querySelector('[data-zchatgpt-shell-bar]')!.contains(switches()[0]!)).toBe(true);
  expect(root.querySelector('[data-zchatgpt-composer-leading]')!.contains(switches()[0]!)).toBe(false);
  expect(root.querySelector('[data-zchatgpt-embed]')!.hasAttribute('hidden')).toBe(true);
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!.hidden).toBe(false);
  expect(embed.hide).toHaveBeenCalled();
  (root.querySelector('[data-zchatgpt-action="mode-chat"]') as HTMLButtonElement).click();
  expect(root.querySelector('[data-zchatgpt-embed]')!.hasAttribute('hidden')).toBe(false);
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!.hidden).toBe(true);
  expect(embed.show).toHaveBeenCalledTimes(2);
});

it('reloads the hosted application from the More menu without leaving Chat mode', () => {
  const { root, embed, presenter } = mount('chat');
  const reload = root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="reload-chat"]')!;
  // It is a secondary action: reachable from the menu, not a permanent toolbar button.
  expect(reload.closest('[data-zchatgpt-more-menu]')).not.toBeNull();
  expect(root.querySelectorAll('.zchatgpt-chrome-actions > [data-zchatgpt-action="reload-chat"]')).toHaveLength(0);
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="more-actions"]')!.click();
  reload.click();
  expect(embed.reload).toHaveBeenCalledTimes(1);
  expect(presenter.snapshot().mode).toBe('chat');
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-embed]')!.hidden).toBe(false);
});

it('offers the two paper copy controls as icon buttons and says the text is on the clipboard, not sent', async () => {
  const { root, embed } = mount('chat');
  const actions = root.querySelector<HTMLElement>('[data-zchatgpt-paper-actions]')!;
  const paper = copyPaper(root);
  const pdf = copyPdf(root);
  // Two icon buttons in one group with distinct glyphs, real names and a localized explanation.
  expect(actions.contains(paper)).toBe(true);
  expect(actions.contains(pdf)).toBe(true);
  expect(paper.textContent?.trim()).toBe('');
  expect(pdf.textContent?.trim()).toBe('');
  expect(paper.getAttribute('aria-label')).toBe('Copy paper context');
  expect(pdf.getAttribute('aria-label')).toBe('Copy PDF file');
  expect(paper.getAttribute('title')).toBe('Copy paper context\nCopy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.');
  const described = root.querySelector<HTMLElement>(`#${paper.getAttribute('aria-describedby')}`)!;
  expect(described.textContent).toBe('Copy title, authors, publication, year, DOI and abstract as text. Does not include PDF full text.');
  expect(paper.querySelector('svg path')?.getAttribute('d')).not.toBe(pdf.querySelector('svg path')?.getAttribute('d'));
  // The answer line starts empty rather than claiming anything happened.
  expect(feedbackOf(root).hidden).toBe(true);
  paper.click();
  await settle();
  expect(embed.copyPaperContext).toHaveBeenCalledTimes(1);
  expect(feedbackOf(root).hidden).toBe(false);
  expect(feedbackOf(root).textContent).toBe('Paper details copied');
  pdf.click();
  await settle();
  expect(embed.copyPdfFile).toHaveBeenCalledTimes(1);
  expect(feedbackOf(root).textContent).toBe('PDF copied — paste to attach');
  expect(feedbackOf(root).textContent).not.toMatch(/attached|uploaded|sent/iu);
});

it('discloses automatic paper metadata before the first official-page submission without asking for approval', () => {
  const { root, presenter } = mount('chat');
  presenter.snapshot().document.disclosure = true;
  presenter.snapshot().document.enabled = true;
  presenter.setMode('chat');
  const strip = root.querySelector<HTMLElement>('[data-zchatgpt-embed-notice]')!;
  const notice = root.querySelector<HTMLElement>('[data-zchatgpt-embed-context-notice]')!;
  // The first outbound notice is informational and does not claim a submission.
  expect(strip.hidden).toBe(false);
  expect(notice.textContent).toContain('official ChatGPT');
  expect(notice.textContent).toContain('stored abstract');
  expect(notice.textContent).toContain('PDF body text is not added');
  expect(notice.textContent).toContain('Preferences');
  expect(root.querySelector('[data-zchatgpt-action="continue-with-pdf"]')).toBeNull();
});

it('reports the automatic paper context setting in the details without claiming a message was accepted', () => {
  const { root, presenter } = mount('chat');
  const strip = root.querySelector<HTMLElement>('[data-zchatgpt-embed-notice]')!;
  // Nothing outstanding: the strip is gone, so the header is a single row.
  presenter.snapshot().document.disclosure = false;
  presenter.snapshot().document.enabled = true;
  presenter.setMode('chat');
  expect(strip.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-embed-context-notice]')!.hidden).toBe(true);
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="more-actions"]')!.click();
  root.querySelector<HTMLButtonElement>('[data-zchatgpt-action="open-paper-details"]')!.click();
  const panel = root.querySelector<HTMLElement>('[data-zchatgpt-context-panel]')!;
  expect(panel.textContent).toContain('Automatic paper details and abstract On');
  expect(panel.textContent).not.toMatch(/accepted|attached|sent/iu);
  presenter.snapshot().document.enabled = false;
  presenter.setMode('chat');
  expect(panel.textContent).toContain('Automatic paper details and abstract Off');
});

it('hands the real PDF file to the clipboard for the application\'s own paste-to-attach path', async () => {
  const { root, embed } = mount('chat');
  copyPdf(root).click();
  await settle();
  expect(embed.copyPdfFile).toHaveBeenCalledTimes(1);
  // The answer says the file is on the clipboard, not that the application received it: pasting is
  // the owner's step and the upload runs inside ChatGPT's own composer.
  expect(feedbackOf(root).textContent).toBe('PDF copied — paste to attach');
  embed.copyPdfFile.mockResolvedValueOnce({ copied: false, reason: 'no-file' });
  copyPdf(root).click();
  await settle();
  expect(feedbackOf(root).textContent).toBe('This attachment has no local PDF file to copy.');
});

it('clears the previous answer while a new action is still running', async () => {
  const { root, embed } = mount('chat');
  copyPaper(root).click();
  await settle();
  expect(feedbackOf(root).textContent).toBe('Paper details copied');
  let resolveFile!: (outcome: EmbedClipboardOutcome) => void;
  embed.copyPdfFile.mockImplementationOnce(() => new Promise<EmbedClipboardOutcome>(resolve => { resolveFile = resolve; }));
  copyPdf(root).click();
  await settle();
  // A stale "Paper details copied" next to a control the owner just pressed would be a false claim
  // about this action, so the line is empty until this action has its own answer.
  expect(feedbackOf(root).hidden).toBe(true);
  expect(feedbackOf(root).textContent).toBe('');
  expect(copyPdf(root).getAttribute('aria-busy')).toBe('true');
  resolveFile({ copied: true, kind: 'file' });
  await settle();
  expect(feedbackOf(root).hidden).toBe(false);
  expect(feedbackOf(root).textContent).toBe('PDF copied — paste to attach');
  expect(copyPdf(root).hasAttribute('aria-busy')).toBe(false);
  // The success mark is momentary and never a permanent state on the button.
  expect(copyPdf(root).dataset.zchatgptCopyState).toBe('copied');
});

it('reports the honest reason when there is nothing to copy', async () => {
  const { root, embed } = mount('chat');
  embed.copyPaperContext.mockResolvedValueOnce({ copied: false, reason: 'no-info' });
  copyPaper(root).click();
  await settle();
  expect(feedbackOf(root).textContent).toBe('This item has no bibliographic information to copy.');
  expect(copyPaper(root).dataset.zchatgptCopyState).toBeUndefined();
  embed.copyPaperContext.mockRejectedValueOnce(new Error('unavailable'));
  copyPaper(root).click();
  await settle();
  expect(feedbackOf(root).textContent).toBe('The paper details could not be read.');
  embed.copyPdfFile.mockRejectedValueOnce(new Error('unavailable'));
  copyPdf(root).click();
  await settle();
  expect(feedbackOf(root).textContent).toBe('The PDF file could not be copied.');
});

it('disables the bibliographic copy for a bare PDF with a keyboard-discoverable reason', async () => {
  // A bare PDF attachment proves no bibliography: only the attachment's own name is known.
  const { root, embed } = mount('chat', { title: 'scan-0001.pdf', authors: [] });
  const paper = copyPaper(root);
  expect(paper.getAttribute('aria-disabled')).toBe('true');
  expect(paper.getAttribute('title')).toBe('This item has no bibliographic information to copy.');
  expect(paper.hasAttribute('disabled')).toBe(false);
  paper.click();
  await settle();
  expect(embed.copyPaperContext).not.toHaveBeenCalled();
  expect(feedbackOf(root).textContent).toBe('This item has no bibliographic information to copy.');
  // The file action stays independent: a bare PDF still has a file to copy.
  expect(copyPdf(root).getAttribute('aria-disabled')).toBeNull();
});

it('carries the paper actions into Agent mode without acting on them there', () => {
  const { root, embed } = mount('agent');
  // The hosted surface is out of the way while Agent runs, but the paper actions belong to the
  // shared toolbar, so their position and availability do not change with the mode.
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-embed]')!.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>('[data-zchatgpt-chat]')!.hidden).toBe(false);
  expect(root.querySelector('[data-zchatgpt-paper-actions]')).not.toBeNull();
  expect(embed.copyPaperContext).not.toHaveBeenCalled();
  expect(embed.copyPdfFile).not.toHaveBeenCalled();
  expect(root.querySelector('[data-zchatgpt-action="reload-chat"]')!.closest('[hidden]')).not.toBeNull();
});

it('stops painting the hosted surface when the view is torn down', () => {
  const { embed, teardown } = mount('chat');
  embed.show.mockClear();
  teardown();
  expect(embed.hide).toHaveBeenCalledTimes(1);
  expect(embed.show).not.toHaveBeenCalled();
});

it('names the paper actions for what they do, never as an upload or attachment', () => {
  const { root } = mount('chat');
  const file = copyPdf(root);
  // UI-04: the control copies the real PDF to the clipboard; the paste into ChatGPT is the owner's
  // own step, so the label must not claim the file was attached or uploaded.
  expect(file.getAttribute('aria-label')).toBe('Copy PDF file');
  expect(file.getAttribute('aria-label')).not.toMatch(/attach|upload/iu);
  expect(file.textContent).not.toMatch(/attach|upload/iu);
  expect(copyPaper(root).getAttribute('aria-label')).toBe('Copy paper context');
});
