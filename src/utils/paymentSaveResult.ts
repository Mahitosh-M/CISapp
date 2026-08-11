export interface PaymentSaveResultLike {
  pcAwards: Array<{
    status: string;
    points: number;
    availablePc?: number;
  }>;
  warnings: Array<{
    message: string;
  }>;
}

export interface PaymentSaveSummary {
  creditedPc: number;
  availablePc?: number;
  warnings: string[];
}

export const summarizePaymentSaveResults = (
  results: PaymentSaveResultLike[]
): PaymentSaveSummary => {
  const creditedAwards = results.flatMap((result) => result.pcAwards)
    .filter((award) => award.status === 'credited');
  const latestConfirmedBalance = [...creditedAwards]
    .reverse()
    .find((award) => award.availablePc !== undefined)?.availablePc;

  return {
    creditedPc: creditedAwards.reduce((sum, award) => sum + Math.max(0, award.points), 0),
    availablePc: latestConfirmedBalance,
    warnings: [...new Set(results.flatMap((result) => result.warnings.map((warning) => warning.message)))]
  };
};
