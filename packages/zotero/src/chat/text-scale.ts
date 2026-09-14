export const CHAT_TEXT_SCALE_PREF = 'extensions.zcr.chatTextScale';
export const CHAT_TEXT_SCALE_MIN = 0.5;
export const CHAT_TEXT_SCALE_MAX = 3;
export const CHAT_TEXT_SCALE_DEFAULT = 1;
export const CHAT_TEXT_SCALE_VAR = '--zcr-chat-text-scale';

export interface ReaderZoomHost {
  zoomIn(): void;
  zoomOut(): void;
  zoomReset(): void;
  readZoom(): number;
}

export function clampChatTextScale(value = CHAT_TEXT_SCALE_DEFAULT): number {
  return Number.isFinite(value) ? Math.min(CHAT_TEXT_SCALE_MAX, Math.max(CHAT_TEXT_SCALE_MIN, value)) : CHAT_TEXT_SCALE_DEFAULT;
}

export function applyChatTextScale(root: HTMLElement, value?: number): number {
  const scale = clampChatTextScale(value ?? (Number(root.style.getPropertyValue(CHAT_TEXT_SCALE_VAR)) || CHAT_TEXT_SCALE_DEFAULT));
  root.style.setProperty(CHAT_TEXT_SCALE_VAR, String(scale));
  return scale;
}

function zoomAction(event: KeyboardEvent): 'in' | 'out' | 'reset' | null {
  if (!event.metaKey || event.altKey || event.ctrlKey) return null;
  const key = event.key;
  const code = event.code;
  if (key === '=' || key === '+' || code === 'Equal' || code === 'NumpadAdd') return 'in';
  if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') return 'out';
  if (key === '0' || code === 'Digit0' || code === 'Numpad0') return 'reset';
  return null;
}

export function bindUnifiedReaderZoom(root: HTMLElement, host: ReaderZoomHost, targets?: Array<Document | HTMLElement>): () => void {
  applyChatTextScale(root);
  const onKey = (event: Event) => {
    const keyEvent = event as KeyboardEvent;
    const action = zoomAction(keyEvent);
    if (!action) return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    if (action === 'in') host.zoomIn();
    else if (action === 'out') host.zoomOut();
    else host.zoomReset();
    applyChatTextScale(root);
  };
  const nodes = targets?.length ? targets : [root.ownerDocument, root];
  for (const node of nodes) node.addEventListener('keydown', onKey, true);
  return () => { for (const node of nodes) node.removeEventListener('keydown', onKey, true); };
}
