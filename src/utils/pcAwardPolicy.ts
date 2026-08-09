export const LEGACY_PC_POLICY_VERSION = 0;
export const PC_POLICY_VERSION_1 = 1;
export const CURRENT_PC_POLICY_VERSION = PC_POLICY_VERSION_1;

const getStoredPolicyVersion = (version: unknown) => {
  return typeof version === 'number' && Number.isInteger(version) && version >= 0
    ? version
    : LEGACY_PC_POLICY_VERSION;
};

export const getInvoicePcPolicyVersion = (invoice: { pcPolicyVersionAtInvoice?: number }) => (
  getStoredPolicyVersion(invoice.pcPolicyVersionAtInvoice)
);

export const getPaymentPcPolicyVersion = (payment?: { pcPolicyVersionAtPayment?: number }) => (
  getStoredPolicyVersion(payment?.pcPolicyVersionAtPayment)
);

export const canPostInvoicePcForSettlement = (
  invoice: { pcPolicyVersionAtInvoice?: number },
  settlementPayment: { pcPolicyVersionAtPayment?: number; createdAt?: string } | undefined,
  protectedAt = ''
) => {
  const isVersionedTransaction = getInvoicePcPolicyVersion(invoice) > LEGACY_PC_POLICY_VERSION
    || getPaymentPcPolicyVersion(settlementPayment) > LEGACY_PC_POLICY_VERSION;

  if (isVersionedTransaction) return true;

  // protectedAt is the one-time recovery boundary. Only a payment document
  // genuinely created after it can add an award for a legacy invoice.
  const settlementCreatedAt = settlementPayment?.createdAt?.trim() || '';
  return Boolean(protectedAt && settlementCreatedAt && settlementCreatedAt > protectedAt);
};

export type ImmutableInvoicePcDecision =
  | { action: 'keep'; awardedPoints: number; pointsToAdd: 0 }
  | { action: 'award'; awardedPoints: number; pointsToAdd: number }
  | { action: 'finalize'; awardedPoints: 0; pointsToAdd: 0 };

const normalizePoints = (points: unknown) => {
  const numericPoints = typeof points === 'number' && Number.isFinite(points) ? points : 0;
  return Math.max(0, Math.round(numericPoints));
};

export const decideImmutableInvoicePcAward = (
  ledgerExists: boolean,
  existingPoints: unknown,
  calculatedPoints: unknown
): ImmutableInvoicePcDecision => {
  if (ledgerExists) {
    return { action: 'keep', awardedPoints: normalizePoints(existingPoints), pointsToAdd: 0 };
  }

  const pointsToAdd = normalizePoints(calculatedPoints);
  return pointsToAdd > 0
    ? { action: 'award', awardedPoints: pointsToAdd, pointsToAdd }
    : { action: 'finalize', awardedPoints: 0, pointsToAdd: 0 };
};
