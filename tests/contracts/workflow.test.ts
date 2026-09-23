import { expect, it } from 'vitest';
import { validateSendInput } from '../../packages/contracts/src/validation.ts';
import { validateDocument } from '../../packages/contracts/src/document.ts';
import { makeSend, paperB } from './factories.ts';
import { documentA } from './document-fixture.ts';
const workflow = {
  skill: { id: 'proof', name: 'Proof', description: 'Explain a derivation', version: '1', revision: 'revision-1', markdown: '# Steps\nRead the definitions.', origin: 'user' as const, enabled: true, workflow: 'read' as const, permissions: ['Read supplied context'], unsupportedDependencies: [] },
  preferences: { language: 'zh', detail: 'detailed' as const, mathematics: 'formal' as const, background: '', citationStyle: 'page labels', annotationStyle: 'definitions' }, profileId: null,
};
it('validates and freezes workflow and explicitly referenced article snapshots', () => {
  const ref = { id: 'article-b', kind: 'article' as const, label: 'B', paper: paperB, capturedAt: '2026-09-12T10:00:00.000Z', document: structuredClone({ ...documentA, paper: paperB }) };
  const checked = validateSendInput(makeSend({ workflow, references: [ref] }));
  workflow.preferences.language = 'en'; ref.document.pages[0] = { ...ref.document.pages[0]!, text: 'Changed' };
  expect(checked.workflow?.preferences.language).toBe('zh'); expect(checked.references?.[0]?.document?.pages[0]?.text).toContain('Definition');
});
it('persists automatic annotation intent only for an explicit annotate workflow', () => {
  const annotate = { ...workflow.skill, workflow: 'annotate' as const };
  const approved = validateSendInput(makeSend({ mode: 'agent', workflow: { ...workflow, skill: annotate, autoApplyAnnotations: true } }));
  expect(approved.workflow?.autoApplyAnnotations).toBe(true);
  expect(() => validateSendInput(makeSend({ mode: 'chat', workflow: { ...workflow, skill: annotate, autoApplyAnnotations: true } }))).toThrow();
  expect(() => validateSendInput(makeSend({ workflow: { ...workflow, autoApplyAnnotations: true } }))).toThrow();
  expect(() => validateSendInput(makeSend({ workflow: { ...workflow, skill: annotate, autoApplyAnnotations: false as never } }))).toThrow();
});
it('does not count referenced document text as control metadata or silently truncate it', () => {
  const ref = { id: 'article-b', kind: 'article' as const, label: 'B', paper: paperB, capturedAt: '2026-09-12T10:00:00.000Z', document: { ...documentA, paper: paperB, pages: [{ ...documentA.pages[0]!, text: 'x'.repeat(300000) }] } };
  expect(validateSendInput(makeSend({ references: [ref] })).references?.[0]?.document?.pages[0]?.text).toHaveLength(300000);
});
it('rejects recursive chat sources and mismatched referenced document identity', () => {
  const base = { id: 'ref', label: 'Reference', capturedAt: '2026-09-12T10:00:00.000Z', document: documentA };
  expect(() => validateSendInput(makeSend({ references: [{ ...base, kind: 'chat', conversationId: makeSend().conversationId }] }))).toThrow();
  expect(() => validateSendInput(makeSend({ references: [{ ...base, kind: 'article', paper: paperB }] }))).toThrow();
});
it('preserves a verified file hash and the full-source identity on a budgeted subset', () => {
  const input = { ...documentA, sourceId: documentA.id, revision: { ...documentA.revision, sha256: 'a'.repeat(64) } };
  expect(validateDocument(input)).toMatchObject({ sourceId: documentA.id, revision: { sha256: 'a'.repeat(64) } });
});
