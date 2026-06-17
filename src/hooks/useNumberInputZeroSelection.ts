import { useEffect } from 'react';

const selectDefaultZero = (target: EventTarget | null) => {
  if (!(target instanceof HTMLInputElement)) return;
  if (target.type !== 'number' || target.value !== '0') return;

  requestAnimationFrame(() => {
    target.select();
  });
};

export const useNumberInputZeroSelection = () => {
  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      selectDefaultZero(event.target);
    };

    const handleMouseUp = (event: MouseEvent) => {
      selectDefaultZero(event.target);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);
};
