/**
 * The text an owner hands to another application when Chat mode hosts the real ChatGPT web app.
 *
 * Chat mode does not send this text anywhere: the web application owns its own conversation, and no
 * supported mechanism exists to inject context into it. What this host can do honestly is prepare the
 * current paper's bibliography and stored abstract as a compact text block. PDF body text is never
 * included here; an explicitly selected passage is handled separately by `selectionBrief`. Nothing
 * here reads a file, calls a model, or reaches the network.
 */
import type { PaperIdentity } from '../../../contracts/src/index.ts';
import { paperContext } from './paper-context.ts';

/** Compatibility marker retained for callers that imported the old header constant. */
export const DOCUMENT_BRIEF_HEADER = 'Bibliographic context from the paper open in Zotero:';

export interface DocumentBrief {
  /** The whole block, ready for the clipboard. */
  text: string;
  /** Bibliographic labels included, such as Title, Authors and Abstract. */
  fields: string[];
  hasAbstract: boolean;
  /** Always zero: this context contains no PDF body pages. */
  included: number;
  totalPages: number;
  /** Always false: bibliographic context is not truncated by PDF page limits. */
  truncated: boolean;
}

/**
 * Build compact automatic Chat context from frozen bibliography fields and stored abstract.
 */
export function documentBrief(identity: PaperIdentity): DocumentBrief | null {
  const context = paperContext(identity);
  return context ? { ...context, included: 0, totalPages: 0, truncated: false } : null;
}

/**
 * A selection the reader itself reported through Zotero's selection event, as pasteable text: this is
 * the citation the sidebar already froze, not a second read of the reader's DOM.
 */
export function selectionBrief(citation: { text: string; title: string; pageLabel: string }): string {
  const title = citation.title.trim() || 'Untitled';
  const page = citation.pageLabel.trim();
  return [`Selection from the PDF open in Zotero: ${title}${page ? ` (page ${page})` : ''}`, '', citation.text].join('\n');
}
