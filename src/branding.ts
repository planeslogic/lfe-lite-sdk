const BADGE_TEXT = "Powered by PlanesLogic · LFE Lite";
const BADGE_ATTRIBUTE = "data-planeslogic-lfe-lite-branding";

interface BrandingDocumentState {
  requiredBy: Set<object>;
  host: HTMLDivElement | null;
  shadow: ShadowRoot | null;
  observer: MutationObserver | null;
  reconcileQueued: boolean;
}

const documentStates = new WeakMap<Document, BrandingDocumentState>();

function getState(documentRef: Document): BrandingDocumentState {
  let state = documentStates.get(documentRef);
  if (!state) {
    state = {
      requiredBy: new Set(),
      host: null,
      shadow: null,
      observer: null,
      reconcileQueued: false,
    };
    documentStates.set(documentRef, state);
  }
  return state;
}

function mountTarget(documentRef: Document): HTMLElement | null {
  return documentRef.body ?? documentRef.documentElement;
}

function createBadge(documentRef: Document, state: BrandingDocumentState): void {
  const target = mountTarget(documentRef);
  if (!target) {
    return;
  }

  const host = documentRef.createElement("div");
  host.setAttribute(BADGE_ATTRIBUTE, "");
  host.setAttribute("aria-label", BADGE_TEXT);

  const shadow = host.attachShadow({ mode: "closed" });
  const style = documentRef.createElement("style");
  style.textContent = `
    :host {
      all: initial;
    }
    .badge {
      position: fixed;
      right: 12px;
      bottom: 12px;
      z-index: 2147483647;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      max-width: calc(100vw - 24px);
      padding: 6px 9px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      background: rgba(12, 18, 14, 0.94);
      color: #d7ffe4;
      font: 500 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      letter-spacing: 0.01em;
      white-space: nowrap;
      pointer-events: none;
    }
  `;
  const badge = documentRef.createElement("span");
  badge.className = "badge";
  badge.textContent = BADGE_TEXT;
  shadow.append(style, badge);

  target.appendChild(host);
  state.host = host;
  state.shadow = shadow;
}

function ensureObserver(documentRef: Document, state: BrandingDocumentState): void {
  if (state.observer || typeof MutationObserver === "undefined") {
    return;
  }

  state.observer = new MutationObserver(() => {
    if (state.requiredBy.size === 0 || state.reconcileQueued) {
      return;
    }

    if (state.host?.isConnected) {
      return;
    }

    state.reconcileQueued = true;
    queueMicrotask(() => {
      state.reconcileQueued = false;
      if (state.requiredBy.size > 0 && !state.host?.isConnected) {
        createBadge(documentRef, state);
      }
    });
  });

  state.observer.observe(documentRef.documentElement, {
    childList: true,
    subtree: true,
  });
}

function reconcileDocument(documentRef: Document, state: BrandingDocumentState): void {
  if (state.requiredBy.size > 0) {
    if (!state.host?.isConnected) {
      createBadge(documentRef, state);
    }
    ensureObserver(documentRef, state);
    return;
  }

  state.observer?.disconnect();
  state.observer = null;
  state.host?.remove();
  state.host = null;
  state.shadow = null;
}

export function setBrandingContribution(
  token: object,
  required: boolean,
  documentRef: Document = document,
): void {
  const state = getState(documentRef);
  if (required) {
    state.requiredBy.add(token);
  } else {
    state.requiredBy.delete(token);
  }
  reconcileDocument(documentRef, state);
}

export function removeBrandingContribution(
  token: object,
  documentRef: Document = document,
): void {
  const state = getState(documentRef);
  state.requiredBy.delete(token);
  reconcileDocument(documentRef, state);
}

export const brandingContract = {
  attribute: BADGE_ATTRIBUTE,
  text: BADGE_TEXT,
} as const;
