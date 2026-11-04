// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { useManualNumberInputs } from './useManualNumberInputs';

afterEach(() => { cleanup(); document.body.replaceChildren(); });
const field = (type = 'number') => {
  const input = document.createElement('input');
  input.type = type;
  input.value = '123';
  document.body.append(input);
  return input;
};
const wheel = (input: HTMLInputElement) => {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
  input.dispatchEvent(event);
  return event;
};

it('prevents wheel changes on a focused number field added after mount without blurring it', () => {
  renderHook(useManualNumberInputs);
  const input = field();
  input.focus();
  expect(wheel(input).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('123');
  fireEvent.input(input, { target: { value: '456' } });
  expect(input.value).toBe('456');
});

it('blocks number stepping arrows while leaving typing, caret movement and Tab available', () => {
  renderHook(useManualNumberInputs);
  const input = field();
  input.focus();
  for (const key of ['ArrowUp', 'ArrowDown']) {
    expect(fireEvent.keyDown(input, { key })).toBe(false);
  }
  for (const key of ['4', 'ArrowLeft', 'ArrowRight', 'Tab']) {
    expect(fireEvent.keyDown(input, { key })).toBe(true);
  }
});

it('allows ordinary scrolling and leaves other controls alone', () => {
  renderHook(useManualNumberInputs);
  const input = field();
  expect(wheel(input).defaultPrevented).toBe(false);
  for (const type of ['text', 'date', 'range']) {
    const other = field(type);
    other.focus();
    expect(wheel(other).defaultPrevented).toBe(false);
    expect(fireEvent.keyDown(other, { key: 'ArrowUp' })).toBe(true);
  }
  input.readOnly = true;
  input.focus();
  expect(wheel(input).defaultPrevented).toBe(false);
});

it('removes global listeners on unmount', () => {
  const { unmount } = renderHook(useManualNumberInputs);
  const input = field();
  input.focus();
  unmount();
  expect(wheel(input).defaultPrevented).toBe(false);
  expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(true);
});
