import type { ShopId, UserProfile, UserRole } from '../types';

export const BRANCH_SYSTEM_VERSION = 1;

export const SHOP_OPTIONS = [
  { id: 'SHOP_A', name: 'ASHOKA' },
  { id: 'SHOP_S', name: 'SMPA' }
] as const satisfies ReadonlyArray<{ id: ShopId; name: string }>;

export type AnalyticsShopScope = 'overall' | ShopId;

interface BranchRecord {
  shopId?: ShopId;
  branchSystemVersion?: number;
}

export interface ShopCashPaymentState extends BranchRecord {
  amount: number;
  paymentKind?: 'receipt' | 'advance_application';
  affectsShopCash?: boolean;
  cashSyncedAmount?: number;
}

export interface ShopCashAdjustment {
  shopId: ShopId;
  amount: number;
}

export interface ShopContributionRow {
  shopId: ShopId;
  name: string;
  sales: number;
  profit: number;
  salesPercent: number;
  profitPercent: number;
}

export const isShopId = (value: unknown): value is ShopId => value === 'SHOP_A' || value === 'SHOP_S';

export const getShopName = (shopId?: ShopId) => {
  return SHOP_OPTIONS.find((shop) => shop.id === shopId)?.name ?? 'Legacy / shared';
};

export const isBranchAwareRecord = (record?: BranchRecord | null): record is BranchRecord & { shopId: ShopId } => {
  return record?.branchSystemVersion === BRANCH_SYSTEM_VERSION && isShopId(record.shopId);
};

export const getAssignedStaffShopId = (profile?: Pick<UserProfile, 'role' | 'shopId'> | null) => {
  return profile?.role === 'Staff' && isShopId(profile.shopId) ? profile.shopId : undefined;
};

export const resolveNewRecordShopId = (
  role: UserRole | undefined,
  profileShopId: ShopId | undefined,
  selectedShopId: ShopId | undefined
) => {
  if (role === 'Staff') return isShopId(profileShopId) ? profileShopId : undefined;
  return isShopId(selectedShopId) ? selectedShopId : undefined;
};

export const filterRecordsForShopScope = <T extends BranchRecord>(records: T[], scope: AnalyticsShopScope) => {
  if (scope === 'overall') return records;
  return records.filter((record) => isBranchAwareRecord(record) && record.shopId === scope);
};

export const getContributionPercent = (part: number, total: number) => {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return undefined;
  return (part / total) * 100;
};

export const buildShopContributionRows = (
  records: Array<BranchRecord & { totalSales: number; totalProfit: number }>
): ShopContributionRow[] => {
  const totalsByShop = new Map<ShopId, { sales: number; profit: number }>(
    SHOP_OPTIONS.map(({ id }) => [id, { sales: 0, profit: 0 }])
  );

  records.forEach((record) => {
    if (!isBranchAwareRecord(record)) return;

    const current = totalsByShop.get(record.shopId) ?? { sales: 0, profit: 0 };
    totalsByShop.set(record.shopId, {
      sales: current.sales + Math.max(0, Number(record.totalSales) || 0),
      profit: current.profit + (Number(record.totalProfit) || 0)
    });
  });

  const totalSales = Array.from(totalsByShop.values()).reduce((sum, row) => sum + row.sales, 0);
  const totalPositiveProfit = Array.from(totalsByShop.values()).reduce((sum, row) => sum + Math.max(0, row.profit), 0);

  return SHOP_OPTIONS.map(({ id, name }) => {
    const totals = totalsByShop.get(id) ?? { sales: 0, profit: 0 };
    return {
      shopId: id,
      name,
      sales: totals.sales,
      profit: totals.profit,
      salesPercent: getContributionPercent(totals.sales, totalSales) ?? 0,
      profitPercent: getContributionPercent(Math.max(0, totals.profit), totalPositiveProfit) ?? 0
    };
  });
};

// V1 treats every real receipt as branch funds. Keeping this policy isolated
// allows payment-mode handling to change later without touching transaction code.
export const shouldPaymentAffectShopCash = (payment: ShopCashPaymentState) => {
  return isBranchAwareRecord(payment)
    && payment.paymentKind !== 'advance_application'
    && payment.affectsShopCash === true;
};

export const getNextCashSyncedAmount = (payment: ShopCashPaymentState) => {
  return shouldPaymentAffectShopCash(payment) && Number.isFinite(payment.amount)
    ? Math.max(0, payment.amount)
    : 0;
};

const getStoredCashEffect = (payment?: ShopCashPaymentState | null) => {
  if (!payment || !isBranchAwareRecord(payment) || !Number.isFinite(payment.cashSyncedAmount)) return undefined;
  const amount = Math.max(0, payment.cashSyncedAmount ?? 0);
  return amount > 0 ? { shopId: payment.shopId, amount } : undefined;
};

// cashSyncedAmount is the immutable baseline for reversing the old effect.
// Payment date is deliberately irrelevant because new entries may be backdated.
export const buildShopCashAdjustments = (
  previousPayment: ShopCashPaymentState | null | undefined,
  nextPayment?: ShopCashPaymentState | null
): ShopCashAdjustment[] => {
  const changes = new Map<ShopId, number>();
  const previousEffect = getStoredCashEffect(previousPayment);

  if (previousEffect) {
    changes.set(previousEffect.shopId, -previousEffect.amount);
  }

  if (nextPayment && isBranchAwareRecord(nextPayment)) {
    const nextAmount = getNextCashSyncedAmount(nextPayment);
    if (nextAmount > 0) {
      changes.set(nextPayment.shopId, (changes.get(nextPayment.shopId) ?? 0) + nextAmount);
    }
  }

  return SHOP_OPTIONS
    .map(({ id }) => ({ shopId: id, amount: changes.get(id) ?? 0 }))
    .filter((adjustment) => adjustment.amount !== 0);
};
