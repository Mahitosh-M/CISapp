import { useEffect } from 'react';

const ENTRY_SELECTOR = [
  'input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
  'select',
  'textarea'
].join(',');

const FORM_ACTION_SELECTOR = [
  'button:not([disabled])',
  'input[type="button"]:not([disabled])',
  'input[type="submit"]:not([disabled])'
].join(',');

const isFocusable = (element: HTMLElement) => {
  if (element.hasAttribute('disabled')) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  if (element.tabIndex < 0) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  return Boolean(element.offsetParent || element.getClientRects().length > 0);
};

const safelySelectText = (element: HTMLElement) => {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;

  try {
    element.select();
  } catch {
    // Some input types, such as date, cannot be selected programmatically.
  }
};

const getControls = (scope: Element, selector: string) => Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(isFocusable);

const followsCurrentControl = (currentControl: HTMLElement, candidate: HTMLElement) =>
  Boolean(currentControl.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING);

const findNextControl = (currentControl: HTMLElement) => {
  const form = currentControl.closest('form');

  if (form) {
    const entries = getControls(form, ENTRY_SELECTOR);
    const currentIndex = entries.indexOf(currentControl);
    const nextEntry = currentIndex >= 0 ? entries[currentIndex + 1] : undefined;

    if (nextEntry) return nextEntry;

    return getControls(form, FORM_ACTION_SELECTOR).find((control) => followsCurrentControl(currentControl, control));
  }

  let scope = currentControl.parentElement;
  const stopAt = currentControl.closest('main') ?? document.body;

  while (scope) {
    const controls = getControls(scope, ENTRY_SELECTOR);
    const currentIndex = controls.indexOf(currentControl);

    if (currentIndex >= 0 && controls[currentIndex + 1]) {
      return controls[currentIndex + 1];
    }

    if (scope === stopAt) break;
    scope = scope.parentElement;
  }

  return undefined;
};

export const useEnterKeyNavigation = () => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing
      ) {
        return;
      }

      if (!(event.target instanceof HTMLElement) || event.target.isContentEditable) {
        return;
      }

      const currentControl = event.target.closest<HTMLElement>(ENTRY_SELECTOR);
      if (!currentControl || !isFocusable(currentControl)) {
        return;
      }

      const nextControl = findNextControl(currentControl);
      if (!nextControl) return;

      event.preventDefault();
      nextControl.focus();
      safelySelectText(nextControl);
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, []);
};
