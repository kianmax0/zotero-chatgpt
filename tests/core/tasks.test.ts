import { expect, it } from 'vitest';
import { NATIVE_ANNOTATION_PROVENANCE, NativeOperationError, type NativeActionPort, type NativeAnnotationSnapshot, type NativeAttachmentSnapshot, type NativeChildNoteSnapshot, type NativeCollectionSnapshot, type NativeFigureCalloutInput, type NativeFigureCalloutSnapshot, type NativeItemSnapshot, type NativeMetadata, type NativeOrganizationItemSnapshot } from '../../packages/contracts/src/native.ts';
import { ActionTaskController } from '../../packages/core/src/tasks/controller.ts';
import { childNoteHTML, parseAnnotationCandidates, parseFigureCalloutProposals, validateAnnotationProposal } from '../../packages/contracts/src/tasks.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { imageA, paperA } from '../contracts/factories.ts';
const revision = { fingerprint: 'synthetic', size: 1024, modifiedAt: 1000 };
const metadata: NativeMetadata = { itemType: 'journalArticle', title: 'A synthetic article', DOI: '10.1234/example', creators: [] };
const target = { clientId: paperA.clientId, libraryId: paperA.libraryId, collectionKey: 'COLLECT1' };
function fixture() {
  let id = 0; let key = 0;
  const storage = new MemoryStorage(); const annotations = new Map<string, NativeAnnotationSnapshot>(); const items = new Map<string, NativeItemSnapshot>(); const notes = new Map<string, NativeChildNoteSnapshot>(); const collections = new Map<string, NativeCollectionSnapshot>();
  const figureCallouts = new Map<string, NativeFigureCalloutSnapshot>(); let figureWriteUncertain = false; let figureCreates = 0;
  const attachments = new Map<string, NativeAttachmentSnapshot>();
  const clock = { now: () => '2026-09-12T10:00:00.000Z', uuid: () => `12345678-0000-4000-8000-${String(++id).padStart(12, '0')}`, key: () => `K${String(++key).padStart(7, '0')}` };
  let creates = 0; let afterAnnotation: (() => Promise<void>) | null = null; let downloadFails = true;
  const native: NativeActionPort = {
    resolveQuote: input => Promise.resolve({ status: 'resolved', candidate: { source: structuredClone(input), text: input.quote, pageLabel: '1', sortIndex: '00000|000000|00000', position: { pageIndex: input.pageIndexes?.[0] ?? 0, rects: [[0, 0, 100, 10]] } } }),
    createAnnotation: async input => {
      creates++;
      if (annotations.has(input.key)) throw new NativeOperationError('CONFLICT', 'Already exists');
      const saved: NativeAnnotationSnapshot = { paper: input.candidate.source.paper, key: input.key, type: input.type, text: input.candidate.text, comment: NATIVE_ANNOTATION_PROVENANCE + (input.comment ? '\n' + input.comment : ''), color: input.color, pageLabel: input.candidate.pageLabel, sortIndex: input.candidate.sortIndex, position: input.candidate.position, authorName: '', isExternal: false, tags: [], dateModified: '2026-09-12 10:00:00' };
      annotations.set(input.key, structuredClone(saved)); if (afterAnnotation) await afterAnnotation(); return saved;
    },
    inspectAnnotation: input => Promise.resolve(structuredClone(annotations.get(input.key) ?? null)),
    inspectFigureCallout: input => { const value = figureCallouts.get(input.imageKey); return Promise.resolve(value ? { status: 'complete', callout: structuredClone(value) } : { status: 'absent' }); },
    createFigureCallout: (input: NativeFigureCalloutInput) => {
      figureCreates++;
      const [x0, y0, x1, y1] = input.selection.rect; const w = x1 - x0; const h = y1 - y0; const box = input.proposal.box;
      const rect: [number, number, number, number] = [x0 + box[0] * w, y1 - box[3] * h, x0 + box[2] * w, y1 - box[1] * h];
      const label = String.fromCharCode(65 + input.index); const imageSHA256 = 'a'.repeat(64); const dateModified = '2026-09-23T00:00:00.000Z';
      const callout: NativeFigureCalloutSnapshot = { selection: structuredClone(input.selection),
        image: { paper: input.selection.paper, key: input.imageKey, type: 'image', comment: `${NATIVE_ANNOTATION_PROVENANCE}\n${label}: ${input.proposal.explanation}`, color: '#7c5cff', pageLabel: '1', sortIndex: '00000|000000|00000', position: { pageIndex: input.selection.pageIndex, rects: [rect] }, authorName: '', isExternal: false, tags: [], dateModified, imageSHA256 },
        ink: { paper: input.selection.paper, key: input.inkKey, type: 'ink', comment: `${NATIVE_ANNOTATION_PROVENANCE}\n${label} callout`, color: '#7c5cff', pageLabel: '1', sortIndex: '00000|000000|00000', position: { pageIndex: input.selection.pageIndex, paths: input.proposal.strokes.map(stroke => stroke.flatMap(([x, y]) => [x0 + x * w, y1 - y * h])), width: 2.5 }, authorName: '', isExternal: false, tags: [], dateModified, imageSHA256 },
      };
      figureCallouts.set(input.imageKey, structuredClone(callout));
      if (figureWriteUncertain) throw new NativeOperationError('WRITE_UNCERTAIN', 'Stored before timeout.');
      return Promise.resolve(callout);
    },
    deleteFigureCallout: input => { const current = figureCallouts.get(input.expected.image.key); if (!current) return Promise.resolve({ status: 'absent' }); if (JSON.stringify(current) !== JSON.stringify(input.expected)) return Promise.resolve({ status: 'conflict' }); figureCallouts.delete(input.expected.image.key); return Promise.resolve({ status: 'deleted' }); },
    deleteAnnotation: input => { const current = annotations.get(input.expected.key); if (!current) return Promise.resolve({ status: 'absent' }); if (JSON.stringify(current) !== JSON.stringify(input.expected)) return Promise.resolve({ status: 'conflict', current }); annotations.delete(input.expected.key); return Promise.resolve({ status: 'deleted' }); },
    previewMetadata: input => Promise.resolve({ identifier: input.identifier, source: 'identifier', candidates: [structuredClone(metadata)] }),
    findDuplicateDOI: () => Promise.resolve([...items.values()].map(item => structuredClone(item))),
    inspectItem: input => Promise.resolve(structuredClone(items.get(input.key) ?? null)),
    inspectCollection: input => Promise.resolve(structuredClone(collections.get(input.collectionKey) ?? null)),
    inspectChildNote: input => Promise.resolve(structuredClone(notes.get(input.key) ?? null)),
    inspectOrganizationItem: input => {
      const item = items.get(input.key); return Promise.resolve(item ? { ...structuredClone(item), tags: [], organizationSignature: item.contentSignature } : null);
    },
    createItem: input => {
      const saved: NativeItemSnapshot = { clientId: input.target.clientId, libraryId: input.target.libraryId, key: input.key, metadata: structuredClone(input.metadata), collectionKeys: [input.target.collectionKey], attachmentKeys: [], dateModified: '2026-09-12 10:00:00', contentSignature: 'unchanged' };
      items.set(input.key, structuredClone(saved)); return Promise.resolve(saved);
    },
    createCollection: input => {
      const value: NativeCollectionSnapshot = { clientId: input.target.clientId, libraryId: input.target.libraryId, collectionKey: input.key, name: input.name, parentKey: input.target.parentCollectionKey, childItemKeys: [], childCollectionKeys: [], dateModified: '2026-09-12 10:00:00', contentSignature: 'created-collection' };
      collections.set(value.collectionKey, structuredClone(value)); return Promise.resolve(value);
    },
    undoCreatedCollection: input => {
      const current = collections.get(input.expected.collectionKey); if (!current) return Promise.resolve({ status: 'absent' });
      if (JSON.stringify(current) !== JSON.stringify(input.expected) || current.childItemKeys.length || current.childCollectionKeys.length) return Promise.resolve({ status: 'conflict' });
      collections.delete(current.collectionKey); return Promise.resolve({ status: 'trashed' });
    },
    fillMissingMetadata: input => {
      const before = structuredClone(items.get(input.expected.key)!); const after = structuredClone(before);
      after.metadata = { ...after.metadata, ...input.fields }; after.contentSignature = `filled-${after.contentSignature}`; items.set(after.key, after);
      return Promise.resolve({ before, after: structuredClone(after), fields: structuredClone(input.fields) });
    },
    undoMetadataFill: input => {
      const current = items.get(input.expected.after.key); if (!current) return Promise.resolve({ status: 'absent' });
      if (JSON.stringify(current) !== JSON.stringify(input.expected.after)) return Promise.resolve({ status: 'conflict' });
      const before = structuredClone(input.expected.before); before.contentSignature = `restored-${current.contentSignature}`; items.set(before.key, before); return Promise.resolve({ status: 'removed' });
    },
    createChildNote: input => {
      const note = { clientId: input.parent.clientId, libraryId: input.parent.libraryId, key: input.key, parentKey: input.parent.key, body: childNoteHTML(input.body), contentSignature: 'note-content' };
      notes.set(note.key, structuredClone(note)); return Promise.resolve(note);
    },
    undoChildNote: input => {
      const current = notes.get(input.expected.key); if (!current) return Promise.resolve({ status: 'absent' });
      if (JSON.stringify(current) !== JSON.stringify(input.expected)) return Promise.resolve({ status: 'conflict' });
      notes.delete(input.expected.key); return Promise.resolve({ status: 'trashed' });
    },
    addItemToCollection: input => {
      const before = items.get(input.expected.key)!; const after = { ...structuredClone(before), collectionKeys: [...new Set([...before.collectionKeys, input.target.collectionKey])] };
      items.set(after.key, after); return Promise.resolve({ before: structuredClone(before), after: structuredClone(after), collectionKey: input.target.collectionKey, added: !before.collectionKeys.includes(input.target.collectionKey) });
    },
    undoCollectionAddition: input => {
      const item = items.get(input.expected.after.key); if (!item) return Promise.resolve({ status: 'absent' });
      if (JSON.stringify(item) !== JSON.stringify(input.expected.after)) return Promise.resolve({ status: 'conflict' });
      item.collectionKeys = item.collectionKeys.filter(key => key !== input.expected.collectionKey); return Promise.resolve({ status: 'removed' });
    },
    organizeItem: input => {
      const raw = items.get(input.expected.key);
      if (!raw) return Promise.reject(new NativeOperationError('NOT_FOUND', 'missing'));
      const current = raw as NativeOrganizationItemSnapshot;
      const after = { ...structuredClone(current), tags: [...new Set([...current.tags, ...input.tags])].sort(), collectionKeys: [...new Set([...current.collectionKeys, ...input.collections.map(target => target.collectionKey)])].sort(), contentSignature: 'organized' };
      const change = { before: structuredClone(input.expected), after, addedTags: input.tags.filter(tag => !input.expected.tags.includes(tag)), addedCollectionKeys: input.collections.map(target => target.collectionKey).filter(key => !input.expected.collectionKeys.includes(key)) };
      items.set(after.key, after); return Promise.resolve(change);
    },
    undoOrganization: input => {
      const current = items.get(input.expected.after.key); if (!current) return Promise.resolve({ status: 'absent' });
      if (JSON.stringify(current) !== JSON.stringify(input.expected.after)) return Promise.resolve({ status: 'conflict' });
      items.set(input.expected.before.key, structuredClone(input.expected.before)); return Promise.resolve({ status: 'removed', after: structuredClone(input.expected.before) });
    },
    undoCreatedItem: input => { const current = items.get(input.expected.key); if (!current) return Promise.resolve({ status: 'absent' }); if (JSON.stringify(current) !== JSON.stringify(input.expected)) return Promise.resolve({ status: 'conflict' }); items.delete(input.expected.key); return Promise.resolve({ status: 'trashed' }); },
    acquireOpenAccessPDF: input => {
      if (downloadFails) return Promise.resolve({ status: 'unavailable', reason: 'download-failed' });
      const attachment: NativeAttachmentSnapshot = { clientId: input.item.clientId, libraryId: input.item.libraryId, key: 'ATTACHED', parentKey: input.item.key, url: 'https://example.com/paper.pdf', contentType: 'application/pdf', sha256: 'a'.repeat(64), contentSignature: 'unchanged' };
      attachments.set(attachment.key, attachment); items.get(input.item.key)!.attachmentKeys.push(attachment.key);
      return Promise.resolve({ status: 'attached', attachment, articleVersion: 'acceptedVersion', checkedPages: 1, totalPages: 4 });
    },
    inspectAttachment: ref => Promise.resolve(structuredClone(attachments.get(ref.key) ?? null)),
    undoAttachment: input => { const current = attachments.get(input.expected.key); if (!current) return Promise.resolve({ status: 'absent' }); if (JSON.stringify(current) !== JSON.stringify(input.expected)) return Promise.resolve({ status: 'conflict' }); attachments.delete(current.key); const parent = items.get(current.parentKey)!; parent.attachmentKeys = parent.attachmentKeys.filter(key => key !== current.key); return Promise.resolve({ status: 'trashed' }); },
  };
  const controller = new ActionTaskController(storage, native, clock);
  const plan = (count = 1) => controller.planAnnotations({ conversationId: 'conversation-a', paper: paperA, revision, question: 'Mark the definitions.', candidates: Array.from({ length: count }, (_, i) => ({ quote: `Definition ${i + 1}`, pageIndex: i, reason: 'Definition' })) });
  return { storage, native, clock, controller, annotations, items, notes, collections, attachments, figureCallouts, plan, creates: () => creates, figureCreates: () => figureCreates, setFigureWriteUncertain: (value: boolean) => { figureWriteUncertain = value; }, afterAnnotation: (callback: (() => Promise<void>) | null) => { afterAnnotation = callback; }, setDownloadFails: (value: boolean) => { downloadFails = value; } };
}
async function createTaskPaper(f: ReturnType<typeof fixture>) { return f.native.createItem({ target, key: 'PARENT01', metadata }); }
it('parses a bounded annotation proposal without accepting model-selected permissions or write fields', () => {
  expect(parseAnnotationCandidates('{"candidates":[{"quote":"A definition","pageIndex":0,"reason":"Definition"}]}')).toEqual([{ quote: 'A definition', pageIndex: 0, reason: 'Definition' }]);
  // A missing comment is not a reason to drop an otherwise resolvable candidate.
  expect(parseAnnotationCandidates('{"candidates":[{"quote":"A definition","pageIndex":0}]}')).toEqual([{ quote: 'A definition', pageIndex: 0, reason: '' }]);
  for (const text of ['```json\n{"candidates":[]}\n```', '{"candidates":[],"approved":true}', '{"candidates":[{"quote":"A definition","pageIndex":0,"reason":"Definition","key":"HOSTILE1"}]}', '{"candidates":[{"quote":"A definition","pageIndex":0,"reason":7}]}']) expect(() => parseAnnotationCandidates(text)).toThrow();
});
it('keeps annotation proposal parsing byte-preserving so historical comments remain compatible', () => {
  const parsed = parseAnnotationCandidates(JSON.stringify({ candidates: [{ quote: 'A definition', pageIndex: 0, reason: 'Explains the controlled comparison. [p. 350](https://zchatgpt.invalid/source/aaaaaaaa-bbbb-8ccc-addd-eeeeeeeeeeee/349) See https://example.org/method.' }] }));
  expect(parsed[0]?.reason).toBe('Explains the controlled comparison. [p. 350](https://zchatgpt.invalid/source/aaaaaaaa-bbbb-8ccc-addd-eeeeeeeeeeee/349) See https://example.org/method.');
  expect(validateAnnotationProposal({ quote: 'A definition', pageIndex: 0, reason: 'Legacy [p. 350](https://zchatgpt.invalid/source/aaaaaaaa-bbbb-8ccc-addd-eeeeeeeeeeee/349)' }).reason).toContain('zchatgpt.invalid');
});
it('accepts only bounded normalized figure callout boxes and strokes', async () => {
  expect(parseFigureCalloutProposals(JSON.stringify({ callouts: [{ box: [0.1, 0.2, 0.5, 0.6], strokes: [[[0.1, 0.2], [0.5, 0.6]]], explanation: 'Panel A' }] }))).toEqual([{ box: [0.1, 0.2, 0.5, 0.6], strokes: [[[0.1, 0.2], [0.5, 0.6]]], explanation: 'Panel A' }]);
  for (const malicious of [
    { callouts: [{ box: [-0.1, 0.2, 0.5, 0.6], strokes: [[[0.1, 0.2], [0.5, 0.6]]], explanation: 'x' }] },
    { callouts: [{ box: [0.1, 0.2, 0.5, 0.6], strokes: [[[0.1, 0.2]]], explanation: 'x' }] },
    { callouts: [{ box: [0.1, 0.2, 0.5, 0.6], strokes: [[[0.1, 0.2], [0.5, 0.6]]], explanation: 'x', key: 'HOSTILE1' }] },
  ]) expect(() => parseFigureCalloutProposals(JSON.stringify(malicious))).toThrow();
  const f = fixture();
  const crop = { ...imageA, origin: { kind: 'paper' as const, paper: paperA, pageIndex: 0, revision } };
  const selection = { paper: paperA, revision, pageIndex: 0, rect: [100, 100, 500, 500] as [number, number, number, number] };
  const proposal = { box: [0.1, 0.2, 0.5, 0.6] as [number, number, number, number], strokes: [[[0.1, 0.2], [0.5, 0.6]] as Array<[number, number]>], explanation: 'Marks the first panel.' };
  const task = await f.controller.planFigureAnnotations({ conversationId: 'conversation-a', question: 'Explain this figure.', modelRequestId: 'figure-request-a', selection, image: crop, proposals: [proposal] });
  if (task.kind !== 'figure-annotations') throw new Error('The Figure task changed kind.');
  const replay = await f.controller.planFigureAnnotations({ conversationId: 'conversation-a', question: 'Explain this figure.', modelRequestId: 'figure-request-a', selection, image: crop, proposals: [proposal] });
  expect(replay.id).toBe(task.id); expect(replay.items[0]?.reservedKey).toBe(task.items[0]?.reservedKey);
  await expect(f.controller.planFigureAnnotations({ conversationId: 'conversation-a', question: 'Different question.', modelRequestId: 'figure-request-a', selection, image: crop, proposals: [proposal] })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  expect(task).toMatchObject({ kind: 'figure-annotations', state: 'review', selection, items: [{ status: 'candidate', proposal }] });
  const item = task.items[0]!;
  expect(item.reservedKey).not.toBe(item.inkKey); expect(f.figureCallouts.size).toBe(0);
  const applied = await f.controller.approve(task.id, [item.id]);
  expect(applied).toMatchObject({ state: 'completed', items: [{ status: 'applied', callout: { image: { type: 'image' }, ink: { type: 'ink' } } }] });
  expect(f.figureCreates()).toBe(1); expect(f.figureCallouts.size).toBe(1);
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'undone' }); expect(f.figureCallouts.size).toBe(0);
});
it('reconciles a committed Figure callout after uncertainty without issuing another native write', async () => {
  const f = fixture(); f.setFigureWriteUncertain(true);
  const crop = { ...imageA, origin: { kind: 'paper' as const, paper: paperA, pageIndex: 0, revision } };
  const task = await f.controller.planFigureAnnotations({ conversationId: 'conversation-a', question: 'Explain this figure.', selection: { paper: paperA, revision, pageIndex: 0, rect: [100, 100, 500, 500] }, image: crop, proposals: [{ box: [0.1, 0.2, 0.5, 0.6] as [number, number, number, number], strokes: [[[0.1, 0.2], [0.5, 0.6]] as Array<[number, number]>], explanation: 'Marks the first panel.' }] });
  const writing = await f.controller.approve(task.id, [task.items[0]!.id]);
  expect(writing).toMatchObject({ state: 'uncertain', items: [{ status: 'uncertain' }] });
  f.setFigureWriteUncertain(false);
  expect(await f.controller.reconcile(task.id)).toMatchObject({ state: 'completed', items: [{ status: 'applied' }] });
  expect(f.figureCreates()).toBe(1);
});
it('carries a well-formed model annotation answer through parse, planning, approval and undo', async () => {
  const f = fixture();
  // The exact shape the annotate workflow asks the model to return, with the surrounding whitespace a
  // streamed answer carries. This is the only seam the host smoke driver leaves unverified
  // (`real-model-proposal`): it supplies hand-written proposals instead of model text.
  const answer = '\n{"candidates":[{"quote":"A prior describes beliefs before a measurement is observed.","pageIndex":0,"reason":"Definition of a prior."},{"quote":"A likelihood describes the measurement under each candidate.","pageIndex":1,"reason":"Definition of a likelihood."}]}\n';
  const candidates = parseAnnotationCandidates(answer);
  expect(candidates).toEqual([
    { quote: 'A prior describes beliefs before a measurement is observed.', pageIndex: 0, reason: 'Definition of a prior.' },
    { quote: 'A likelihood describes the measurement under each candidate.', pageIndex: 1, reason: 'Definition of a likelihood.' },
  ]);
  const planned = await f.controller.planAnnotations({ conversationId: 'conversation-a', paper: paperA, revision, question: 'Highlight the definitions.', modelRequestId: 'model-request-annotate', candidates });
  if (planned.kind !== 'annotations') throw new Error('The model candidates did not produce an annotation task.');
  expect(planned.state).toBe('review'); expect(planned.items.every(item => item.resolution?.status === 'resolved')).toBe(true);
  expect(f.creates()).toBe(0);
  const applied = await f.controller.approve(planned.id, planned.items.map(item => item.id));
  if (applied.kind !== 'annotations') throw new Error('The approved task changed kind.');
  expect(applied.state).toBe('completed'); expect(f.creates()).toBe(2);
  expect(applied.items.map(item => item.annotation?.comment)).toEqual([`${NATIVE_ANNOTATION_PROVENANCE}\nDefinition of a prior.`, `${NATIVE_ANNOTATION_PROVENANCE}\nDefinition of a likelihood.`]);
  const undone = await f.controller.undo(planned.id);
  expect(undone.state).toBe('undone'); expect(f.annotations.size).toBe(0);
});
it('auto-applies only uniquely resolved annotations through the approval ledger and keeps unresolved proposals visible', async () => {
  const f = fixture();
  const resolve = f.native.resolveQuote.bind(f.native);
  f.native.resolveQuote = async input => input.quote === 'Ambiguous passage'
    ? { status: 'ambiguous', matches: 2 }
    : resolve(input);
  const task = await f.controller.planAnnotations({
    conversationId: 'conversation-a', paper: paperA, revision, question: 'Highlight useful passages.', autoApply: true,
    candidates: [
      { quote: 'Definition one', pageIndex: 0, reason: 'Useful definition. [p. 1](https://zchatgpt.invalid/source/aaaaaaaa-bbbb-8ccc-addd-eeeeeeeeeeee/0)' },
      { quote: 'Ambiguous passage', pageIndex: 1, reason: 'Keep visible' },
    ],
  });
  expect(task.kind).toBe('annotations');
  if (task.kind !== 'annotations') throw new Error('The annotate task changed kind.');
  expect(task.autoApply).toBe(true); expect(task.approvedAt).toBeTruthy(); expect(task.state).toBe('partial');
  expect(task.items[0]).toMatchObject({ status: 'applied', selected: true, annotation: { comment: `${NATIVE_ANNOTATION_PROVENANCE}\nUseful definition.` } });
  expect(task.items[1]).toMatchObject({ status: 'unresolved', selected: false, resolution: { status: 'ambiguous' } });
  expect(f.creates()).toBe(1);
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'undone' });
  expect(f.annotations.size).toBe(0);
});
it('does not upgrade an existing manual annotation task into automatic writes', async () => {
  const f = fixture();
  const input = { conversationId: 'conversation-a', paper: paperA, revision, question: 'Mark the definition.', modelRequestId: 'model-request-a', candidates: [{ quote: 'Definition', pageIndex: 0, reason: 'Useful' }] };
  const manual = await f.controller.planAnnotations(input);
  await expect(f.controller.planAnnotations({ ...input, autoApply: true })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  expect(await f.controller.get(manual.id)).toEqual(manual);
  expect(f.creates()).toBe(0);
});
it('marks auto-apply annotation tasks failed when no quote is uniquely resolvable and performs no writes', async () => {
  const f = fixture();
  f.native.resolveQuote = () => Promise.resolve({ status: 'unresolved', reason: 'not-found' });
  const task = await f.controller.planAnnotations({ conversationId: 'conversation-a', paper: paperA, revision, question: 'Highlight these.', autoApply: true, candidates: [{ quote: 'Missing quote', pageIndex: 0, reason: 'Explain' }] });
  expect(task).toMatchObject({ kind: 'annotations', state: 'failed', autoApply: true, items: [{ status: 'unresolved', resolution: { status: 'unresolved', reason: 'not-found' } }] });
  expect(f.creates()).toBe(0);
});
it('persists candidate review and source validation without native writes before approval', async () => {
  const f = fixture(); const task = await f.plan();
  expect(task).toMatchObject({ kind: 'annotations', state: 'review', question: 'Mark the definitions.', items: [{ status: 'candidate', resolution: { status: 'resolved' } }] });
  expect(f.annotations.size).toBe(0); expect(f.items.size).toBe(0);
  const restored = new ActionTaskController(f.storage, f.native, f.clock);
  expect(await restored.get(task.id)).toEqual(task); expect(await restored.list('conversation-a')).toHaveLength(1); expect(await restored.list('conversation-b')).toEqual([]);
});
it('a duplicate approval writes an annotation only once and persists its exact native output', async () => {
  const f = fixture(); const task = await f.plan(); const selected = task.items.map(item => item.id);
  await Promise.all([f.controller.approve(task.id, selected), f.controller.approve(task.id, selected)]);
  expect(f.creates()).toBe(1); expect(f.annotations.size).toBe(1);
  expect(await f.controller.get(task.id)).toMatchObject({ state: 'completed', items: [{ status: 'applied', annotation: { key: task.items[0]!.reservedKey } }] });
});
it('reserves and durably writes native intent before invoking the host', async () => {
  const f = fixture(); const task = await f.plan(); let observed = false;
  f.afterAnnotation(async () => { const raw = await f.storage.read(`tasks/${task.id}.json`); const text = new TextDecoder().decode(raw!); observed = text.includes('"status":"writing"') && text.includes('"operation":"annotation-create"'); });
  await f.controller.approve(task.id, task.items.map(item => item.id)); expect(observed).toBe(true);
});
it('storage failure before writing intent prevents every native mutation', async () => {
  const f = fixture(); const task = await f.plan(); f.storage.fail = true;
  await expect(f.controller.approve(task.id, task.items.map(item => item.id))).rejects.toThrow(); expect(f.creates()).toBe(0);
});
it('reconciles a host commit followed by lost ledger persistence without resubmitting the write', async () => {
  const f = fixture(); const task = await f.plan(); f.afterAnnotation(() => { f.storage.fail = true; return Promise.resolve(); });
  await expect(f.controller.approve(task.id, task.items.map(item => item.id))).rejects.toThrow();
  f.storage.fail = false; f.afterAnnotation(null);
  const restored = new ActionTaskController(f.storage, f.native, f.clock);
  expect(await restored.get(task.id)).toMatchObject({ state: 'uncertain' });
  expect(await restored.reconcile(task.id)).toMatchObject({ state: 'completed', items: [{ status: 'applied' }] });
  await restored.approve(task.id, task.items.map(item => item.id)); expect(f.creates()).toBe(1);
});
it('an unknown native write is never automatically replayed when inspection finds no output', async () => {
  const f = fixture(); const task = await f.plan();
  f.native.createAnnotation = () => Promise.reject(new Error('private-native-error'));
  expect(await f.controller.approve(task.id, task.items.map(item => item.id))).toMatchObject({ state: 'uncertain' });
  const result = await f.controller.reconcile(task.id);
  expect(result.state).not.toBe('completed'); expect(f.annotations.size).toBe(0); expect(JSON.stringify(result)).not.toContain('private-native-error');
});
it('cancellation after a committed annotation retains that result and leaves the next item unexecuted', async () => {
  const f = fixture(); const task = await f.plan(2); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }); f.afterAnnotation(() => gate);
  const approving = f.controller.approve(task.id, task.items.map(item => item.id)); await flush();
  expect(f.annotations.size).toBe(1);
  const cancelling = f.controller.cancel(task.id); release(); await approving; const cancelled = await cancelling;
  expect(cancelled.state).toBe('cancelled'); expect(f.annotations.size).toBe(1); expect(cancelled.items[0]!.status).toBe('applied');
});
it('undo uses exact saved outputs and preserves a later human annotation edit', async () => {
  const f = fixture(); const task = await f.plan(2); await f.controller.approve(task.id, task.items.map(item => item.id));
  f.annotations.get(task.items[0]!.reservedKey)!.comment = 'Human edit';
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'conflict' });
  expect(f.annotations.size).toBe(1); expect(f.annotations.get(task.items[0]!.reservedKey)!.comment).toBe('Human edit');
});
it('acquisition review performs metadata lookup and duplicate checks without importing anything', async () => {
  const f = fixture(); const task = await f.controller.planAcquisition({ conversationId: 'conversation-a', target, question: 'Get this paper', identifiers: ['10.1234/example'] });
  expect(task).toMatchObject({ state: 'review', items: [{ preview: { candidates: [metadata] } }] }); expect(f.items.size).toBe(0);
});
it('fills only blank allowlisted metadata after review and restores only the exact task delta', async () => {
  const f = fixture(); const parent = await createTaskPaper(f); const current = f.items.get(parent.key)!;
  const candidate: NativeMetadata = { ...metadata, abstractNote: 'A concise abstract.', publicationTitle: 'Example Journal' };
  f.native.previewMetadata = input => Promise.resolve({ identifier: input.identifier, source: 'identifier', candidates: [candidate] });
  const task = await f.controller.planMetadataUpdate({ conversationId: 'conversation-a', question: 'Fill missing metadata.', selection: [current] });
  expect(task).toMatchObject({ kind: 'metadata-update', state: 'review', items: [{ fields: { abstractNote: 'A concise abstract.', publicationTitle: 'Example Journal' }, status: 'candidate' }] });
  expect(f.items.get(parent.key)!.metadata).not.toHaveProperty('abstractNote');
  const applied = await f.controller.approve(task.id, task.items.map(item => item.id));
  expect(applied).toMatchObject({ state: 'completed', items: [{ status: 'applied', change: { after: { metadata: { title: metadata.title, abstractNote: 'A concise abstract.', publicationTitle: 'Example Journal' } } } }] });
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'undone' });
  expect(f.items.get(parent.key)!.metadata).toEqual(metadata);
});
it('creates a provenance-marked child note and preserves later human edits on undo', async () => {
  const f = fixture(); const parent = await createTaskPaper(f); const snapshot = f.items.get(parent.key)!;
  const task = await f.controller.planChildNotes({ conversationId: 'conversation-a', question: 'Summarize this paper.', modelRequestId: 'summary-request-a', proposals: [{ parent: snapshot, body: 'Question: What does it test?\n\nFinding: A synthetic result.' }] });
  expect(task).toMatchObject({ kind: 'child-notes', state: 'review', items: [{ status: 'candidate' }] });
  const applied = await f.controller.approve(task.id, task.items.map(item => item.id));
  expect(applied.state).toBe('completed');
  const appliedNote = applied.kind === 'child-notes' ? applied.items[0]?.note : undefined;
  expect(appliedNote?.parentKey).toBe(parent.key); expect(appliedNote?.body).toContain('data-zchatgpt-provenance="zotero-chatgpt"');
  const saved = f.notes.get(task.items[0]!.reservedKey)!; saved.body = '<p>Human edited note</p>';
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'conflict' });
  expect(f.notes.get(task.items[0]!.reservedKey)?.body).toBe('<p>Human edited note</p>');
});
it('creates a named child collection under the explicit parent and trashes it on exact undo', async () => {
  const f = fixture(); const createTarget = { clientId: target.clientId, libraryId: target.libraryId, parentCollectionKey: target.collectionKey };
  const task = await f.controller.planCollectionCreate({ conversationId: 'conversation-a', question: 'Create a collection.', target: createTarget, name: 'Predictive Coding' });
  expect(task).toMatchObject({ kind: 'collection-create', state: 'review', items: [{ target: createTarget, name: 'Predictive Coding', status: 'candidate' }] });
  const applied = await f.controller.approve(task.id, task.items.map(item => item.id));
  expect(applied).toMatchObject({ state: 'completed', items: [{ status: 'applied', collection: { name: 'Predictive Coding', parentKey: 'COLLECT1', childItemKeys: [], childCollectionKeys: [] } }] });
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'undone' }); expect(f.collections.size).toBe(0);
});
it('preserves a created collection if a user adds an item before undo', async () => {
  const f = fixture(); const task = await f.controller.planCollectionCreate({ conversationId: 'conversation-a', question: 'Create a collection.', target: { clientId: target.clientId, libraryId: target.libraryId, parentCollectionKey: null }, name: 'Methods' });
  const applied = await f.controller.approve(task.id, task.items.map(item => item.id)); if (applied.kind !== 'collection-create') throw new Error('Expected a collection task');
  f.collections.get(applied.items[0]!.reservedKey)!.childItemKeys.push('CHILD000');
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'conflict' }); expect(f.collections.size).toBe(1);
});
it('a failed PDF download retains correct metadata and reports partial completion', async () => {
  const f = fixture(); const task = await f.controller.planAcquisition({ conversationId: 'conversation-a', target, question: 'Get this paper', identifiers: ['10.1234/example'] });
  const result = await f.controller.approve(task.id, task.items.map(item => item.id));
  expect(result).toMatchObject({ state: 'partial', items: [{ status: 'metadata-only', created: true, acquisition: { status: 'unavailable', reason: 'download-failed' } }] });
  expect(f.items.size).toBe(1);
  await f.controller.approve(task.id, task.items.map(item => item.id)); expect(f.items.size).toBe(1);
});
it('duplicate imports add only collection membership and undo that exact addition', async () => {
  const f = fixture(); f.items.set('EXISTING', { clientId: paperA.clientId, libraryId: paperA.libraryId, key: 'EXISTING', metadata, collectionKeys: [], attachmentKeys: [], dateModified: '2026-09-12 10:00:00', contentSignature: 'unchanged' });
  const task = await f.controller.planAcquisition({ conversationId: 'conversation-a', target, question: 'Get this paper', identifiers: ['10.1234/example'] });
  await f.controller.approve(task.id, task.items.map(item => item.id), { [task.items[0]!.id]: { downloadPDF: false } });
  expect(f.items.size).toBe(1); expect(f.items.get('EXISTING')!.collectionKeys).toEqual(['COLLECT1']);
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'undone' }); expect(f.items.get('EXISTING')!.collectionKeys).toEqual([]);
});
it('task records with an unknown schema remain untouched and cannot authorize writes', async () => {
  const f = fixture(); const task = await f.plan(); const path = `tasks/${task.id}.json`; const bytes = new TextEncoder().encode('{"schemaVersion":99}'); f.storage.files.set(path, bytes);
  await expect(f.controller.get(task.id)).rejects.toThrow(); await expect(f.controller.approve(task.id, [])).rejects.toThrow(); expect(f.storage.files.get(path)).toEqual(bytes); expect(f.creates()).toBe(0);
});
it('approval rejects item IDs not present in the frozen review', async () => {
  const f = fixture(); const task = await f.plan();
  await expect(f.controller.approve(task.id, ['not-in-review'])).rejects.toThrow(); expect(f.creates()).toBe(0);
});
it('undoing an acquired PDF on an existing item only removes the task attachment and collection addition', async () => {
  const f = fixture(); f.setDownloadFails(false); f.items.set('EXISTING', { clientId: paperA.clientId, libraryId: paperA.libraryId, key: 'EXISTING', metadata, collectionKeys: [], attachmentKeys: [], dateModified: '2026-09-12 10:00:00', contentSignature: 'unchanged' });
  const task = await f.controller.planAcquisition({ conversationId: 'conversation-a', target, question: 'Get this paper', identifiers: ['10.1234/example'] });
  expect(await f.controller.approve(task.id, task.items.map(item => item.id))).toMatchObject({ state: 'completed' });
  expect(await f.controller.undo(task.id)).toMatchObject({ state: 'undone' });
  expect(f.attachments.size).toBe(0); expect(f.items.get('EXISTING')).toMatchObject({ collectionKeys: [], attachmentKeys: [] });
});
it('an immediate stop cancels an approval still waiting to start', async () => {
  const f = fixture(); const task = await f.plan();
  const approving = f.controller.approve(task.id, task.items.map(item => item.id));
  const cancelling = f.controller.cancel(task.id);
  await approving; expect(await cancelling).toMatchObject({ state: 'cancelled' }); expect(f.creates()).toBe(0);
});
it('metadata reconciliation never adopts later human fields into an undoable task snapshot', async () => {
  const f = fixture(); const task = await f.controller.planAcquisition({ conversationId: 'conversation-a', target, question: 'Get this paper', identifiers: ['10.1234/example'] });
  const create = f.native.createItem.bind(f.native);
  f.native.createItem = async input => { const item = await create(input); f.storage.fail = true; return item; };
  await expect(f.controller.approve(task.id, task.items.map(item => item.id))).rejects.toThrow();
  f.storage.fail = false; f.items.get(task.items[0]!.reservedKey)!.contentSignature = 'Later human notes and tags';
  const restored = new ActionTaskController(f.storage, f.native, f.clock);
  const result = await restored.reconcile(task.id); expect(['uncertain', 'conflict']).toContain(result.state);
  await expect(restored.undo(task.id)).rejects.toThrow(); expect(f.items.size).toBe(1);
});
it('reuses one persisted annotation plan for concurrent calls with the same model request', async () => {
  const f = fixture(); const input = { conversationId: 'conversation-a', paper: paperA, revision, question: 'Mark the definition.', modelRequestId: 'model-request-a', candidates: [{ quote: 'A definition', pageIndex: 0, reason: 'Definition' }] };
  const [first, second] = await Promise.all([f.controller.planAnnotations(input), f.controller.planAnnotations(input)]);
  expect(second.id).toBe(first.id); expect(second.items.map(item => item.reservedKey)).toEqual(first.items.map(item => item.reservedKey));
  expect(await f.controller.list('conversation-a')).toHaveLength(1);
  expect(await new ActionTaskController(f.storage, f.native, f.clock).planAnnotations(input)).toEqual(first);
});
it('rejects conflicting content for a reused model request instead of replacing its task', async () => {
  const f = fixture(); const input = { conversationId: 'conversation-a', paper: paperA, revision, question: 'Mark the definition.', modelRequestId: 'model-request-a', candidates: [{ quote: 'A definition', pageIndex: 0, reason: 'Definition' }] };
  const original = await f.controller.planAnnotations(input);
  for (const changed of [{ ...input, question: 'Different task' }, { ...input, candidates: [{ quote: 'Different definition', pageIndex: 0, reason: 'Definition' }] }, { ...input, conversationId: 'conversation-b' }]) await expect(f.controller.planAnnotations(changed)).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  expect(await f.controller.get(original.id)).toEqual(original); expect(f.creates()).toBe(0);
});
it('suppresses a second request for a verified annotation but allows it after confirmed undo', async () => {
  const f = fixture();
  const input = (modelRequestId: string) => ({ conversationId: 'conversation-a', paper: paperA, revision, question: 'Mark the definition.', modelRequestId, candidates: [{ quote: 'A definition', pageIndex: 99, reason: 'Definition' }] });
  const first = await f.controller.planAnnotations(input('model-request-a')); await f.controller.approve(first.id, first.items.map(item => item.id));
  const duplicate = await f.controller.planAnnotations(input('model-request-b'));
  expect(duplicate).toMatchObject({ state: 'review', items: [{ status: 'skipped', errorCode: 'DUPLICATE_PROPOSAL' }] });
  expect(f.creates()).toBe(1);
  expect(await f.controller.undo(first.id)).toMatchObject({ state: 'undone' });
  const retry = await f.controller.planAnnotations(input('model-request-c'));
  expect(retry).toMatchObject({ items: [{ status: 'candidate' }] });
  await f.controller.approve(retry.id, retry.items.map(item => item.id)); expect(f.creates()).toBe(2);
});
it('coordinates concurrent recovered controller instances over the same storage port', async () => {
  const f = fixture(); const other = new ActionTaskController(f.storage, f.native, f.clock);
  const input = { conversationId: 'conversation-a', paper: paperA, revision, question: 'Mark the definition.', modelRequestId: 'model-request-a', candidates: [{ quote: 'A definition', pageIndex: 0, reason: 'Definition' }] };
  const tasks = await Promise.all([f.controller.planAnnotations(input), other.planAnnotations(input)]);
  expect(tasks[0].id).toBe(tasks[1].id); expect(await other.list('conversation-a')).toHaveLength(1);
});
it('stops a preparing annotation plan promptly and ignores a late native quote result', async () => {
  const f = fixture(); const resolveQuote = f.native.resolveQuote.bind(f.native); let release!: () => void; let taskID = '';
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.native.resolveQuote = async input => { await gate; return resolveQuote(input); };
  f.controller.subscribe(task => { taskID = task.id; });
  const input = { conversationId: 'conversation-a', paper: paperA, revision, question: 'Mark the definition.', modelRequestId: 'model-request-a', candidates: [{ quote: 'A definition', pageIndex: 0, reason: 'Definition' }] };
  const planning = f.controller.planAnnotations(input); await flush();
  let stopped = false; const cancelling = f.controller.cancel(taskID).then(task => { stopped = true; return task; });
  await flush(); const stoppedBeforeNativeReturned = stopped; release(); await planning;
  expect(stoppedBeforeNativeReturned).toBe(true); expect(await cancelling).toMatchObject({ state: 'cancelled' }); await flush();
  expect(await f.controller.get(taskID)).toMatchObject({ state: 'cancelled' }); expect(await f.controller.planAnnotations(input)).toMatchObject({ id: taskID, state: 'cancelled' }); expect(f.creates()).toBe(0);
});
it('stops a preparing acquisition plan without allowing late metadata to revive review', async () => {
  const f = fixture(); const preview = f.native.previewMetadata.bind(f.native); let release!: () => void; let taskID = '';
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.native.previewMetadata = async input => { await gate; return preview(input); };
  f.controller.subscribe(task => { taskID = task.id; });
  const planning = f.controller.planAcquisition({ conversationId: 'conversation-a', target, question: 'Get paper', identifiers: ['10.1234/example'] }); await flush();
  let stopped = false; const cancelling = f.controller.cancel(taskID).then(task => { stopped = true; return task; });
  await flush(); const stoppedBeforeNativeReturned = stopped; release(); await planning; await cancelling; await flush();
  expect(stoppedBeforeNativeReturned).toBe(true); expect(await f.controller.get(taskID)).toMatchObject({ state: 'cancelled' }); expect(f.items.size).toBe(0);
});
it('lists all validated tasks when no conversation filter is supplied', async () => {
  const f = fixture(); const first = await f.plan();
  const second = await f.controller.planAcquisition({ conversationId: 'conversation-b', target, question: 'Get paper', identifiers: ['10.1234/example'] });
  expect((await f.controller.list()).map(task => task.id).sort()).toEqual([first.id, second.id].sort());
  expect(await f.controller.list('conversation-b')).toHaveLength(1);
});
