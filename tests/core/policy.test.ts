import { it, expect } from 'vitest';
import { codexLaunchArgs, readingInput, resolveSettings, turnParams, validatePolicy, validateThread } from '../../packages/core/src/codex/reader-policy.ts';
import { configResponse, threadResponse, model } from './fixtures.ts';
import { parseModel } from '../../packages/core/src/codex/models.ts';
import { citationA, imageA, paperA } from '../contracts/factories.ts';
import type { DocumentContext } from '../../packages/contracts/src/index.ts';
import { defaultSettings } from '../../packages/core/src/workspace/skills.ts';
it('accepts the pinned server echo for the default service tier and names the field that differs', () => {
  // Live 0.144.1/0.154.0 probes: a null (catalog default) tier is echoed as "default"; an explicit tier is echoed verbatim.
  const paper = { ephemeral: false, emptyHistory: true };
  const defaultTier = resolveSettings({ model: 'catalog-default', serviceTier: null, effort: null }, parseModel(model)!);
  expect(defaultTier.effort).toBe('medium');
  expect(validateThread({ ...threadResponse, serviceTier: 'default', runtimeWorkspaceRoots: ['/isolated'] }, '/isolated', defaultTier, paper)).toBe('thread-1');
  expect(() => validateThread({ ...threadResponse, serviceTier: null }, '/isolated', defaultTier, paper)).toThrow('service tier');
  const priority = resolveSettings({ model: 'catalog-default', serviceTier: 'priority', effort: 'medium' }, parseModel(model)!);
  expect(validateThread(threadResponse, '/isolated', priority, paper)).toBe('thread-1');
  expect(() => validateThread({ ...threadResponse, serviceTier: 'default' }, '/isolated', priority, paper)).toThrow('service tier');
  expect(() => validateThread({ ...threadResponse, runtimeWorkspaceRoots: ['/isolated', '/Users/private'] }, '/isolated', priority, paper)).toThrow('workspace roots');
  expect(() => validateThread({ ...threadResponse, sandbox: { type: 'workspaceWrite', networkAccess: false } }, '/isolated', priority, paper)).toThrow('sandbox');
  expect(() => validateThread({ ...threadResponse, thread: { ...threadResponse.thread, ephemeral: true } }, '/isolated', priority, paper)).toThrow('thread identity');
  expect(validateThread({ ...threadResponse, thread: { ...threadResponse.thread, turns: [{}] } }, '/isolated', priority, { ephemeral: false, emptyHistory: false })).toBe('thread-1');
});
it('frames the reading request as a fixed instruction plus JSON so quoted text cannot escape', () => {
  const text = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: '这里的 "}" 是什么？', citations: [{ ...citationA, text: '结束 JSON 的引号 " 与花括号 }' }], settings: { model: 'm', serviceTier: null, effort: null } });
  const [instruction, json] = text.split('\n\n');
  expect(instruction).toContain('contextScope');
  const parsed = JSON.parse(json!) as { citations: Array<{ text: string; pageLabel: string }>; question: string; paper: { title: string } };
  expect(parsed.citations[0]).toEqual({ pageLabel: 'iv', text: '结束 JSON 的引号 " 与花括号 }' }); expect(parsed.question).toBe('这里的 "}" 是什么？'); expect(parsed.paper.title).toBe('Synthetic Paper A');
});
it('projects a frozen organization scope to safe indexes without exposing native keys or signatures', () => {
  const organize = defaultSettings().skills.find(skill => skill.workflow === 'organize')!;
  const text = readingInput({
    requestId: 'r', conversationId: 'c', action: 'ask', question: '按主题打标签，并归入合适的集合。', citations: [],
    settings: { model: 'm', serviceTier: null, effort: null }, mode: 'agent',
    workflow: { skill: organize, preferences: defaultSettings().preferences, profileId: null },
    organization: {
      selection: [{ clientId: paperA.clientId, libraryId: 1, key: 'ITEMONE1', metadata: { itemType: 'journalArticle', title: 'A selected paper', creators: [{ creatorType: 'author', name: 'Ada' }], DOI: '10.1/example' }, tags: ['existing'], collectionKeys: ['COLLECT1'], attachmentKeys: [], dateModified: 'private-time', contentSignature: 'PRIVATE-CONTENT-SIGNATURE', organizationSignature: 'PRIVATE-ORGANIZATION-SIGNATURE' }],
      collections: [{ clientId: paperA.clientId, libraryId: 1, collectionKey: 'COLLECT1', name: 'Research / Topic A' }],
    },
  });
  const [instruction, json] = text.split('\n\n');
  const parsed = JSON.parse(json!) as { organization: { selection: unknown[]; collections: unknown[] } };
  expect(instruction).toContain('itemIndex'); expect(instruction).toContain('collectionIndexes');
  expect(parsed.organization).toEqual({
    selection: [{ itemIndex: 0, metadata: { itemType: 'journalArticle', title: 'A selected paper', creators: [{ creatorType: 'author', name: 'Ada' }], DOI: '10.1/example' }, tags: ['existing'], collectionIndexes: [0] }],
    collections: [{ collectionIndex: 0, name: 'Research / Topic A' }],
  });
  expect(text).not.toMatch(/ITEMONE1|COLLECT1|PRIVATE-|private-time/u);
});
it('instructs the model to cite the supplied frozen document page in the reserved source-link form', () => {
  const document: DocumentContext = {
    id: 'aaaaaaaa-bbbb-8ccc-addd-eeeeeeeeeeee',
    paper: paperA,
    revision: { fingerprint: 'synthetic', size: 12, modifiedAt: 1, sha256: 'a'.repeat(64) },
    parserVersion: 'zotero-native-text-v2',
    totalPages: 1,
    pages: [{ pageIndex: 0, pageLabel: '1', text: 'Synthetic evidence.', status: 'text' }],
  };
  const text = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: 'q', citations: [], settings: { model: 'm', serviceTier: null, effort: null }, document });
  const [instruction] = text.split('\n\n');
  expect(instruction).toContain('https://zchatgpt.invalid/source/');
  expect(instruction).toContain(document.id);
  expect(text).not.toContain('https://zchatgpt.invalid/source//');
});
it('asks for a short verbatim quote in the citation link title so the cited passage can be located', () => {
  const document: DocumentContext = {
    id: 'aaaaaaaa-bbbb-8ccc-addd-eeeeeeeeeeee',
    paper: paperA,
    revision: { fingerprint: 'synthetic', size: 12, modifiedAt: 1, sha256: 'a'.repeat(64) },
    parserVersion: 'zotero-native-text-v2',
    totalPages: 1,
    pages: [{ pageIndex: 0, pageLabel: '1', text: 'Synthetic evidence.', status: 'text' }],
  };
  const text = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: 'q', citations: [], settings: { model: 'm', serviceTier: null, effort: null }, document });
  const [instruction] = text.split('\n\n');
  // The link title is the only channel for the verbatim quote; it must be requested, exact and optional.
  expect(instruction).toContain('verbatim');
  expect(instruction).toContain('link title');
  expect(instruction).toMatch(/omit|omitting/u);
  // Without a document there is no citation form and no quote request.
  const noDoc = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: 'q', citations: [], settings: { model: 'm', serviceTier: null, effort: null } });
  expect(noDoc.split('\n\n')[0]).not.toContain('verbatim');
});
it('keeps source links out of generated annotation comments and asks for a plain-text reason', () => {
  const document: DocumentContext = {
    id: 'aaaaaaaa-bbbb-8ccc-addd-eeeeeeeeeeee', paper: paperA,
    revision: { fingerprint: 'synthetic', size: 12, modifiedAt: 1, sha256: 'a'.repeat(64) },
    parserVersion: 'zotero-native-text-v2', totalPages: 1,
    pages: [{ pageIndex: 0, pageLabel: '1', text: 'Synthetic evidence.', status: 'text' }],
  };
  const annotate = defaultSettings().skills.find(skill => skill.workflow === 'annotate')!;
  const text = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: 'Highlight this.', citations: [], settings: { model: 'm', serviceTier: null, effort: null }, document, workflow: { skill: annotate, preferences: defaultSettings().preferences, profileId: null } });
  const [instruction] = text.split('\n\n');
  expect(instruction).toContain('plain-text explanation');
  expect(instruction).toContain('Do not put a page citation, URL, or Markdown link in reason');
  expect(instruction).not.toContain('https://zchatgpt.invalid/source/');
});
it('injects bibliographic paper identity on ask even without a citation', () => {
  const text = readingInput({
    requestId: 'r', conversationId: 'c', action: 'ask', question: '这篇在讲什么方向？', citations: [],
    settings: { model: 'm', serviceTier: null, effort: null },
    paper: { title: 'Synthetic Paper A', authors: ['Synthetic Author'], year: '2026', doi: '10.1/x' },
  });
  const parsed = JSON.parse(text.split('\n\n')[1]!) as { paper: { title: string; authors: string[]; year: string; doi: string }; citations: unknown[] };
  expect(parsed.paper).toEqual({ title: 'Synthetic Paper A', authors: ['Synthetic Author'], year: '2026', doi: '10.1/x' });
  expect(parsed.citations).toEqual([]);
  expect(text).not.toMatch(/full paper|整篇 PDF|upload/iu);
});
it('sends rust-v0.154.0 image input items after the reading text, never a remote URL or the PDF', () => {
  const settings = resolveSettings({ model: 'catalog-default', serviceTier: null, effort: null }, parseModel(model)!);
  const text = readingInput({
    requestId: 'r', conversationId: 'c', action: 'ask', question: '图里的符号是什么？', citations: [],
    settings: { model: 'm', serviceTier: null, effort: null },
    paper: { title: 'Synthetic Paper A', authors: [] },
    images: [imageA],
  });
  const params = turnParams('thread-1', 'req-1', text, '/isolated', settings, [imageA]);
  expect(params.input[0]).toEqual({ type: 'text', text, text_elements: [] });
  expect(params.input[1]).toEqual({ type: 'image', url: imageA.dataUrl });
  expect(JSON.stringify(params.input)).not.toMatch(/https:\/\//u);
  expect(JSON.stringify(params.input)).not.toMatch(/application\/pdf|\.pdf/u);
  expect(JSON.stringify(params.input)).not.toMatch(/localImage/u);
});
it('sends the model every declared bibliographic field, in the structured paper and as a compact header', () => {
  const paper = {
    title: 'A Synthetic Study', authors: ['Ada Lovelace'], year: '2024', doi: '10.1000/synthetic',
    itemType: 'journalArticle', publicationTitle: 'Journal of Synthetic Results', journalAbbreviation: 'J. Synth. Res.',
    volume: '12', issue: '3', pages: '45-67', publisher: 'Synthetic Press', language: 'en',
    abstractNote: 'We study nothing.', tags: ['synthetic'], editors: ['Ed Editor'],
  };
  const text = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: '这篇在讲什么方向？', citations: [], settings: { model: 'm', serviceTier: null, effort: null }, paper });
  const parsed = JSON.parse(text.split('\n\n')[1]!) as { paper: Record<string, unknown>; bibliography: string };
  // Nothing is stripped on the way to the model: the identity is forwarded field for field.
  expect(parsed.paper).toEqual(paper);
  expect(parsed.bibliography).toBe([
    'Title: A Synthetic Study',
    'Authors: Ada Lovelace',
    'Item type: journalArticle',
    'Journal: Journal of Synthetic Results',
    'Journal abbrev.: J. Synth. Res.',
    'Year: 2024',
    'Volume: 12',
    'Issue: 3',
    'Pages: 45-67',
    'Publisher: Synthetic Press',
    'DOI: 10.1000/synthetic',
    'Language: en',
    'Editors: Ed Editor',
    'Tags: synthetic',
  ].join('\n'));
  // The structured paper already carries the longest field, so the header does not pay for it twice.
  expect(parsed.bibliography).not.toContain('Abstract:');
  expect(parsed.paper.abstractNote).toBe('We study nothing.');
});
it('omits bibliographic fields and the whole header instead of sending placeholders', () => {
  const settings = { model: 'm', serviceTier: null, effort: null };
  const sparse = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: 'q', citations: [], settings, paper: { title: 'Only a Title', authors: [] } });
  const parsed = JSON.parse(sparse.split('\n\n')[1]!) as { paper: Record<string, unknown>; bibliography: string };
  expect(parsed.paper).toEqual({ title: 'Only a Title', authors: [] });
  expect(parsed.bibliography).toBe('Title: Only a Title');
  expect(parsed.bibliography).not.toMatch(/unknown|n\/a|undefined|null|Journal|DOI|Volume/iu);
  // No paper and no citation: no identity, and therefore no empty header shell.
  const none = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: 'q', citations: [], settings });
  const bare = JSON.parse(none.split('\n\n')[1]!) as Record<string, unknown>;
  expect(bare.paper).toBeNull();
  expect('bibliography' in bare).toBe(false);
  // A citation-only identity still gets its declared fields, and no field it does not have.
  const fromCitation = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: 'q', citations: [citationA], settings });
  const cited = JSON.parse(fromCitation.split('\n\n')[1]!) as { paper: Record<string, unknown>; bibliography: string };
  expect(cited.paper).toEqual({ title: 'Synthetic Paper A', authors: ['Synthetic Author'], year: '2026' });
  expect(cited.bibliography).toBe('Title: Synthetic Paper A\nAuthors: Synthetic Author\nYear: 2026');
  // An explicitly empty list stays present, so the identity the model is shown matches what was sent.
  const emptyTags = readingInput({ requestId: 'r', conversationId: 'c', action: 'ask', question: 'q', citations: [], settings, paper: { title: 'T', authors: [], tags: [] } });
  const kept = JSON.parse(emptyTags.split('\n\n')[1]!) as { paper: Record<string, unknown> };
  expect(kept.paper).toEqual({ title: 'T', authors: [], tags: [] });
});
it('uses a short English More details question and does not default answers to that English', async () => {
  const { EXPLAIN_QUESTION, PAPER_THREAD_POLICY } = await import('../../packages/core/src/codex/reader-policy.ts');
  expect(EXPLAIN_QUESTION).toBe('tell me more about this');
  expect(EXPLAIN_QUESTION).not.toMatch(/请用中文解释/u);
  expect(PAPER_THREAD_POLICY.developerInstructions).toMatch(/Zotero locale|paper language|Chinese/iu);
  expect(PAPER_THREAD_POLICY.developerInstructions).not.toMatch(/Answer in the language of the user's question, Chinese by default/u);
  expect(PAPER_THREAD_POLICY.developerInstructions).toMatch(/unseen pages or figures/iu);
});
it('launches app-server with pinned-runtime tool and instruction discovery disabled', () => {
  const args = codexLaunchArgs();
  expect(args).toContain('app-server'); expect(args).toContain('features.shell_tool=false');
  expect(args).toContain('project_doc_max_bytes=0'); expect(args).toContain('web_search="disabled"');
  expect(args).toContain('skills.include_instructions=false'); expect(args).toContain('features.plugins=false');
});
it('keeps official runtime auth in the dedicated CODEX_HOME rather than shared keychain storage', () => {
  expect(codexLaunchArgs()).toContain('cli_auth_credentials_store="file"');
});
it('pins global read-only defaults, rejects unrecognized configuration and keeps no Codex-side history', () => {
  const args = codexLaunchArgs();
  expect(args).toContain('--strict-config');
  for (const flag of ['approval_policy="never"', 'sandbox_mode="read-only"', 'default_permissions=":read-only"', 'approvals_reviewer="user"', 'history.persistence="none"', 'features.memories=false', 'features.remote_control=false']) expect(args).toContain(flag);
});
it('accepts the observed 0.154.0 effective policy and rejects each weakened variant', () => {
  expect(() => validatePolicy(configResponse(), '/isolated/auth')).not.toThrow();
  const weakened: Array<[string, (fixture: ReturnType<typeof configResponse>) => void]> = [
    ['history persisted by Codex', f => { f.config.history.persistence = 'save-all'; }],
    ['external program notify', f => { f.config.notify = ['osascript'] as never; }],
    ['non-default provider', f => { f.config.model_provider = 'proxy' as never; }],
    ['second flags layer', f => { f.layers.push({ name: { type: 'sessionFlags' }, version: 'x', config: {} }); }],
    ['unknown layer type', f => { f.layers.push({ name: { type: 'project', file: '/isolated/.codex/config.toml' }, version: 'x', config: { model: 'x' } }); }],
    ['user profile active', f => { f.layers[1]!.name.profile = 'work' as never; }],
    ['missing features object', f => { delete (f.config as Record<string, unknown>).features; }],
  ];
  for (const [label, weaken] of weakened) {
    const fixture = configResponse(); weaken(fixture);
    expect(() => validatePolicy(fixture, '/isolated/auth'), label).toThrow('policy');
  }
});
it('pins the two 0.154.0 policy changes: a non-null ChatGPT base URL and no thread-config endpoint', () => {
  // The pinned 0.154.0 binary now defaults chatgpt_base_url and dropped the endpoint key from its
  // schema. A wrong base URL must still fail closed; a stale endpoint key is simply unrecognized.
  const fixture = configResponse();
  const config = fixture.config as Record<string, unknown>;
  expect(config.chatgpt_base_url).toBe('https://chatgpt.com/backend-api/');
  expect('experimental_thread_config_endpoint' in config).toBe(false);
  expect(() => validatePolicy(fixture, '/isolated/auth')).not.toThrow();
  const weakened = configResponse();
  (weakened.config as Record<string, unknown>).chatgpt_base_url = null;
  expect(() => validatePolicy(weakened, '/isolated/auth')).toThrow('policy');
});
it('tolerates additional benign keys and empty managed layers reported by the pinned binary', () => {
  const fixture = configResponse();
  (fixture.config as Record<string, unknown>).some_future_key = 'value';
  fixture.layers.push({ name: { type: 'mdm' }, version: 'x', config: {} });
  expect(() => validatePolicy(fixture, '/isolated/auth')).not.toThrow();
});
