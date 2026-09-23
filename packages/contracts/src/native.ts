import type { DocumentRevision, ImageAttachment, PaperScope, Rect } from './index.ts';

/**
 * Contracts for the native Zotero boundary. Two directions are deliberately separate:
 *
 * - `NativeReaderPort` only reads (documents, items, annotations, metadata lookup).
 * - `NativeActionPort` extends it with the writes (annotations, items, collections, acquisition).
 *
 * Actions consume reads, never the other way round: the reader/chat product path never needs an
 * action, so it can be built against `NativeReaderPort` alone.
 */

/** All mutation keys and targets come from the trusted task controller, never model output. */
export interface NativeItemRef { clientId: string; libraryId: number; key: string }
export interface NativeCollectionTarget { clientId: string; libraryId: number; collectionKey: string }
/** A collection destination; null parent means a top-level collection in that library. */
export interface NativeCollectionCreateTarget { clientId: string; libraryId: number; parentCollectionKey: string | null }
export interface NativeCollectionSnapshot extends NativeCollectionTarget {
  name: string;
  parentKey: string | null;
  childItemKeys: string[];
  childCollectionKeys: string[];
  dateModified: string;
  contentSignature: string;
}
/** Persisted into real Zotero annotations; the historical product name stays literal. */
export const NATIVE_ANNOTATION_PROVENANCE = '[AI · Zotero ChatGPT]';
export interface NativeCollectionAddition { before: NativeItemSnapshot; after: NativeItemSnapshot; collectionKey: string; added: boolean }
/** Exact additive organization delta recorded after native readback. */
export interface NativeOrganizationChange {
  before: NativeOrganizationItemSnapshot;
  after: NativeOrganizationItemSnapshot;
  addedTags: string[];
  addedCollectionKeys: string[];
}
export interface NativeQuoteInput {
  paper: PaperScope;
  revision: DocumentRevision;
  quote: string;
  /** Physical zero-based PDF pages. Omission requests every page, subject to explicit limits. */
  pageIndexes?: number[];
}
export interface NativeAnnotationPosition { pageIndex: number; rects: Rect[]; nextPageRects?: Rect[] }
export interface NativeAnnotationCandidate {
  source: NativeQuoteInput;
  text: string;
  pageLabel: string;
  sortIndex: string;
  position: NativeAnnotationPosition;
}
export type NativeQuoteResolution =
  | { status: 'resolved'; candidate: NativeAnnotationCandidate }
  | { status: 'ambiguous'; matches: number }
  | { status: 'unresolved'; reason: 'not-found' | 'incomplete-text' | 'invalid-geometry' | 'range-required' | 'unsupported-span' };
export interface NativeAnnotationSnapshot {
  paper: PaperScope;
  key: string;
  type: 'highlight' | 'underline';
  text: string;
  comment: string;
  color: string;
  pageLabel: string;
  sortIndex: string;
  position: NativeAnnotationPosition;
  authorName: string;
  isExternal: boolean;
  tags: string[];
  dateModified: string;
}
export interface NativeAnnotationCreate {
  candidate: NativeAnnotationCandidate;
  key: string;
  type: 'highlight' | 'underline';
  color: string;
  comment: string;
  /** Existing output may only be returned when it still exactly matches this ledger snapshot. */
  reconcileWith?: NativeAnnotationSnapshot;
}
export type NativeAnnotationDeleteResult =
  | { status: 'deleted' | 'absent' }
  | { status: 'conflict'; current: NativeAnnotationSnapshot | null };

/** A region selected by the user; its rectangle is in native PDF points. */
export interface NativeFigureSelection { paper: PaperScope; revision: DocumentRevision; pageIndex: number; rect: Rect }
/** Model geometry is normalized to the selected crop; keys, PDF coordinates, and style stay host-owned. */
export interface NativeFigureCalloutProposal {
  box: [number, number, number, number];
  strokes: Array<Array<[number, number]>>;
  explanation: string;
}
export type NativeFigureAnnotationPosition =
  | { pageIndex: number; rects: [Rect] }
  | { pageIndex: number; paths: number[][]; width: number };
export interface NativeFigureAnnotationSnapshot {
  paper: PaperScope;
  key: string;
  type: 'image' | 'ink';
  comment: string;
  color: string;
  pageLabel: string;
  sortIndex: string;
  position: NativeFigureAnnotationPosition;
  authorName: string;
  isExternal: boolean;
  tags: string[];
  dateModified: string;
  /** SHA-256 of Zotero's cached image data URI, verified from `Annotations.toJSON()`. */
  imageSHA256: string;
}
export type NativeFigureAnnotationRecord = Omit<NativeFigureAnnotationSnapshot, 'imageSHA256'>;
export interface NativeFigureCalloutSnapshot {
  selection: NativeFigureSelection;
  image: NativeFigureAnnotationSnapshot;
  ink: NativeFigureAnnotationSnapshot;
}
export interface NativeFigureCalloutPrepared {
  selection: NativeFigureSelection;
  image: Omit<NativeFigureAnnotationSnapshot, 'dateModified'>;
  ink: Omit<NativeFigureAnnotationSnapshot, 'dateModified'>;
}
export interface NativeFigureCalloutInput {
  selection: NativeFigureSelection;
  image: ImageAttachment;
  proposal: NativeFigureCalloutProposal;
  index: number;
  imageKey: string;
  inkKey: string;
}
export type NativeFigureCalloutInspection =
  | { status: 'absent' }
  | { status: 'partial' | 'conflict' }
  | { status: 'complete'; callout: NativeFigureCalloutSnapshot };
export type NativeItemType = 'journalArticle' | 'conferencePaper' | 'preprint' | 'book' | 'bookSection' | 'report' | 'thesis' | 'webpage';
export interface NativeCreator { creatorType: 'author' | 'editor'; firstName?: string; lastName?: string; name?: string }
/** A bounded metadata allowlist. This cannot carry notes, tags, relations, paths or permissions. */
export interface NativeMetadata {
  itemType: NativeItemType;
  title: string;
  creators: NativeCreator[];
  DOI?: string;
  url?: string;
  date?: string;
  publicationTitle?: string;
  bookTitle?: string;
  conferenceName?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  ISBN?: string;
  abstractNote?: string;
  language?: string;
}
export interface NativeMetadataPreview {
  identifier: string;
  source: 'identifier' | 'web';
  candidates: NativeMetadata[];
}
/** Scalar bibliographic fields that may be filled on an existing item. Creators/type are excluded. */
export type NativeMetadataFill = Partial<Pick<NativeMetadata, 'title' | 'DOI' | 'url' | 'date' | 'publicationTitle' | 'bookTitle' | 'conferenceName' | 'volume' | 'issue' | 'pages' | 'publisher' | 'place' | 'ISBN' | 'abstractNote' | 'language'>>;
export interface NativeItemSnapshot extends NativeItemRef {
  metadata: NativeMetadata;
  collectionKeys: string[];
  attachmentKeys: string[];
  dateModified: string;
  /** Canonical full native item JSON, used only to detect subsequent edits; never a model input. */
  contentSignature: string;
}
export interface NativeMetadataUpdateChange { before: NativeItemSnapshot; after: NativeItemSnapshot; fields: NativeMetadataFill }
/** Readback snapshot of one task-created Zotero child note. `body` is native Zotero note HTML. */
export interface NativeChildNoteSnapshot extends NativeItemRef { parentKey: string; body: string; contentSignature: string }
/** Rich item state used only for additive organization and its exact readback/undo. */
export interface NativeOrganizationItemSnapshot extends NativeItemSnapshot {
  tags: string[];
  /** Full native JSON with tags, collections and host-maintained timestamps removed. */
  organizationSignature: string;
}
export interface NativeAttachmentSnapshot extends NativeItemRef {
  parentKey: string;
  url: string;
  contentType: 'application/pdf';
  sha256: string;
  contentSignature: string;
}
export type NativeAcquisitionResult =
  | { status: 'attached'; attachment: NativeAttachmentSnapshot; articleVersion: string; checkedPages: number; totalPages: number }
  | { status: 'unavailable' | 'uncertain'; reason: 'no-doi' | 'no-oa-candidate' | 'existing-pdf' | 'download-failed' | 'file-type-mismatch' | 'identity-unconfirmed' | 'supplementary' | 'file-too-large' };

/**
 * Read-only native Zotero boundary. Stateless: no approval, durable intent or scheduling lives here.
 * A reader/chat build that never writes Zotero only needs this port.
 */
export interface NativeReaderPort {
  resolveQuote(input: NativeQuoteInput, signal?: AbortSignal): Promise<NativeQuoteResolution>;
  inspectAnnotation(input: { paper: PaperScope; key: string }, signal?: AbortSignal): Promise<NativeAnnotationSnapshot | null>;
  inspectFigureCallout(input: NativeFigureCalloutInput, signal?: AbortSignal): Promise<NativeFigureCalloutInspection>;
  previewMetadata(input: { identifier: string }, signal?: AbortSignal): Promise<NativeMetadataPreview>;
  findDuplicateDOI(input: { clientId: string; libraryId: number; doi: string }, signal?: AbortSignal): Promise<NativeItemSnapshot[]>;
  inspectItem(input: NativeItemRef, signal?: AbortSignal): Promise<NativeItemSnapshot | null>;
  inspectCollection(input: NativeCollectionTarget, signal?: AbortSignal): Promise<NativeCollectionSnapshot | null>;
  inspectChildNote(input: NativeItemRef & { parentKey: string }, signal?: AbortSignal): Promise<NativeChildNoteSnapshot | null>;
  inspectOrganizationItem(input: NativeItemRef, signal?: AbortSignal): Promise<NativeOrganizationItemSnapshot | null>;
  inspectAttachment(input: NativeItemRef, signal?: AbortSignal): Promise<NativeAttachmentSnapshot | null>;
}

/**
 * Native write boundary. It extends the read port because every action first re-reads and re-checks
 * the exact state it is about to change. Approval, durable intent, reconciliation and batch
 * scheduling live above it, in `core/tasks`.
 */
export interface NativeActionPort extends NativeReaderPort {
  createAnnotation(input: NativeAnnotationCreate, signal?: AbortSignal): Promise<NativeAnnotationSnapshot>;
  deleteAnnotation(input: { expected: NativeAnnotationSnapshot }, signal?: AbortSignal): Promise<NativeAnnotationDeleteResult>;
  createFigureCallout(input: NativeFigureCalloutInput, signal?: AbortSignal): Promise<NativeFigureCalloutSnapshot>;
  deleteFigureCallout(input: { expected: NativeFigureCalloutSnapshot }, signal?: AbortSignal): Promise<{ status: 'deleted' | 'absent' | 'conflict' }>;
  createItem(input: { target: NativeCollectionTarget; key: string; metadata: NativeMetadata }, signal?: AbortSignal): Promise<NativeItemSnapshot>;
  createCollection(input: { target: NativeCollectionCreateTarget; key: string; name: string }, signal?: AbortSignal): Promise<NativeCollectionSnapshot>;
  undoCreatedCollection(input: { expected: NativeCollectionSnapshot }, signal?: AbortSignal): Promise<{ status: 'trashed' | 'absent' | 'conflict' }>;
  fillMissingMetadata(input: { expected: NativeItemSnapshot; fields: NativeMetadataFill }, signal?: AbortSignal): Promise<NativeMetadataUpdateChange>;
  undoMetadataFill(input: { expected: NativeMetadataUpdateChange }, signal?: AbortSignal): Promise<{ status: 'removed' | 'absent' | 'conflict' }>;
  createChildNote(input: { parent: NativeItemSnapshot; key: string; body: string }, signal?: AbortSignal): Promise<NativeChildNoteSnapshot>;
  undoChildNote(input: { expected: NativeChildNoteSnapshot }, signal?: AbortSignal): Promise<{ status: 'trashed' | 'absent' | 'conflict' }>;
  addItemToCollection(input: { expected: NativeItemSnapshot; target: NativeCollectionTarget }, signal?: AbortSignal): Promise<NativeCollectionAddition>;
  undoCollectionAddition(input: { expected: NativeCollectionAddition }, signal?: AbortSignal): Promise<{ status: 'removed' | 'absent' | 'conflict' }>;
  organizeItem(input: { expected: NativeOrganizationItemSnapshot; tags: string[]; collections: NativeCollectionTarget[] }, signal?: AbortSignal): Promise<NativeOrganizationChange>;
  undoOrganization(input: { expected: NativeOrganizationChange }, signal?: AbortSignal): Promise<{ status: 'removed' | 'absent' | 'conflict'; after?: NativeOrganizationItemSnapshot }>;
  undoCreatedItem(input: { expected: NativeItemSnapshot; attachments: NativeAttachmentSnapshot[] }, signal?: AbortSignal): Promise<{ status: 'trashed' | 'absent' | 'conflict' }>;
  undoAttachment(input: { expected: NativeAttachmentSnapshot }, signal?: AbortSignal): Promise<{ status: 'trashed' | 'absent' | 'conflict' }>;
  acquireOpenAccessPDF(input: { item: NativeItemSnapshot }, signal?: AbortSignal): Promise<NativeAcquisitionResult>;
}
export type NativeOperationErrorCode = 'INVALID_INPUT' | 'SOURCE_CHANGED' | 'NOT_FOUND' | 'NOT_EDITABLE' | 'CONFLICT' | 'CANCELLED' | 'UNAVAILABLE' | 'WRITE_UNCERTAIN';
export class NativeOperationError extends Error {
  constructor(readonly code: NativeOperationErrorCode, message: string) { super(message); this.name = 'NativeOperationError'; }
}
