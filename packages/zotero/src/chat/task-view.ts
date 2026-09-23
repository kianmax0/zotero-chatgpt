import type { AcquisitionChoice, AcquisitionTaskItem, ActionTaskChoices, ActionTaskRecord } from '../../../contracts/src/tasks.ts';
import type { NativeCollectionTarget } from '../../../contracts/src/native.ts';
import type { ReadingJob } from '../../../core/src/context/coordinator.ts';

export interface TaskViewState { tasks: ActionTaskRecord[]; readingJobs?: ReadingJob[] }
export interface TaskViewActions {
  approveSelected: (taskId: string, selectedItemIds: string[], choices: ActionTaskChoices) => Promise<unknown>;
  cancel: (taskId: string) => Promise<unknown>;
  reconcile: (taskId: string) => Promise<unknown>;
  undo: (taskId: string) => Promise<unknown>;
  openSource: (taskId: string, itemId: string) => Promise<unknown>;
  openOutput: (taskId: string, itemId: string) => Promise<unknown>;
  collectionLabel: (target: NativeCollectionTarget) => string;
  cancelReading: (jobId: string) => Promise<unknown>;
  reconcileReading: (jobId: string) => Promise<unknown>;
  openReadingOutput: (jobId: string, stepIndex: number) => Promise<unknown>;
  describeReading?: (jobId: string) => Promise<{ question: string; scopeLabel: string } | null>;
}

type TaskItem = ActionTaskRecord['items'][number];
const TASK_LABEL = { preparing: 'Preparing', review: 'Review', running: 'Running', completed: 'Completed', partial: 'Partly completed', cancelled: 'Cancelled', uncertain: 'Unconfirmed', undone: 'Undone', conflict: 'Conflict', failed: 'Failed' } as const;
const ITEM_LABEL = { candidate: 'Ready', unresolved: 'Unresolved', skipped: 'Skipped', writing: 'Writing…', applied: 'Applied', 'metadata-only': 'Metadata saved', failed: 'Failed', uncertain: 'Unconfirmed', undoing: 'Undoing…', undone: 'Undone', conflict: 'Changed output preserved' } as const;
function eligible(item: TaskItem): boolean {
  if (item.status !== 'candidate') return false;
  if (item.kind === 'annotation') return item.resolution?.status === 'resolved';
  if (item.kind === 'acquisition') return !!item.preview?.candidates.length;
  return item.proposal.tags.length > 0 || item.proposal.collections.length > 0;
}
function hasOutput(item: TaskItem): boolean {
  if (item.status === 'undone') return false;
  if (item.kind === 'annotation') return !!item.annotation;
  if (item.kind === 'acquisition') return !!item.item;
  return !!item.change;
}
function itemOutcome(item: TaskItem): string {
  if (item.kind === 'organization') {
    if (item.status === 'applied') return item.change ? 'Verified additions saved' : 'Saved output not verified';
    return ITEM_LABEL[item.status];
  }
  if (item.kind !== 'acquisition' || !item.item || item.status === 'undone' || item.status === 'conflict' || item.status === 'uncertain') return ITEM_LABEL[item.status];
  if (item.attachmentUndone) return 'Metadata saved; PDF removed';
  if (item.acquisition?.status === 'attached') return 'PDF attached';
  if (item.acquisition?.status === 'unavailable') return `Metadata saved; PDF unavailable (${item.acquisition.reason.replace(/-/gu, ' ')})`;
  if (item.acquisition?.status === 'uncertain' && item.status === 'metadata-only') return `Metadata saved; PDF unavailable (${item.acquisition.reason.replace(/-/gu, ' ')})`;
  if (item.acquisition?.status === 'uncertain') return 'Metadata saved; PDF result unconfirmed';
  if (item.choice?.downloadPDF === false) return 'Metadata saved; PDF not requested';
  return item.status === 'metadata-only' ? 'Metadata saved; PDF not attempted' : 'Metadata saved';
}
function annotationSource(item: Extract<TaskItem, { kind: 'annotation' }>): string {
  const resolution = item.resolution;
  if (resolution?.status === 'resolved') return `Verified source: p. ${resolution.candidate.pageLabel}`;
  if (resolution?.status === 'ambiguous') return `Proposed model page ${item.proposal.pageIndex + 1} · ${resolution.matches} matching passages`;
  const reason = resolution?.status === 'unresolved' ? {
    'not-found': 'Exact quote not found',
    'incomplete-text': 'Page text incomplete',
    'invalid-geometry': 'Quote geometry unavailable',
    'range-required': 'Page range required',
    'unsupported-span': 'Quote crosses an unsupported page span',
  }[resolution.reason] : 'Source has not been resolved';
  return `Proposed model page ${item.proposal.pageIndex + 1} · ${reason}`;
}
function placeChildren(parent: HTMLElement, nodes: HTMLElement[]): void {
  const wanted = new Set(nodes);
  for (const child of [...parent.children]) if (!wanted.has(child as HTMLElement)) child.remove();
  let cursor = parent.firstElementChild;
  for (const node of nodes) { if (node !== cursor) parent.insertBefore(node, cursor); cursor = node.nextElementSibling; }
}

/** A read-only projection of task ledgers. Buttons call the controller; they never simulate a result. */
export function mountTaskView(container: HTMLElement, actions: TaskViewActions): { update(state: TaskViewState): void; dispose(): void } {
  const doc = container.ownerDocument;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => { const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElementTagNameMap[K]; node.textContent = text; node.className = className; return node; };
  const root = create('section', '', 'zchatgpt-task-view'); root.setAttribute('aria-label', 'Tasks'); container.append(root);
  const button = (label: string, action: string, click: () => void) => { const node = create('button', label, 'zchatgpt-task-button'); node.type = 'button'; node.dataset.zchatgptTaskAction = action; node.setAttribute('aria-label', label); node.addEventListener('click', click); return node; };
  const cards = new Map<string, { node: HTMLDetailsElement; update(task: ActionTaskRecord): void; dispose(): void }>();
  const readingCards = new Map<string, { node: HTMLDetailsElement; update(job: ReadingJob): void; dispose(): void }>();
  let disposed = false;
  const createTask = (initial: ActionTaskRecord) => {
    let task = initial; let previousState = initial.state; let userToggled = false; let removed = false;
    const node = create('details', '', 'zchatgpt-task-card'); node.dataset.zchatgptTaskId = task.id; node.open = !['completed', 'undone'].includes(task.state);
    const summary = create('summary'); summary.addEventListener('click', () => { userToggled = true; });
    const body = create('div', '', 'zchatgpt-task-body'); const question = create('p', '', 'zchatgpt-task-question'); const scope = create('p', '', 'zchatgpt-task-muted'); scope.dataset.zchatgptTaskScope = '';
    const counts = create('p', '', 'zchatgpt-task-muted zchatgpt-task-counts'); counts.setAttribute('role', 'status');
    const rows = create('div'); const guidance = create('p', '', 'zchatgpt-task-muted'); const error = create('p', '', 'zchatgpt-task-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const controls = create('div', '', 'zchatgpt-task-actions'); body.append(question, scope, counts, rows, guidance, error, controls); node.append(summary, body);
    const selected = new Map<string, boolean>(); const choices = new Map<string, AcquisitionChoice>(); const pending = new Set<string>();
    const rowViews = new Map<string, { node: HTMLElement; update(item: TaskItem): void }>();
    const mutating = () => ['approve', 'reconcile', 'undo'].some(name => pending.has(name));
    const execute = (name: string, run: () => Promise<unknown>, control: HTMLButtonElement) => {
      if (removed || control.disabled || pending.has(name)) return;
      const focused = doc.activeElement === control; pending.add(name); error.hidden = true; refresh();
      void (async () => {
        try { await run(); }
        catch (failure) { if (!removed) { error.textContent = failure instanceof Error ? failure.message : 'This task action could not be completed.'; error.hidden = false; } }
        finally {
          pending.delete(name); if (removed) return; refresh();
          if (focused && doc.activeElement === doc.body) (node.open && !control.hidden ? control : summary).focus();
        }
      })();
    };
    const choiceFor = (item: AcquisitionTaskItem) => {
      let choice = choices.get(item.id);
      if (!choice) { choice = { ...item.choice, downloadPDF: item.choice?.downloadPDF ?? true }; choices.set(item.id, choice); }
      const candidates = item.preview?.candidates ?? [];
      if (candidates.length === 1 && choice.metadataIndex === undefined) choice.metadataIndex = 0;
      if (choice.metadataIndex !== undefined && !candidates[choice.metadataIndex]) delete choice.metadataIndex;
      const metadata = choice.metadataIndex === undefined ? undefined : candidates[choice.metadataIndex];
      const duplicates = item.duplicates.filter(duplicate => duplicate.metadata.DOI && duplicate.metadata.DOI.toLowerCase() === metadata?.DOI?.toLowerCase());
      if (choice.duplicateKey && !duplicates.some(duplicate => duplicate.key === choice.duplicateKey)) delete choice.duplicateKey;
      if (duplicates.length === 1 && !choice.duplicateKey) choice.duplicateKey = duplicates[0]!.key;
      return { choice, metadata, duplicates, valid: !!metadata && (duplicates.length < 2 || !!choice.duplicateKey) };
    };
    const approve = button('Approve selected', 'approve', () => {
      const items = task.items.filter(item => eligible(item) && selected.get(item.id)); const frozen: ActionTaskChoices = {};
      for (const item of items) if (item.kind === 'acquisition') frozen[item.id] = { ...choiceFor(item).choice };
      execute('approve', () => actions.approveSelected(task.id, items.map(item => item.id), frozen), approve);
    });
    const cancel = button('Cancel task', 'cancel', () => execute('cancel', () => actions.cancel(task.id), cancel));
    const reconcile = button('Reconcile task', 'reconcile', () => execute('reconcile', () => actions.reconcile(task.id), reconcile));
    const undo = button('Undo task', 'undo', () => execute('undo', () => actions.undo(task.id), undo)); controls.append(approve, cancel, reconcile, undo);
    const rowFor = (initialItem: TaskItem) => {
      let item = initialItem;
      const row = create('article', '', 'zchatgpt-task-row'); row.dataset.zchatgptTaskItemId = item.id;
      const header = create('div', '', 'zchatgpt-task-row-header'); const include = create('label', 'Include', 'zchatgpt-task-check'); const check = create('input'); check.type = 'checkbox'; check.dataset.zchatgptTaskSelect = item.id; check.setAttribute('aria-label', 'Include this candidate'); include.prepend(check);
      const itemStatus = create('span', '', 'zchatgpt-task-muted'); header.append(include, itemStatus);
      const quote = create('blockquote', '', 'zchatgpt-task-quote'); const reason = create('p', '', 'zchatgpt-task-muted'); const page = create('p', '', 'zchatgpt-task-muted'); const organizationDetail = create('p', '', 'zchatgpt-task-muted'); const itemError = create('p', '', 'zchatgpt-task-muted');
      const fields = create('div');
      const field = (label: string, select: HTMLSelectElement) => { const node = create('label', label, 'zchatgpt-task-field'); node.append(select); fields.append(node); return node; };
      const metadata = create('select'); metadata.dataset.zchatgptMetadataChoice = item.id; field('Verified metadata', metadata);
      const duplicate = create('select'); duplicate.dataset.zchatgptDuplicateChoice = item.id; const duplicateField = field('Existing item', duplicate);
      const metadataDetail = create('p', '', 'zchatgpt-task-muted'); fields.append(metadataDetail);
      const pdfLabel = create('label', 'Obtain a verified PDF', 'zchatgpt-task-check'); const pdf = create('input'); pdf.type = 'checkbox'; pdf.dataset.zchatgptDownloadPdf = item.id; pdfLabel.prepend(pdf); fields.append(pdfLabel);
      const rowControls = create('div', '', 'zchatgpt-task-actions');
      const source = button('Open source', 'source', () => execute(`source:${item.id}`, () => actions.openSource(task.id, item.id), source));
      const output = button('Open saved output', 'output', () => execute(`output:${item.id}`, () => actions.openOutput(task.id, item.id), output)); rowControls.append(source, output);
      row.append(header, quote, reason, page, fields, organizationDetail, itemError, rowControls);
      check.addEventListener('change', () => { selected.set(item.id, check.checked); refresh(); });
      metadata.addEventListener('change', () => {
        if (item.kind !== 'acquisition') return; const { choice } = choiceFor(item);
        if (metadata.value === '') delete choice.metadataIndex; else choice.metadataIndex = Number(metadata.value);
        delete choice.duplicateKey; refresh();
      });
      duplicate.addEventListener('change', () => { if (item.kind !== 'acquisition') return; const { choice } = choiceFor(item); if (duplicate.value) choice.duplicateKey = duplicate.value; else delete choice.duplicateKey; refresh(); });
      pdf.addEventListener('change', () => { if (item.kind === 'acquisition') { choiceFor(item).choice.downloadPDF = pdf.checked; refresh(); } });
      let metadataKey = ''; let duplicateKey = '';
      return { node: row, update: (next: TaskItem) => {
        item = next;
        if (!selected.has(item.id)) selected.set(item.id, item.selected ?? true);
        if (task.state !== 'review' && item.selected !== undefined) selected.set(item.id, item.selected);
        if (item.kind === 'acquisition' && task.state !== 'review' && item.choice) choices.set(item.id, { ...item.choice });
        const canReview = task.state === 'review' && !task.approvedAt && !mutating();
        include.hidden = !['review', 'preparing'].includes(task.state); check.disabled = !canReview || !eligible(item); check.checked = eligible(item) ? !!selected.get(item.id) : !!item.selected;
        itemStatus.textContent = itemOutcome(item); itemError.textContent = item.errorCode ? `Error: ${item.errorCode}` : ''; itemError.hidden = !itemError.textContent;
        source.hidden = item.kind !== 'annotation' || item.resolution?.status !== 'resolved'; source.disabled = pending.has(`source:${item.id}`);
        output.hidden = !hasOutput(item); output.disabled = pending.has(`output:${item.id}`);
        fields.hidden = item.kind !== 'acquisition' || task.state !== 'review';
        organizationDetail.hidden = item.kind !== 'organization';
        if (item.kind === 'annotation') {
          quote.textContent = item.proposal.quote; reason.textContent = item.proposal.reason;
          page.textContent = annotationSource(item);
        } else if (item.kind === 'acquisition') {
          const resolved = choiceFor(item); const candidates = item.preview?.candidates ?? [];
          quote.textContent = item.item?.metadata.title ?? resolved.metadata?.title ?? item.identifier; reason.textContent = item.identifier; page.textContent = '';
          const nextMetadata = JSON.stringify(candidates);
          if (nextMetadata !== metadataKey) { metadataKey = nextMetadata; const prompt = create('option', 'Choose metadata'); prompt.value = ''; metadata.replaceChildren(prompt, ...candidates.map((candidate, index) => { const option = create('option', candidate.title); option.value = String(index); return option; })); }
          metadata.value = resolved.choice.metadataIndex === undefined ? '' : String(resolved.choice.metadataIndex); metadata.disabled = !canReview || candidates.length < 2;
          const nextDuplicates = JSON.stringify(resolved.duplicates.map(item => [item.key, item.metadata.title]));
          if (nextDuplicates !== duplicateKey) { duplicateKey = nextDuplicates; const prompt = create('option', 'Choose existing item'); prompt.value = ''; duplicate.replaceChildren(prompt, ...resolved.duplicates.map(item => { const option = create('option', `${item.metadata.title} · ${item.key}`); option.value = item.key; return option; })); }
          duplicateField.hidden = !resolved.duplicates.length; duplicate.value = resolved.choice.duplicateKey ?? ''; duplicate.disabled = !canReview || resolved.duplicates.length < 2;
          metadataDetail.textContent = resolved.metadata ? [resolved.metadata.DOI, resolved.metadata.date, resolved.duplicates.length ? `${resolved.duplicates.length} existing match(es)` : 'Create a new item'].filter(Boolean).join(' · ') : 'Choose the metadata to review existing matches.';
          pdf.checked = resolved.choice.downloadPDF !== false; pdf.disabled = !canReview;
        } else {
          const label = (target: NativeCollectionTarget) => { try { return actions.collectionLabel(target) || target.collectionKey; } catch { return target.collectionKey; } };
          const proposedCollections = item.proposal.collections.map(label);
          quote.textContent = item.before.metadata.title;
          reason.textContent = `Add tags: ${item.proposal.tags.join(', ') || 'none'}`;
          page.textContent = `Add to collections: ${proposedCollections.join(', ') || 'none'}`;
          const existingTags = item.before.tags.length; const existingCollections = item.before.collectionKeys.length;
          if (item.status === 'undone') organizationDetail.textContent = 'Undo verified: approved additions removed; other item data preserved.';
          else if (item.status === 'conflict') organizationDetail.textContent = 'Later changes were preserved; undo was not reported as successful.';
          else if (item.status === 'applied' && item.change) {
            const tags = item.change.addedTags.length; const collections = item.change.addedCollectionKeys.length;
            organizationDetail.textContent = `Verified saved: ${tags} ${tags === 1 ? 'tag' : 'tags'} and ${collections} ${collections === 1 ? 'collection' : 'collections'} added.`;
          } else if (item.status === 'applied') organizationDetail.textContent = 'Saved output not verified; reconcile before relying on this result.';
          else organizationDetail.textContent = `Existing ${existingTags} ${existingTags === 1 ? 'tag' : 'tags'} and ${existingCollections} ${existingCollections === 1 ? 'collection' : 'collections'} stay unchanged; approval only adds the entries shown above.`;
        }
      } };
    };
    const refresh = () => {
      if (removed) return;
      question.textContent = task.question;
      if (task.kind === 'annotations') scope.textContent = `PDF ${task.paper.attachmentKey} · candidate pages ${[...new Set(task.items.map(item => item.proposal.pageIndex + 1))].join(', ') || 'none'}`;
      else if (task.kind === 'acquisition') { let label = ''; try { label = actions.collectionLabel(task.target); } catch { /* Keep the recorded key available. */ } scope.textContent = `Target collection: ${label || task.target.collectionKey}`; }
      else {
        const positions = task.items.map(item => item.sourceIndex + 1).sort((a, b) => a - b); const first = positions[0]; const last = positions.at(-1);
        scope.textContent = first === undefined ? 'Selection positions: none' : first === last ? `Selection position ${first} · ${task.items.length} proposed item` : `Selection positions ${first}–${last} · ${task.items.length} proposed items`;
      }
      const itemNodes = task.items.map(item => { let row = rowViews.get(item.id); if (!row) { row = rowFor(item); rowViews.set(item.id, row); } row.update(item); return row.node; }); placeChildren(rows, itemNodes);
      const ids = new Set(task.items.map(item => item.id)); for (const id of rowViews.keys()) if (!ids.has(id)) { rowViews.delete(id); selected.delete(id); choices.delete(id); }
      const ready = task.items.filter(eligible); const selectedItems = ready.filter(item => selected.get(item.id));
      const validChoices = selectedItems.every(item => item.kind !== 'acquisition' || choiceFor(item).valid);
      const outputs = task.items.filter(hasOutput);
      const savedItems = task.items.filter(item => item.kind === 'acquisition' && item.item && item.status !== 'undone').length;
      const attachedPDFs = task.items.filter(item => item.kind === 'acquisition' && item.acquisition?.status === 'attached' && !item.attachmentUndone && item.status === 'applied').length;
      const done = task.items.filter(item => ['applied', 'metadata-only'].includes(item.status)).length;
      const verifiedOrganization = task.items.filter(item => item.kind === 'organization' && item.status === 'applied' && item.change).length;
      const outcome = task.state === 'review' ? `${selectedItems.length}/${ready.length} selected${task.kind === 'organization' ? ' items' : ''}` : task.kind === 'annotations' ? `${done}/${task.items.length} annotations applied` : task.kind === 'organization' ? `${verifiedOrganization}/${task.items.length} items organized` : `${savedItems} ${savedItems === 1 ? 'item' : 'items'} saved · ${attachedPDFs} ${attachedPDFs === 1 ? 'PDF' : 'PDFs'} attached`;
      const taskName = task.kind === 'annotations' ? 'Annotations' : task.kind === 'organization' ? 'Organize library' : 'Acquire literature';
      summary.textContent = `${taskName} · ${TASK_LABEL[task.state]} · ${outcome}`;
      const stateCounts = new Map<string, number>(); for (const item of task.items) { const label = item.kind === 'organization' ? itemOutcome(item) : ITEM_LABEL[item.status]; stateCounts.set(label, (stateCounts.get(label) ?? 0) + 1); }
      counts.textContent = [...stateCounts].map(([name, count]) => `${count} ${name.toLowerCase()}`).join(' · ');
      const uncertain = task.state === 'uncertain' || task.items.some(item => ['writing', 'uncertain', 'undoing'].includes(item.status));
      approve.hidden = task.state !== 'review' || !!task.approvedAt; approve.disabled = mutating() || !selectedItems.length || !validChoices;
      approve.textContent = pending.has('approve') ? 'Approving…' : 'Approve selected';
      cancel.hidden = !['preparing', 'review', 'running', 'uncertain'].includes(task.state); cancel.disabled = pending.has('cancel') || !!task.cancelRequested; cancel.textContent = task.cancelRequested || pending.has('cancel') ? 'Cancellation requested' : 'Cancel task';
      reconcile.hidden = !uncertain; reconcile.disabled = mutating();
      undo.hidden = !task.approvedAt || !outputs.length || task.state === 'undone'; undo.disabled = mutating() || uncertain || task.state === 'running';
      guidance.textContent = uncertain ? 'Reconcile unconfirmed writes before undoing. They will not be resent automatically.' : task.state === 'conflict' ? 'Changed outputs and human changes are preserved. Undo checks the recorded version again.' : ''; guidance.hidden = !guidance.textContent;
    };
    return { node, update: (next: ActionTaskRecord) => {
      if (next.revision < task.revision) return;
      if (next.revision > task.revision) { error.textContent = ''; error.hidden = true; }
      task = next; node.dataset.state = task.state;
      if (!userToggled && previousState !== task.state) node.open = !['completed', 'undone'].includes(task.state);
      previousState = task.state; refresh();
    }, dispose: () => { removed = true; node.remove(); } };
  };
  const createReading = (initial: ReadingJob) => {
    let job = initial; let removed = false; let userToggled = false; let previousStatus = job.status; let actionError: string | null = null;
    const node = create('details', '', 'zchatgpt-task-card'); node.dataset.zchatgptReadingJob = job.id; node.open = job.status !== 'completed';
    const summary = create('summary'); summary.addEventListener('click', () => { userToggled = true; });
    const body = create('div', '', 'zchatgpt-task-body'); const question = create('p', '', 'zchatgpt-task-question'); const scope = create('p', '', 'zchatgpt-task-scope'); question.hidden = true; scope.hidden = true;
    const steps = create('div'); const error = create('p', '', 'zchatgpt-task-error'); error.setAttribute('role', 'status'); error.hidden = true; const controls = create('div', '', 'zchatgpt-task-actions'); body.append(question, scope, steps, error, controls); node.append(summary, body);
    const pending = new Set<string>(); const stepViews = new Map<number, { row: HTMLElement; label: HTMLElement; excerpt: HTMLElement; scope: HTMLElement; output?: HTMLButtonElement }>();
    const execute = (name: string, run: () => Promise<unknown>, control: HTMLButtonElement) => {
      if (removed || control.disabled || pending.has(name)) return; pending.add(name); actionError = null; refresh();
      void (async () => { try { await run(); } catch (failure) { if (!removed) actionError = failure instanceof Error ? failure.message : 'The reading action failed.'; } finally { pending.delete(name); if (!removed) refresh(); } })();
    };
    const cancel = button('Cancel reading', 'reading-cancel', () => execute('cancel', () => actions.cancelReading(job.id), cancel));
    const reconcile = button('Reconcile reading', 'reading-reconcile', () => execute('reconcile', () => actions.reconcileReading(job.id), reconcile)); controls.append(cancel, reconcile);
    let described = false; let describing = false;
    const loadDescription = () => {
      if (!actions.describeReading || described || describing) return;
      describing = true;
      void actions.describeReading(job.id).then(description => {
        describing = false;
        if (removed || !description) return;
        described = true;
        question.textContent = description.question; scope.textContent = description.scopeLabel; question.hidden = false; scope.hidden = false;
      }).catch(() => { describing = false; });
    };
    loadDescription();
    const refresh = () => {
      if (removed) return;
      summary.textContent = `Reading · ${job.status} · ${job.steps.filter(step => step.status === 'completed').length}/${job.steps.length} passes`;
      const nodes = job.steps.map(step => {
        let view = stepViews.get(step.index);
        if (!view) { const row = create('div', '', 'zchatgpt-task-row'); const label = create('p'); const scope = create('p', '', 'zchatgpt-task-muted'); const excerpt = create('p', '', 'zchatgpt-task-quote'); row.append(label, scope, excerpt); view = { row, label, scope, excerpt }; stepViews.set(step.index, view); }
        view.label.textContent = `${step.phase === 'reduce' ? 'Synthesis' : step.phase === 'map' ? `Reading pass ${step.index + 1}` : 'Read selected sources'} · ${step.status}`;
        view.scope.textContent = step.result ? [step.result.title, step.result.pageLabels.length ? `p. ${step.result.pageLabels.join(', ')}` : ''].filter(Boolean).join(' · ') : '';
        view.excerpt.textContent = step.result?.text ? `${step.result.text.slice(0, 240)}${step.result.text.length > 240 ? '…' : ''}` : '';
        if (step.status === 'completed' && step.result?.text && step.result.messageIds.length) {
          if (!view.output) { const output = button('Open reading result', 'reading-output', () => execute(`output:${step.index}`, () => actions.openReadingOutput(job.id, step.index), output)); view.output = output; view.row.append(output); }
          view.output.disabled = pending.has(`output:${step.index}`);
        } else { view.output?.remove(); delete view.output; }
        return view.row;
      }); placeChildren(steps, nodes);
      error.textContent = actionError ?? job.error?.message ?? (job.persistence === 'unconfirmed' ? 'Reading task persistence is unconfirmed.' : ''); error.hidden = !error.textContent;
      cancel.hidden = ['completed', 'cancelled', 'failed'].includes(job.status); cancel.disabled = pending.has('cancel') || job.cancelRequested || job.status === 'cancelling';
      reconcile.hidden = !['uncertain', 'paused'].includes(job.status) && job.persistence !== 'unconfirmed'; reconcile.disabled = pending.has('reconcile');
    };
    return { node, update: (next: ReadingJob) => { if (next.revision < job.revision) return; if (next.revision > job.revision) actionError = null; job = next; loadDescription(); if (!userToggled && previousStatus !== job.status) node.open = job.status !== 'completed'; previousStatus = job.status; refresh(); }, dispose: () => { removed = true; node.remove(); } };
  };
  return { update: state => {
    if (disposed) return;
    const taskIds = new Set(state.tasks.map(task => task.id)); for (const [id, view] of cards) if (!taskIds.has(id)) { view.dispose(); cards.delete(id); }
    const jobs = state.readingJobs ?? []; const jobIds = new Set(jobs.map(job => job.id)); for (const [id, view] of readingCards) if (!jobIds.has(id)) { view.dispose(); readingCards.delete(id); }
    const nodes: HTMLDetailsElement[] = [];
    for (const task of state.tasks) { let view = cards.get(task.id); if (!view) { view = createTask(task); cards.set(task.id, view); } view.update(task); nodes.push(view.node); }
    for (const job of jobs) { let view = readingCards.get(job.id); if (!view) { view = createReading(job); readingCards.set(job.id, view); } view.update(job); nodes.push(view.node); }
    placeChildren(root, nodes); root.hidden = nodes.length === 0;
  }, dispose: () => { if (disposed) return; disposed = true; for (const view of cards.values()) view.dispose(); for (const view of readingCards.values()) view.dispose(); root.remove(); } };
}
