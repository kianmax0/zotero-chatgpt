import { clone } from '../../../contracts/src/clone.ts';
import { NATIVE_ANNOTATION_PROVENANCE, type NativeAcquisitionResult, type NativeActionPort, type NativeChildNoteSnapshot, type NativeCollectionSnapshot, type NativeFigureCalloutInput, type NativeMetadataFill, type NativeMetadataUpdateChange, type NativeReaderPort } from '../../../contracts/src/native.ts';
import { childNoteHTML as renderChildNoteHTML } from '../../../contracts/src/tasks.ts';
import { boundary, checkSignal, createNativeSupport, equal, fail, key, normalizedTitle, object, publicURL, string, waitRead, type NativeSupport, type NativeSupportOptions } from '../library/native-support.ts';
import { createNativeReaderPort, nativeCollectionSnapshot } from '../library/native-read.ts';

const AI_PREFIX = NATIVE_ANNOTATION_PROVENANCE;
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_ORGANIZATION_VALUES = 24;

function organizationTags(value: unknown, max = MAX_ORGANIZATION_VALUES): string[] {
  if (!Array.isArray(value) || value.length > max) fail('INVALID_INPUT', `Choose at most ${max} tags for one item.`);
  const result = value.map(raw => string(raw, 128).trim().normalize('NFC'));
  if (result.some(tag => !tag || /[\u0000-\u001f]/u.test(tag)) || new Set(result).size !== result.length) fail('INVALID_INPUT', 'Choose unique nonempty Zotero tags.');
  return result;
}
const FILL_FIELDS = ['title', 'DOI', 'url', 'date', 'publicationTitle', 'bookTitle', 'conferenceName', 'volume', 'issue', 'pages', 'publisher', 'place', 'ISBN', 'abstractNote', 'language'] as const;
function metadataFill(value: unknown, cleanDOI: (value: string) => string): NativeMetadataFill {
  const raw = object(value); if (!Object.keys(raw).length || Object.keys(raw).some(name => !(FILL_FIELDS as readonly string[]).includes(name))) fail('INVALID_INPUT', 'Only allowlisted bibliographic fields can be filled.');
  const result: NativeMetadataFill = {};
  for (const field of FILL_FIELDS) {
    const value = raw[field]; if (value === undefined) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > (field === 'abstractNote' ? 32768 : 8192)) fail('INVALID_INPUT', 'Metadata field value is invalid.');
    if (field === 'DOI') { const doi = cleanDOI(value); if (!doi) fail('INVALID_INPUT', 'Metadata DOI is invalid.'); result.DOI = doi; }
    else if (field === 'url') { const url = publicURL(value); if (!url) fail('INVALID_INPUT', 'Metadata URL is invalid.'); result.url = url; }
    else result[field] = value.trim();
  }
  return result;
}
function childNoteHTML(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 24000 || value.includes('\0')) fail('INVALID_INPUT', 'The note text is empty or too long.');
  return renderChildNoteHTML(value);
}
function collectionName(value: unknown): string {
  if (typeof value !== 'string') fail('INVALID_INPUT', 'Enter a collection name.');
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 128 || /[\u0000-\u001f]/u.test(name)) fail('INVALID_INPUT', 'The collection name is empty or invalid.');
  return name;
}
function imageBlob(value: unknown): Blob {
  const image = object(value); const dataUrl = string(image.dataUrl, 3 * 1024 * 1024);
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (image.mime !== 'image/png' || !match) fail('INVALID_INPUT', 'Figure annotation images must be verified PNG data.');
  const encoded = atob(match[1]!); const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
  const buffer = new ArrayBuffer(bytes.length); new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'image/png' });
}

/**
 * Native Zotero writes: annotations, metadata items, collection membership and open-access
 * acquisition, each with its exact-snapshot undo. The layer reads through `NativeReaderPort` — every
 * write re-checks the state it is about to change — and owns no approval or ledger state; the task
 * controller in `core/tasks` decides what may run.
 */
export function createNativeActionPort(support: NativeSupport, reader: NativeReaderPort): NativeActionPort {
  const { z } = support;
  return {
    ...reader,
    createAnnotation: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); key(input.key); const attachment = support.paper(input.candidate.source.paper);
      if (!attachment.isEditable()) fail('NOT_EDITABLE', 'The task PDF does not allow annotation writes.');
      if (!['highlight', 'underline'].includes(input.type) || !/^#[0-9a-f]{6}$/u.test(input.color)) fail('INVALID_INPUT', 'Choose a valid native annotation style.');
      const comment = `${AI_PREFIX}${input.comment ? '\n' + string(input.comment, 8000) : ''}`;
      const existing = z.Items.getByLibraryAndKey(attachment.libraryID, input.key);
      if (existing) {
        const current = await reader.inspectAnnotation({ paper: input.candidate.source.paper, key: input.key });
        if (input.reconcileWith && current && equal(current, input.reconcileWith) && current.type === input.type && current.color === input.color && current.comment === comment && current.text === input.candidate.text && equal(current.position, input.candidate.position)) return current;
        fail('CONFLICT', 'The reserved annotation key is already in use.');
      }
      if (input.reconcileWith) fail('CONFLICT', 'The earlier annotation output is missing; it was not recreated.');
      const resolved = await reader.resolveQuote(input.candidate.source, signal);
      if (resolved.status !== 'resolved' || !equal(resolved.candidate, input.candidate)) fail('CONFLICT', 'The proposed annotation no longer matches the PDF.');
      checkSignal(signal);
      if (z.Items.getByLibraryAndKey(attachment.libraryID, input.key)) fail('CONFLICT', 'The reserved annotation key is already in use.');
      try {
        // saveFromJSON owns saveTx. An outer executeTransaction would deadlock in Zotero 9.0.6.
        const saved = await z.Annotations.saveFromJSON(attachment, { key: input.key, type: input.type, text: resolved.candidate.text, comment, color: input.color, pageLabel: resolved.candidate.pageLabel, sortIndex: resolved.candidate.sortIndex, position: resolved.candidate.position, isExternal: false, tags: [] }, { skipSelect: true });
        const snapshot = support.annotationSnapshot(input.candidate.source.paper, saved); if (snapshot) return snapshot;
      } catch { /* A DB commit may precede a notifier failure. Reconcile by the reserved key. */ }
      fail('WRITE_UNCERTAIN', 'Annotation save was not confirmed. Reconcile its reserved key before retrying.');
    }),
    createFigureCallout: (value: NativeFigureCalloutInput, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); const prepared = await support.prepareFigureCallout(input, signal); const attachment = support.paper(prepared.selection.paper);
      if (!attachment.isEditable() || !z.Libraries.get(attachment.libraryID)?.editable) fail('NOT_EDITABLE', 'The selected PDF does not allow figure annotation writes.');
      if (z.Items.getByLibraryAndKey(attachment.libraryID, input.imageKey) || z.Items.getByLibraryAndKey(attachment.libraryID, input.inkKey)) fail('CONFLICT', 'A reserved figure annotation key is already in use.');
      const crop = imageBlob(input.image); checkSignal(signal);
      let writeStarted = false;
      try {
        // Zotero's saveFromJSON owns saveTx; its image cache is a separate, required sidecar write.
        writeStarted = true;
        const area = await z.Annotations.saveFromJSON(attachment, { ...prepared.image, tags: [] }, { skipSelect: true });
        await z.Annotations.saveCacheImage(area, crop);
        const savedArea = await support.figureAnnotationSnapshot(prepared.selection.paper, area);
        if (!savedArea) fail('WRITE_UNCERTAIN', 'The Zotero figure area was saved but its cached image could not be read back.');
        const savedAreaRecord = support.figureAnnotationRecord(prepared.selection.paper, area);
        const savedAreaFields: Record<string, unknown> = savedAreaRecord ? { ...savedAreaRecord } : {};
        delete savedAreaFields.dateModified;
        const expectedAreaRecord: Record<string, unknown> = { ...prepared.image }; delete expectedAreaRecord.dateModified; delete expectedAreaRecord.imageSHA256;
        if (!savedAreaRecord || !equal(savedAreaFields, expectedAreaRecord)) fail('WRITE_UNCERTAIN', 'The Zotero figure area was saved but its native record did not match.');
        const ink = await z.Annotations.saveFromJSON(attachment, { ...prepared.ink, tags: [] }, { skipSelect: true });
        await z.Annotations.saveCacheImage(ink, crop);
        const inspection = await reader.inspectFigureCallout(input, signal);
        if (inspection.status !== 'complete') fail('WRITE_UNCERTAIN', 'The Zotero figure callout pair could not be read back exactly.');
        return inspection.callout;
      } catch (error) {
        if (writeStarted) fail('WRITE_UNCERTAIN', 'A figure callout write may have partially completed; reconcile both reserved keys before retrying.');
        throw error;
      }
    }),
    deleteAnnotation: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); support.paper(expected.paper); key(expected.key);
      return z.DB.executeTransaction(async () => {
        checkSignal(signal); const item = z.Items.getByLibraryAndKey(expected.paper.libraryId, expected.key); if (!item) return { status: 'absent' };
        await item.loadAllData?.(); checkSignal(signal);
        const current = support.annotationSnapshot(expected.paper, item);
        if (!current || current.isExternal || !current.comment.startsWith(AI_PREFIX) || !item.isEditable() || !equal(current, expected)) return { status: 'conflict', current };
        try { await item.erase(); } catch { fail('WRITE_UNCERTAIN', 'Annotation removal was not confirmed. Reconcile its key before retrying.'); }
        return { status: 'deleted' };
      });
    }),
    deleteFigureCallout: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); const attachment = support.paper(expected.selection.paper);
      key(expected.image.key); key(expected.ink.key);
      if (expected.image.key === expected.ink.key || expected.image.type !== 'image' || expected.ink.type !== 'ink' || !expected.image.comment.startsWith(AI_PREFIX) || !expected.ink.comment.startsWith(AI_PREFIX)) fail('INVALID_INPUT', 'The recorded figure callout identity is inconsistent.');
      const imageItem = z.Items.getByLibraryAndKey(attachment.libraryID, expected.image.key);
      const inkItem = z.Items.getByLibraryAndKey(attachment.libraryID, expected.ink.key);
      if (!imageItem && !inkItem) return { status: 'absent' };
      if (!imageItem || !inkItem || !attachment.isEditable() || !z.Libraries.get(attachment.libraryID)?.editable) return { status: 'conflict' };
      await imageItem.loadAllData?.(); await inkItem.loadAllData?.(); checkSignal(signal);
      const [imageSnapshot, inkSnapshot] = await Promise.all([
        support.figureAnnotationSnapshot(expected.selection.paper, imageItem),
        support.figureAnnotationSnapshot(expected.selection.paper, inkItem),
      ]);
      const imageRecord = support.figureAnnotationRecord(expected.selection.paper, imageItem);
      const inkRecord = support.figureAnnotationRecord(expected.selection.paper, inkItem);
      const expectedImageRecord: Record<string, unknown> = { ...expected.image }; delete expectedImageRecord.imageSHA256;
      const expectedInkRecord: Record<string, unknown> = { ...expected.ink }; delete expectedInkRecord.imageSHA256;
      if (!imageSnapshot || !inkSnapshot || !imageRecord || !inkRecord || !equal(imageRecord, expectedImageRecord) || !equal(inkRecord, expectedInkRecord)) return { status: 'conflict' };
      const transactionResult: { status: 'deleted' | 'conflict' } = { status: 'deleted' };
      try {
        await z.DB.executeTransaction(async () => {
          checkSignal(signal);
          const currentImage = z.Items.getByLibraryAndKey(attachment.libraryID, expected.image.key);
          const currentInk = z.Items.getByLibraryAndKey(attachment.libraryID, expected.ink.key);
          if (!currentImage || !currentInk) { transactionResult.status = 'conflict'; return; }
          await currentImage.loadAllData?.(); await currentInk.loadAllData?.(); checkSignal(signal);
          const imageRecord = support.figureAnnotationRecord(expected.selection.paper, currentImage);
          const inkRecord = support.figureAnnotationRecord(expected.selection.paper, currentInk);
          const expectedImageRecord: Record<string, unknown> = { ...expected.image }; delete expectedImageRecord.imageSHA256;
          const expectedInkRecord: Record<string, unknown> = { ...expected.ink }; delete expectedInkRecord.imageSHA256;
          if (!imageRecord || !inkRecord || !equal(imageRecord, expectedImageRecord) || !equal(inkRecord, expectedInkRecord) || !currentImage.isEditable() || !currentInk.isEditable()) { transactionResult.status = 'conflict'; return; }
          await currentImage.erase(); await currentInk.erase();
        });
      } catch {
        fail('WRITE_UNCERTAIN', 'Figure annotation removal was not confirmed. Reconcile before retrying.');
      }
      if (transactionResult.status === 'conflict') return { status: 'conflict' };
      const remaining = z.Items.getByLibraryAndKey(attachment.libraryID, expected.image.key) || z.Items.getByLibraryAndKey(attachment.libraryID, expected.ink.key);
      if (remaining) fail('WRITE_UNCERTAIN', 'Figure annotation removal was not confirmed. Reconcile before retrying.');
      // Zotero 9.0.6 stores cached annotation PNGs outside the item transaction. Records are the
      // authoritative output; remove their derived cache files best-effort after the atomic erase.
      await Promise.allSettled([
        z.Annotations.removeCacheImage({ libraryID: attachment.libraryID, key: expected.image.key }),
        z.Annotations.removeCacheImage({ libraryID: attachment.libraryID, key: expected.ink.key }),
      ]);
      return { status: 'deleted' };
    }),
    createItem: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); support.scope(input.target); key(input.key); key(input.target.collectionKey);
      const metadata = support.readMetadata(input.metadata, true);
      return z.DB.executeTransaction(async () => {
        checkSignal(signal);
        const collection = z.Collections.getByLibraryAndKey(input.target.libraryId, input.target.collectionKey);
        if (!collection || collection.deleted || collection.libraryID !== input.target.libraryId) fail('NOT_FOUND', 'The approved target collection is no longer available.');
        if (!collection.isEditable() || !z.Libraries.get(input.target.libraryId)?.editable) fail('NOT_EDITABLE', 'The approved target collection is read-only.');
        if (z.Items.getByLibraryAndKey(input.target.libraryId, input.key)) fail('CONFLICT', 'The reserved item key is already in use.');
        if (metadata.DOI && (await reader.findDuplicateDOI({ ...input.target, doi: metadata.DOI }, signal)).length) fail('CONFLICT', 'An item with this DOI already exists in the target library.');
        checkSignal(signal);
        const item = new z.Item(metadata.itemType); item.libraryID = input.target.libraryId; item.key = input.key; await item.loadPrimaryData(); checkSignal(signal); item.fromJSON(metadata); item.addToCollection(input.target.collectionKey);
        try { await item.save({ skipSelect: true }); return support.itemSnapshot(item); }
        catch { fail('WRITE_UNCERTAIN', 'Metadata save was not confirmed. Reconcile the reserved key before retrying.'); }
      });
    }),
    createCollection: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); support.scope(input.target); key(input.key); const name = collectionName(input.name);
      const targetParent = input.target.parentCollectionKey;
      if (targetParent !== null) key(targetParent);
      try {
        await z.DB.executeTransaction(async () => {
          checkSignal(signal);
          const library = z.Libraries.get(input.target.libraryId);
          if (!library?.editable) fail('NOT_EDITABLE', 'The Zotero library is read-only.');
          const parent = targetParent === null ? null : z.Collections.getByLibraryAndKey(input.target.libraryId, targetParent);
          if (targetParent !== null && (!parent || parent.deleted || parent.libraryID !== input.target.libraryId)) fail('NOT_FOUND', 'The selected parent collection is no longer available.');
          if (parent && !parent.isEditable()) fail('NOT_EDITABLE', 'The selected parent collection is read-only.');
          if (z.Collections.getByLibraryAndKey(input.target.libraryId, input.key)) fail('CONFLICT', 'The reserved collection key is already in use.');
          const siblings = parent
            ? (await parent.loadDataType('childCollections'), parent.getChildCollections(false, true))
            : z.Collections.getByLibrary(input.target.libraryId, false, true);
          if (siblings.some(value => { const sibling = typeof value === 'number' ? z.Collections.get(value) : value; return !!sibling && !sibling.deleted && sibling.name.trim().normalize('NFC').toLocaleLowerCase() === name.toLocaleLowerCase(); })) fail('CONFLICT', 'A collection with this name already exists at the selected level.');
          const collection = new z.Collection(); collection.libraryID = input.target.libraryId; collection.key = input.key; collection.name = name; collection.parentKey = targetParent || false;
          try { await collection.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'The new Zotero collection was not confirmed. Reconcile its reserved key before retrying.'); }
        });
      } catch (error) {
        if (isNativeOperationError(error) && ['CANCELLED', 'CONFLICT', 'NOT_FOUND', 'NOT_EDITABLE'].includes(error.code)) throw error;
        if (isNativeOperationError(error) && error.code === 'WRITE_UNCERTAIN') throw error;
        fail('WRITE_UNCERTAIN', 'The new Zotero collection was not confirmed. Reconcile its reserved key before retrying.');
      }
      const saved = await reader.inspectCollection({ clientId: input.target.clientId, libraryId: input.target.libraryId, collectionKey: input.key }, signal);
      if (!saved || saved.name !== name || saved.parentKey !== targetParent || saved.childItemKeys.length || saved.childCollectionKeys.length) fail('WRITE_UNCERTAIN', 'The new Zotero collection could not be verified after saving.');
      return saved satisfies NativeCollectionSnapshot;
    }),
    undoCreatedCollection: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); support.scope(expected); key(expected.collectionKey);
      const current = await reader.inspectCollection(expected, signal); if (!current) return { status: 'absent' };
      if (!equal(current, expected) || current.childItemKeys.length || current.childCollectionKeys.length) return { status: 'conflict' };
      const collection = z.Collections.getByLibraryAndKey(expected.libraryId, expected.collectionKey); if (!collection || collection.deleted || !collection.isEditable() || !z.Libraries.get(expected.libraryId)?.editable) return { status: 'conflict' };
      return z.DB.executeTransaction(async () => {
        await collection.loadDataType('primaryData'); await collection.loadDataType('childItems'); await collection.loadDataType('childCollections'); checkSignal(signal);
        if (collection.deleted || !equal(nativeCollectionSnapshot(support, collection), expected) || collection.getChildItems(true, true).length || collection.getChildCollections(true, true).length) return { status: 'conflict' };
        collection.deleted = true;
        try { await collection.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'The new collection was not moved to the Zotero trash.'); }
        return { status: 'trashed' };
      });
    }),
    fillMissingMetadata: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); support.scope(input.expected); key(input.expected.key);
      const fields = metadataFill(input.fields, value => support.cleanDOI(value));
      return z.DB.executeTransaction(async () => {
        const item = support.getItem(input.expected); if (!item) fail('NOT_FOUND', 'The selected Zotero item is no longer available.');
        await item.loadAllData?.(); checkSignal(signal); const before = support.itemSnapshot(item);
        if (!equal(before, input.expected)) fail('CONFLICT', 'The selected Zotero item changed after the metadata preview.');
        if (!item.isEditable() || !z.Libraries.get(item.libraryID)?.editable) fail('NOT_EDITABLE', 'The selected Zotero item is read-only.');
        for (const field of Object.keys(fields) as Array<keyof NativeMetadataFill>) {
          const current = before.metadata[field];
          if (typeof current === 'string' && current.trim()) fail('CONFLICT', 'A bibliographic field is no longer blank.');
          if (field === 'DOI' && before.metadata.DOI && support.cleanDOI(before.metadata.DOI) !== fields.DOI) fail('CONFLICT', 'The item DOI changed after the metadata preview.');
        }
        for (const [field, fieldValue] of Object.entries(fields)) item.setField(field, fieldValue);
        try { await item.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Metadata changes were not confirmed. Reconcile the item before retrying.'); }
        const after = support.itemSnapshot(item);
        for (const [field, fieldValue] of Object.entries(fields)) if (after.metadata[field as keyof typeof after.metadata] !== fieldValue) fail('WRITE_UNCERTAIN', 'Metadata changes could not be verified after saving.');
        if (!equal(after.collectionKeys, before.collectionKeys) || !equal(after.attachmentKeys, before.attachmentKeys)) fail('WRITE_UNCERTAIN', 'The item changed outside the approved metadata fields.');
        return { before, after, fields } satisfies NativeMetadataUpdateChange;
      });
    }),
    undoMetadataFill: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); support.scope(expected.after); support.scope(expected.before);
      if (expected.before.key !== expected.after.key || expected.before.clientId !== expected.after.clientId || expected.before.libraryId !== expected.after.libraryId) fail('INVALID_INPUT', 'The metadata task item identity is inconsistent.');
      const fields = metadataFill(expected.fields, value => support.cleanDOI(value));
      return z.DB.executeTransaction(async () => {
        const item = support.getItem(expected.after); if (!item) return { status: 'absent' };
        await item.loadAllData?.(); checkSignal(signal); const current = support.itemSnapshot(item);
        if (!equal(current, expected.after) || !item.isEditable()) return { status: 'conflict' };
        for (const field of Object.keys(fields) as Array<keyof NativeMetadataFill>) item.setField(field, expected.before.metadata[field] ?? '');
        try { await item.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Metadata restoration was not confirmed.'); }
        const after = support.itemSnapshot(item);
        if (!equal(after.metadata, expected.before.metadata) || !equal(after.collectionKeys, expected.before.collectionKeys) || !equal(after.attachmentKeys, expected.before.attachmentKeys)) fail('WRITE_UNCERTAIN', 'Metadata restoration could not be verified.');
        return { status: 'removed' };
      });
    }),
    createChildNote: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); support.scope(input.parent); key(input.parent.key); key(input.key);
      const html = childNoteHTML(input.body);
      try {
        await z.DB.executeTransaction(async () => {
          checkSignal(signal);
          const existing = z.Items.getByLibraryAndKey(input.parent.libraryId, input.key); if (existing) fail('CONFLICT', 'The reserved child-note key is already in use.');
          const parent = support.getItem(input.parent); if (!parent) fail('NOT_FOUND', 'The selected Zotero item is no longer available.');
          await parent.loadAllData?.(); checkSignal(signal);
          if (!equal(support.itemSnapshot(parent), input.parent)) fail('CONFLICT', 'The selected Zotero item changed after the note preview.');
          if (!parent.isEditable() || !z.Libraries.get(parent.libraryID)?.editable) fail('NOT_EDITABLE', 'The selected Zotero item is read-only.');
          const note = new z.Item('note'); note.libraryID = parent.libraryID; note.parentID = parent.id; note.key = input.key; note.setNote(html);
          await note.save({ skipSelect: true });
        });
      } catch (error) {
        if (isNativeOperationError(error) && ['CANCELLED', 'CONFLICT', 'NOT_FOUND', 'NOT_EDITABLE'].includes(error.code)) throw error;
        fail('WRITE_UNCERTAIN', 'The child note was not confirmed. Reconcile its reserved key before retrying.');
      }
      const saved = await reader.inspectChildNote({ clientId: support.clientId, libraryId: input.parent.libraryId, key: input.key, parentKey: input.parent.key }, signal);
      if (!saved || saved.body !== html || !saved.body.includes('data-zchatgpt-provenance="zotero-chatgpt"')) fail('WRITE_UNCERTAIN', 'The child note could not be verified after saving.');
      return saved satisfies NativeChildNoteSnapshot;
    }),
    undoChildNote: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); support.scope(expected); key(expected.key); key(expected.parentKey);
      const current = await reader.inspectChildNote({ clientId: expected.clientId, libraryId: expected.libraryId, key: expected.key, parentKey: expected.parentKey }, signal);
      if (!current) return { status: 'absent' };
      if (!equal(current, expected) || !current.body.includes('data-zchatgpt-provenance="zotero-chatgpt"')) return { status: 'conflict' };
      const note = z.Items.getByLibraryAndKey(expected.libraryId, expected.key); if (!note || !note.isEditable()) return { status: 'conflict' };
      return z.DB.executeTransaction(async () => {
        await note.loadAllData?.(); checkSignal(signal);
        if (note.deleted || note.itemType !== 'note' || note.getNote() !== expected.body || support.contentSignature(note) !== expected.contentSignature) return { status: 'conflict' };
        note.deleted = true;
        try { await note.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'The generated note was not moved to trash.'); }
        if (await reader.inspectChildNote({ clientId: expected.clientId, libraryId: expected.libraryId, key: expected.key, parentKey: expected.parentKey }, signal)) fail('WRITE_UNCERTAIN', 'The generated note remains after undo.');
        return { status: 'trashed' };
      });
    }),
    addItemToCollection: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); support.scope(input.target); key(input.target.collectionKey);
      if (input.target.clientId !== input.expected.clientId || input.target.libraryId !== input.expected.libraryId) fail('INVALID_INPUT', 'An existing item cannot be moved across libraries by this task.');
      return z.DB.executeTransaction(async () => {
        const item = support.getItem(input.expected); const collection = z.Collections.getByLibraryAndKey(input.target.libraryId, input.target.collectionKey);
        if (!item || !collection || collection.deleted) fail('NOT_FOUND', 'The existing item or target collection is unavailable.');
        await item.loadAllData?.(); checkSignal(signal);
        const before = support.itemSnapshot(item);
        if (!equal(before, input.expected)) fail('CONFLICT', 'The existing item changed before collection assignment.');
        if (!item.isEditable() || !collection.isEditable()) fail('NOT_EDITABLE', 'The existing item or target collection is read-only.');
        if (before.collectionKeys.includes(collection.key)) return { before, after: before, collectionKey: collection.key, added: false };
        item.addToCollection(collection.key);
        try { await item.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Collection assignment was not confirmed. Inspect the item before retrying.'); }
        return { before, after: support.itemSnapshot(item), collectionKey: collection.key, added: true };
      });
    }),
    undoCollectionAddition: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); key(expected.collectionKey);
      return z.DB.executeTransaction(async () => {
        const item = support.getItem(expected.after); if (!item || !expected.added) return { status: 'absent' };
        await item.loadAllData?.(); checkSignal(signal); const current = support.itemSnapshot(item);
        if (!current.collectionKeys.includes(expected.collectionKey)) return { status: 'absent' };
        if (!item.isEditable() || !equal(current, expected.after)) return { status: 'conflict' };
        item.removeFromCollection(expected.collectionKey);
        try { await item.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Collection removal was not confirmed. Inspect the item before retrying.'); }
        return { status: 'removed' };
      });
    }),
    organizeItem: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); support.scope(input.expected);
      const tags = organizationTags(input.tags);
      if (!Array.isArray(input.collections) || input.collections.length > MAX_ORGANIZATION_VALUES) fail('INVALID_INPUT', 'Choose at most 24 collections for one item.');
      const targets = input.collections.map(target => { support.scope(target); key(target.collectionKey); if (target.libraryId !== input.expected.libraryId || target.clientId !== input.expected.clientId) fail('INVALID_INPUT', 'An item cannot be organized across Zotero libraries.'); return target; });
      if (new Set(targets.map(target => target.collectionKey)).size !== targets.length) fail('INVALID_INPUT', 'Choose unique target collections.');
      return z.DB.executeTransaction(async () => {
        const item = support.getItem(input.expected); if (!item) fail('NOT_FOUND', 'The selected Zotero item is no longer available.');
        await item.loadAllData?.(); checkSignal(signal); const current = support.organizationItemSnapshot(item);
        const addedTags = tags.filter(tag => !input.expected.tags.includes(tag));
        const addedCollectionKeys = targets.map(target => target.collectionKey).filter(collectionKey => !input.expected.collectionKeys.includes(collectionKey));
        const desiredTags = [...new Set([...input.expected.tags, ...tags])].sort();
        const desiredCollections = [...new Set([...input.expected.collectionKeys, ...targets.map(target => target.collectionKey)])].sort();
        if (!equal(current, input.expected)) fail('CONFLICT', 'The selected Zotero item changed after the organization preview.');
        if (!item.isEditable() || !z.Libraries.get(item.libraryID)?.editable) fail('NOT_EDITABLE', 'The selected Zotero item is read-only.');
        for (const target of targets) {
          const collection = z.Collections.getByLibraryAndKey(target.libraryId, target.collectionKey);
          if (!collection || collection.deleted) fail('NOT_FOUND', 'An approved target collection is no longer available.');
          if (!collection.isEditable()) fail('NOT_EDITABLE', 'An approved target collection is read-only.');
        }
        if (!addedTags.length && !addedCollectionKeys.length) return { before: current, after: current, addedTags: [], addedCollectionKeys: [] };
        for (const tag of addedTags) item.addTag(tag);
        for (const collectionKey of addedCollectionKeys) item.addToCollection(collectionKey);
        try { await item.save({ skipSelect: true }); }
        catch { fail('WRITE_UNCERTAIN', 'Organization changes were not confirmed. Inspect the item before retrying.'); }
        const after = support.organizationItemSnapshot(item);
        if (!equal(after.tags, desiredTags) || !equal(after.collectionKeys, desiredCollections) || after.organizationSignature !== input.expected.organizationSignature) fail('WRITE_UNCERTAIN', 'Organization changes could not be verified after saving.');
        return { before: current, after, addedTags, addedCollectionKeys };
      });
    }),
    undoOrganization: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); support.scope(expected.after);
      support.scope(expected.before);
      if (expected.before.clientId !== expected.after.clientId || expected.before.libraryId !== expected.after.libraryId || expected.before.key !== expected.after.key) fail('INVALID_INPUT', 'The recorded organization item identity is inconsistent.');
      const beforeTags = organizationTags(expected.before.tags, 2048).sort(); const afterTags = organizationTags(expected.after.tags, 2048).sort();
      const addedTags = organizationTags(expected.addedTags).sort();
      if (!Array.isArray(expected.addedCollectionKeys) || expected.addedCollectionKeys.length > MAX_ORGANIZATION_VALUES) fail('INVALID_INPUT', 'The recorded collection changes are invalid.');
      const beforeCollections = expected.before.collectionKeys.map(value => key(value)).sort();
      const afterCollections = expected.after.collectionKeys.map(value => key(value)).sort();
      const addedCollectionKeys = expected.addedCollectionKeys.map(value => key(value)).sort();
      if (new Set(beforeCollections).size !== beforeCollections.length || new Set(afterCollections).size !== afterCollections.length || new Set(addedCollectionKeys).size !== addedCollectionKeys.length
          || expected.before.organizationSignature !== expected.after.organizationSignature || !equal(expected.before.metadata, expected.after.metadata) || !equal(expected.before.attachmentKeys, expected.after.attachmentKeys)
          || beforeTags.some(tag => !afterTags.includes(tag)) || beforeCollections.some(collectionKey => !afterCollections.includes(collectionKey))
          || !equal(addedTags, afterTags.filter(tag => !beforeTags.includes(tag))) || !equal(addedCollectionKeys, afterCollections.filter(collectionKey => !beforeCollections.includes(collectionKey)))) {
        fail('INVALID_INPUT', 'The recorded organization delta is inconsistent and was not undone.');
      }
      return z.DB.executeTransaction(async () => {
        const item = support.getItem(expected.after); if (!item) return { status: 'absent' };
        await item.loadAllData?.(); checkSignal(signal); const current = support.organizationItemSnapshot(item);
        const presence = [...addedTags.map(tag => current.tags.includes(tag)), ...addedCollectionKeys.map(collectionKey => current.collectionKeys.includes(collectionKey))];
        if (!presence.length || presence.every(present => !present)) return { status: 'absent' };
        if (presence.some(present => !present)) return { status: 'conflict' };
        if (!item.isEditable() || !equal(current, expected.after)) return { status: 'conflict' };
        for (const tag of addedTags) item.removeTag(tag);
        for (const collectionKey of addedCollectionKeys) item.removeFromCollection(collectionKey);
        try { await item.save({ skipSelect: true }); }
        catch { fail('WRITE_UNCERTAIN', 'Organization undo was not confirmed. Inspect the item before retrying.'); }
        const after = support.organizationItemSnapshot(item);
        if (after.organizationSignature !== expected.before.organizationSignature || !equal(after.metadata, expected.before.metadata) || !equal(after.tags, expected.before.tags) || !equal(after.collectionKeys, expected.before.collectionKeys) || !equal(after.attachmentKeys, expected.before.attachmentKeys)) fail('WRITE_UNCERTAIN', 'Organization undo could not be verified after saving.');
        return { status: 'removed', after };
      });
    }),
    undoCreatedItem: (value, signal) => boundary(async () => {
      checkSignal(signal); const input = clone(value); const item = support.getItem(input.expected); if (!item) return { status: 'absent' };
      await item.loadAllData?.(); checkSignal(signal);
      if (!equal(support.itemSnapshot(item), input.expected) || item.getNotes(true).length || !item.isEditable()) return { status: 'conflict' };
      if (!equal(input.expected.attachmentKeys, input.attachments.map(a => a.key).sort())) return { status: 'conflict' };
      for (const expected of input.attachments) {
        if (expected.clientId !== support.clientId || expected.libraryId !== item.libraryID || expected.parentKey !== item.key) return { status: 'conflict' };
        const attachment = z.Items.getByLibraryAndKey(item.libraryID, expected.key); if (!attachment || attachment.parentID !== item.id || !attachment.isPDFAttachment()) return { status: 'conflict' };
        await attachment.loadAllData?.(); checkSignal(signal);
        if (attachment.getAnnotations().length || support.contentSignature(attachment) !== expected.contentSignature) return { status: 'conflict' };
        const path = await attachment.getFilePathAsync(); if (!path || await support.environment.computeHexDigest(path, 'sha256') !== expected.sha256) return { status: 'conflict' };
      }
      return z.DB.executeTransaction(async () => {
        checkSignal(signal);
        if (!equal(support.itemSnapshot(item), input.expected) || item.getNotes(true).length) return { status: 'conflict' };
        for (const expected of input.attachments) { const attachment = z.Items.getByLibraryAndKey(item.libraryID, expected.key); if (!attachment || attachment.getAnnotations().length || support.contentSignature(attachment) !== expected.contentSignature) return { status: 'conflict' }; }
        // Native trash is reversible and retains all stored files. Never erase a parent item.
        item.deleted = true;
        try { await item.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Moving the created item to trash was not confirmed.'); }
        return { status: 'trashed' };
      });
    }),
    undoAttachment: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.expected); const current = await reader.inspectAttachment(expected, signal);
      if (!current) return { status: 'absent' };
      if (!equal(current, expected)) return { status: 'conflict' };
      return z.DB.executeTransaction(async () => {
        const attachment = z.Items.getByLibraryAndKey(expected.libraryId, expected.key); if (!attachment || attachment.deleted) return { status: 'absent' };
        await attachment.loadAllData?.(); checkSignal(signal);
        if (!attachment.isEditable() || attachment.getAnnotations().length || support.contentSignature(attachment) !== expected.contentSignature) return { status: 'conflict' };
        attachment.deleted = true;
        try { await attachment.save({ skipSelect: true }); } catch { fail('WRITE_UNCERTAIN', 'Moving the task PDF to trash was not confirmed.'); }
        return { status: 'trashed' };
      });
    }),
    acquireOpenAccessPDF: (value, signal) => boundary(async () => {
      checkSignal(signal); const expected = clone(value.item); const item = support.getItem(expected);
      if (!item) fail('NOT_FOUND', 'The approved metadata item is no longer available.');
      await item.loadAllData?.(); checkSignal(signal);
      if (!equal(support.itemSnapshot(item), expected)) fail('CONFLICT', 'The metadata item changed before PDF acquisition.');
      if (!item.isEditable() || !z.Libraries.get(item.libraryID)?.filesEditable) fail('NOT_EDITABLE', 'The target library does not allow stored PDF attachments.');
      if (item.getAttachments().some(id => { const attachment = z.Items.get(id); return attachment && attachment.isPDFAttachment(); })) return { status: 'unavailable', reason: 'existing-pdf' };
      const doi = expected.metadata.DOI && support.cleanDOI(expected.metadata.DOI); if (!doi) return { status: 'unavailable', reason: 'no-doi' };
      const urls = await waitRead(z.Utilities.Internal.getOpenAccessPDFURLs(doi, { timeout: 15000 }), signal);
      const candidates = urls.slice(0, 6).map(row => ({ url: publicURL(row.url), version: row.version })).filter((row): row is { url: string; version: string | undefined } => !!row.url);
      if (!candidates.length) return { status: 'unavailable', reason: 'no-oa-candidate' };
      let result: NativeAcquisitionResult = { status: 'unavailable', reason: 'download-failed' };
      for (const candidate of candidates) {
        checkSignal(signal);
        const directory = (await z.Attachments.createTemporaryStorageDirectory()).path;
        const path = support.environment.join(directory, 'verified.pdf'); let writing = false;
        try {
          const response = await support.readURL(candidate.url, signal, path);
          if (!publicURL(response.responseURL)) continue;
          checkSignal(signal);
          const stat = await support.environment.stat(path);
          if (!Number.isSafeInteger(stat.size) || stat.size < 5 || stat.size > MAX_PDF_BYTES) { result = { status: 'unavailable', reason: 'file-too-large' }; continue; }
          if (await z.MIME.getMIMETypeFromFile(path) !== 'application/pdf') { result = { status: 'unavailable', reason: 'file-type-mismatch' }; continue; }
          const bytes = await support.environment.read(path); checkSignal(signal);
          const buf = new Uint8Array(bytes).buffer;
          // This verified host worker action accepts bytes without creating a library attachment.
          const data = object(await waitRead(z.PDFWorker._enqueue(() => z.PDFWorker._query('getFulltext', { buf, maxPages: 1 }, [buf]), false), signal));
          const text = typeof data.text === 'string' ? data.text : '';
          if (/\b(?:supplementary\s+(?:material|information|data|appendix)|supporting\s+information)\b/iu.test(text.slice(0, 1500))) { result = { status: 'uncertain', reason: 'supplementary' }; continue; }
          const title = normalizedTitle(expected.metadata.title); const matchedDOI = z.Utilities.extractIdentifiers(text).some(identifier => identifier.DOI && support.cleanDOI(identifier.DOI) === doi);
          if (title.length < 16 || !normalizedTitle(text).includes(title) || !matchedDOI || data.extractedPages !== 1 || !Number.isSafeInteger(data.totalPages) || (data.totalPages as number) < 1) { result = { status: 'uncertain', reason: 'identity-unconfirmed' }; continue; }
          const sha256 = await support.environment.computeHexDigest(path, 'sha256');
          if (!/^[a-f0-9]{64}$/u.test(sha256)) fail('UNAVAILABLE', 'PDF integrity could not be checked.');
          checkSignal(signal);
          if (!equal(support.itemSnapshot(item), expected)) fail('CONFLICT', 'The metadata item changed during PDF acquisition.');
          writing = true;
          const attachment = await z.Attachments.createURLAttachmentFromTemporaryStorageDirectory({ directory, filename: 'verified.pdf', libraryID: item.libraryID, parentItemID: item.id, title: candidate.version === 'acceptedVersion' ? 'Accepted version' : candidate.version === 'submittedVersion' ? 'Submitted version' : 'Full text', url: response.responseURL, contentType: 'application/pdf', saveOptions: { skipSelect: true } });
          return { status: 'attached', attachment: { clientId: support.clientId, libraryId: attachment.libraryID, key: attachment.key, parentKey: item.key, url: response.responseURL, contentType: 'application/pdf', sha256, contentSignature: support.contentSignature(attachment) }, articleVersion: candidate.version ?? 'unknown', checkedPages: 1, totalPages: data.totalPages as number };
        } catch (error) {
          if (writing) fail('WRITE_UNCERTAIN', 'The PDF attachment write was not confirmed. Inspect the parent item before retrying.');
          if (isNativeOperationError(error) && ['CANCELLED', 'CONFLICT'].includes(error.code)) throw error;
          checkSignal(signal);
        } finally { await support.environment.remove(directory, { recursive: true, ignoreAbsent: true }); }
      }
      return result;
    }),
  };
}

function isNativeOperationError(error: unknown): error is { code: string } {
  return error instanceof Error && error.name === 'NativeOperationError' && 'code' in error;
}

/**
 * Compose the native boundary at one place: the returned port includes the read methods, because
 * every action re-reads the state it changes. Read-only callers build `createNativeReaderPort` with
 * their own `createNativeSupport` instead and never construct the write half.
 */
export function createNativeActionPortFrom(options: NativeSupportOptions): NativeActionPort {
  const support = createNativeSupport(options);
  return createNativeActionPort(support, createNativeReaderPort(support));
}
