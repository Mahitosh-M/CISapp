import { useEffect } from 'react';

// Keep native number validation and mobile keyboards, but change values only by typing.
export const useManualNumberInputs = () => {
  useEffect(() => {
    const editableNumber = (target: EventTarget | null): target is HTMLInputElement =>
      target instanceof HTMLInputElement && target.type === 'number' && !target.readOnly && !target.disabled;

    const preventWheelStep = (event: WheelEvent) => {
      if (editableNumber(event.target) && event.target === document.activeElement) {
        event.preventDefault();
      }
    };
    const preventArrowStep = (event: KeyboardEvent) => {
      if (editableNumber(event.target) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
      }
    };

    document.addEventListener('wheel', preventWheelStep, { capture: true, passive: false });
    document.addEventListener('keydown', preventArrowStep, true);
    return () => {
      document.removeEventListener('wheel', preventWheelStep, true);
      document.removeEventListener('keydown', preventArrowStep, true);
    };
  }, []);
};
