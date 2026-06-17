import { useEffect, useState } from 'react';

const getIsMobile = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
};

export const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(getIsMobile);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handleChange = () => setIsMobile(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
};
