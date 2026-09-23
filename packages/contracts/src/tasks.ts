import { ReaderError, type Citation, type DocumentRevision, type ImageAttachment, type PaperScope } from './index.ts';
import { validateCitation } from './validation.ts';
import type { NativeAcquisitionResult, NativeAnnotationCandidate, NativeAnnotationSnapshot, NativeChildNoteSnapshot, NativeCollectionAddition, NativeCollectionCreateTarget, NativeCollectionSnapshot, NativeCollectionTarget, NativeFigureCalloutProposal, NativeFigureCalloutSnapshot, NativeFigureSelection, NativeItemSnapshot, NativeMetadataFill, NativeMetadataPreview, NativeMetadataUpdateChange, NativeOrganizationChange, NativeOrganizationItemSnapshot, NativeQuoteResolution } from './native.ts';

export interface AnnotationProposal { quote: string; pageIndex: number; reason: string }
/**
 * Untrusted model/user JSON is validated here, next to the contract it produces. The helpers mirror
 * the task controller's task-input validator so the relocated candidate parser keeps byte-identical
 * error text and limits; like `validation.ts`, they stay module-local rather than shared.
 */
function invalid(): never { throw new ReaderError('INVALID_REQUEST', 'The task input is invalid or no longer matches its review.'); }
function text(value: unknown, max: number, min = 0): string { if (typeof value !== 'string' || value.length < min || value.length > max || value.includes('\0')) invalid(); return value; }
function record(value: unknown, allowed?: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); const object = value as Record<string, unknown>; if (allowed && Object.keys(object).some(k => !allowed.includes(k))) invalid(); return object; }
/** One model-proposed annotation, before the controller resolves it against a frozen PDF version. */
export function validateAnnotationProposal(value: unknown): AnnotationProposal {
  const p = record(value, ['quote', 'pageIndex', 'reason']);
  if (!Number.isSafeInteger(p.pageIndex) || (p.pageIndex as number) < 0 || (p.pageIndex as number) >= 10000) invalid();
  // `reason` only becomes the annotation comment. A model that omits it still has to supply an exact
  // quote and a valid page, so treating it as empty keeps a resolvable candidate instead of dropping
  // the whole batch. Extra keys remain rejected: the allowlist is what stops model-chosen write fields.
  return { quote: text(p.quote, 16000, 2), pageIndex: p.pageIndex as number, reason: p.reason === undefined ? '' : text(p.reason, 4000) };
}
/** Remove only Zotero ChatGPT's internal page citation links before a new comment is persisted. */
export function cleanAnnotationReason(value: string): string {
  const link = /\[[^\]]*\]\(https:\/\/zchatgpt\.invalid\/source\/[a-zA-Z0-9-]{1,128}\/\d+(?:\s+"[^"]*")?\)/giu;
  const bareURL = /https:\/\/zchatgpt\.invalid\/source\/[a-zA-Z0-9-]{1,128}\/\d+/giu;
  return value.replace(link, '').replace(bareURL, '').replace(/[\t ]{2,}/gu, ' ').replace(/\s+([,.;:!?])/gu, '$1').trim();
}
export function parseAnnotationCandidates(value: string): AnnotationProposal[] {
  text(value, 1024 * 1024, 2);
  let parsed: unknown; try { parsed = JSON.parse(value) as unknown; } catch { invalid(); }
  const result = record(parsed, ['candidates']); if (!Array.isArray(result.candidates) || result.candidates.length > 50) invalid();
  return result.candidates.map(validateAnnotationProposal);
}
export interface OrganizationProposal { itemIndex: number; tags: string[]; collectionIndexes: number[] }
function itemIndex(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= 50) invalid(); return value as number; }
function collectionIndex(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= 1000) invalid(); return value as number; }
function uniqueIndexes(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 24) invalid();
  const result = value.map(collectionIndex); if (new Set(result).size !== result.length) invalid(); return result;
}
function tags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 24) invalid();
  const result = value.map(tag => text(tag, 128, 1).trim().normalize('NFC'));
  if (result.some(tag => !tag || /[\u0000-\u001f]/u.test(tag)) || new Set(result).size !== result.length) invalid();
  return result;
}
/** Model JSON addresses only indexes in host-frozen arrays; native item and collection keys are rejected. */
export function validateOrganizationProposal(value: unknown): OrganizationProposal {
  const proposal = record(value, ['itemIndex', 'tags', 'collectionIndexes']);
  const result = { itemIndex: itemIndex(proposal.itemIndex), tags: tags(proposal.tags), collectionIndexes: uniqueIndexes(proposal.collectionIndexes) };
  if (!result.tags.length && !result.collectionIndexes.length) invalid();
  return result;
}
export function parseOrganizationProposals(value: string): OrganizationProposal[] {
  text(value, 1024 * 1024, 2);
  let parsed: unknown; try { parsed = JSON.parse(value) as unknown; } catch { invalid(); }
  const result = record(parsed, ['candidates']);
  if (!Array.isArray(result.candidates) || !result.candidates.length || result.candidates.length > 50) invalid();
  const proposals = result.candidates.map(validateOrganizationProposal);
  if (new Set(proposals.map(proposal => proposal.itemIndex)).size !== proposals.length) invalid();
  return proposals;
}
/** Model geometry is normalized to the frozen crop; Zotero keys and native coordinates are rejected. */
export function validateFigureCalloutProposal(value: unknown): NativeFigureCalloutProposal {
  const proposal = record(value, ['box', 'strokes', 'explanation']);
  if (!Array.isArray(proposal.box) || proposal.box.length !== 4 || !proposal.box.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) invalid();
  const box = proposal.box as [number, number, number, number];
  if (box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01) invalid();
  if (!Array.isArray(proposal.strokes) || !proposal.strokes.length || proposal.strokes.length > 5) invalid();
  const strokes: Array<Array<[number, number]>> = proposal.strokes.map(raw => {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 64) invalid();
    return raw.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) invalid();
      return [point[0] as number, point[1] as number];
    });
  });
  const explanation = cleanAnnotationReason(text(proposal.explanation, 1200, 1).trim());
  if (!explanation) invalid();
  return { box: [...box] as [number, number, number, number], strokes, explanation };
}
export function parseFigureCalloutProposals(value: string): NativeFigureCalloutProposal[] {
  text(value, 256 * 1024, 2);
  let parsed: unknown; try { parsed = JSON.parse(value) as unknown; } catch { invalid(); }
  const result = record(parsed, ['callouts']);
  if (!Array.isArray(result.callouts) || !result.callouts.length || result.callouts.length > 5) invalid();
  return result.callouts.map(validateFigureCalloutProposal);
}
/**
 * The one domain constructor for a Citation built from a task-resolved annotation candidate. The
 * task controller resolved and froze the quote against a PDF version; a view must not re-derive the
 * page, rect or revision rules on its own (R4). It lives next to `parseAnnotationCandidates`, not in
 * `core/tasks`, so the chat path can call it without importing Agent orchestration.
 */
export function citationFromAnnotation(input: {
  paper: PaperScope;
  documentRevision: DocumentRevision;
  candidate: NativeAnnotationCandidate;
  title: string;
  clock: { uuid(): string; now(): string };
}): Citation {
  return validateCitation({
    id: input.clock.uuid(),
    paper: input.paper,
    title: input.title,
    authors: [],
    text: input.candidate.text,
    pageLabel: input.candidate.pageLabel,
    positions: [
      { pageIndex: input.candidate.position.pageIndex, rects: input.candidate.position.rects },
      ...(input.candidate.position.nextPageRects?.length ? [{ pageIndex: input.candidate.position.pageIndex + 1, rects: input.candidate.position.nextPageRects }] : []),
    ],
    capturedAt: input.clock.now(),
    contextScope: 'selection',
    documentRevision: input.documentRevision,
  });
}
/**
 * State of one durable native action task. The task controller owns the transition; a view only
 * projects it. `uncertain` means the write may or may not have landed and must be reconciled by its
 * reserved key, never blindly retried.
 */
export type ActionTaskState = 'preparing' | 'review' | 'running' | 'completed' | 'partial' | 'cancelled' | 'uncertain' | 'undone' | 'conflict' | 'failed';
export type ActionTaskItemStatus = 'candidate' | 'unresolved' | 'skipped' | 'writing' | 'applied' | 'metadata-only' | 'failed' | 'uncertain' | 'undoing' | 'undone' | 'conflict';
export type ActionTaskOperation = 'annotation-create' | 'figure-callout-create' | 'metadata-create' | 'metadata-fill' | 'child-note-create' | 'collection-add' | 'collection-create' | 'pdf-acquire' | 'annotation-delete' | 'figure-callout-delete' | 'collection-remove' | 'collection-trash' | 'item-trash' | 'attachment-trash' | 'organization-add' | 'organization-remove' | 'metadata-restore' | 'child-note-trash';
interface TaskItemBase {
  id: string;
  reservedKey: string;
  status: ActionTaskItemStatus;
  operation?: ActionTaskOperation;
  errorCode?: string;
  selected?: boolean;
}
export interface AnnotationTaskItem extends TaskItemBase {
  kind: 'annotation';
  proposal: AnnotationProposal;
  resolution?: NativeQuoteResolution;
  annotation?: NativeAnnotationSnapshot;
}
export interface AcquisitionTaskItem extends TaskItemBase {
  kind: 'acquisition';
  identifier: string;
  preview?: NativeMetadataPreview;
  duplicates: NativeItemSnapshot[];
  choice?: AcquisitionChoice;
  item?: NativeItemSnapshot;
  created?: boolean;
  collectionAddition?: NativeCollectionAddition;
  acquisition?: NativeAcquisitionResult;
  attachmentUndone?: true;
}
export interface OrganizationTaskItem extends TaskItemBase {
  kind: 'organization';
  sourceIndex: number;
  before: NativeOrganizationItemSnapshot;
  proposal: { tags: string[]; collections: NativeCollectionTarget[] };
  change?: NativeOrganizationChange;
}
export interface MetadataUpdateTaskItem extends TaskItemBase {
  kind: 'metadata-update';
  before: NativeItemSnapshot;
  preview: NativeMetadataPreview;
  fields: NativeMetadataFill;
  change?: NativeMetadataUpdateChange;
}
export interface ChildNoteTaskItem extends TaskItemBase {
  kind: 'child-note';
  parent: NativeItemSnapshot;
  /** Plain text from the model, never HTML or a Zotero identifier. */
  body: string;
  note?: NativeChildNoteSnapshot;
}
export interface FigureCalloutTaskItem extends TaskItemBase {
  kind: 'figure-callout';
  inkKey: string;
  proposal: NativeFigureCalloutProposal;
  callout?: NativeFigureCalloutSnapshot;
}
export interface CollectionCreateTaskItem extends TaskItemBase {
  kind: 'collection-create';
  target: NativeCollectionCreateTarget;
  name: string;
  collection?: NativeCollectionSnapshot;
}
/** Minimal safe Zotero rich-text note body with visible provenance; model text is never treated as HTML. */
export function childNoteHTML(value: string): string {
  const escape = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
  const paragraphs = value.trim().split(/\n\s*\n/u).map(part => `<p>${escape(part).replace(/\n/gu, '<br>')}</p>`).join('');
  return `<div data-zchatgpt-provenance=\"zotero-chatgpt\">${paragraphs}<p><em>Generated by Zotero ChatGPT Agent</em></p></div>`;
}
export interface AcquisitionChoice { metadataIndex?: number; duplicateKey?: string; downloadPDF?: boolean }
export type ActionTaskChoices = Record<string, AcquisitionChoice>;
interface ActionTaskBase {
  schemaVersion: 1;
  id: string;
  conversationId: string;
  question: string;
  state: ActionTaskState;
  createdAt: string;
  updatedAt: string;
  revision: number;
  approvedAt?: string;
  cancelRequested?: true;
}
export type ActionTaskRecord =
  | (ActionTaskBase & { kind: 'annotations'; paper: PaperScope; documentRevision: DocumentRevision; modelRequestId?: string; autoApply?: true; items: AnnotationTaskItem[] })
  | (ActionTaskBase & { kind: 'acquisition'; target: NativeCollectionTarget; items: AcquisitionTaskItem[] })
  | (ActionTaskBase & { kind: 'organization'; modelRequestId?: string; items: OrganizationTaskItem[] })
  | (ActionTaskBase & { kind: 'metadata-update'; items: MetadataUpdateTaskItem[] })
  | (ActionTaskBase & { kind: 'child-notes'; modelRequestId?: string; items: ChildNoteTaskItem[] })
  | (ActionTaskBase & { kind: 'figure-annotations'; modelRequestId?: string; selection: NativeFigureSelection; image: ImageAttachment; items: FigureCalloutTaskItem[] })
  | (ActionTaskBase & { kind: 'collection-create'; items: CollectionCreateTaskItem[] });
export interface AnnotationTaskPlan { conversationId: string; paper: PaperScope; revision: DocumentRevision; question: string; modelRequestId?: string; autoApply?: true; candidates: AnnotationProposal[] }
export interface AcquisitionTaskPlan { conversationId: string; target: NativeCollectionTarget; question: string; identifiers: string[] }
export interface OrganizationTaskPlan { conversationId: string; question: string; modelRequestId?: string; selection: NativeOrganizationItemSnapshot[]; collections: NativeCollectionTarget[]; proposals: OrganizationProposal[] }
export interface MetadataUpdateTaskPlan { conversationId: string; question: string; selection: NativeItemSnapshot[] }
export interface ChildNoteTaskPlan { conversationId: string; question: string; modelRequestId?: string; proposals: Array<{ parent: NativeItemSnapshot; body: string }> }
export interface CollectionCreateTaskPlan { conversationId: string; question: string; target: NativeCollectionCreateTarget; name: string }
export interface FigureAnnotationTaskPlan { conversationId: string; question: string; modelRequestId?: string; selection: NativeFigureSelection; image: ImageAttachment; proposals: NativeFigureCalloutProposal[] }
/** Durable action-task ledger surfaced to the UI; the implementation is `core/tasks`. */
export interface ActionTasks {
  list(conversationId?: string): Promise<ActionTaskRecord[]>;
  get(id: string): Promise<ActionTaskRecord>;
  subscribe(listener: (record: ActionTaskRecord) => void): () => void;
  planAnnotations(input: AnnotationTaskPlan): Promise<ActionTaskRecord>;
  planAcquisition(input: AcquisitionTaskPlan): Promise<ActionTaskRecord>;
  planOrganization(input: OrganizationTaskPlan): Promise<ActionTaskRecord>;
  planMetadataUpdate(input: MetadataUpdateTaskPlan): Promise<ActionTaskRecord>;
  planChildNotes(input: ChildNoteTaskPlan): Promise<ActionTaskRecord>;
  planCollectionCreate(input: CollectionCreateTaskPlan): Promise<ActionTaskRecord>;
  planFigureAnnotations(input: FigureAnnotationTaskPlan): Promise<ActionTaskRecord>;
  approve(id: string, selectedItemIds: string[], choices?: ActionTaskChoices): Promise<ActionTaskRecord>;
  cancel(id: string): Promise<ActionTaskRecord>;
  reconcile(id: string): Promise<ActionTaskRecord>;
  undo(id: string): Promise<ActionTaskRecord>;
}
