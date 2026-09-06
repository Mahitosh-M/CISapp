import type { AppSettings, UserRole } from '../types';
export const canUsePortalOrder = (role: UserRole | null | undefined, settings: Pick<AppSettings, 'turnOnOrder' | 'medicalOrder'>) => {
  if (role === 'Medical') return settings.medicalOrder;
  if (role === 'customer') return settings.turnOnOrder && !settings.medicalOrder;
  return false;
};