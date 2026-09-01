export type CustomerTier = 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';

export type CustomerMovement = 'Promoted' | 'Demoted' | 'Stable' | 'New';

export type RiskLevel = 'Low' | 'Medium' | 'High';

export type OnboardingStage = 'None' | 'Stage A' | 'Stage B' | 'Stage C' | 'Stage D';

export type PaymentMode = 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Card' | 'Other';

export type ShopId = 'SHOP_A' | 'SHOP_S';

export type UserRole = 'Admin' | 'Staff' | 'customer' | 'Medical';

export type CreditStatus = 'starter' | 'active' | 'hold' | 'disabled';

export type CreditLimitApprovalStatus = 'pending_starter' | 'pending_calculated' | 'approved' | 'rejected';

export type GiftPeriod = '1_month' | '3_months' | '6_months' | '1_year' | 'custom';

export type GiftStatus = 'Pending Approval' | 'Approved' | 'Given';

export type GiftItemTargetType = 'profit' | 'sales' | 'score';

export type GiftEligibleTier = CustomerTier | 'All';

export type PartnerLevel = 'Active Partner' | 'Silver Partner' | 'Gold Partner' | 'Platinum Partner';

export type RedemptionStatus = 'Pending' | 'Approved' | 'Rejected' | 'Gifted';

export type OverduePcRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export type BonusPcRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export type BonusPcType = 'monthly_target' | 'clean_payment_month' | 'new_customer' | 'referral';

export type TargetTierKey = 'tier1' | 'tier2' | 'tier3' | 'tier4';

export interface TierTargetSetting {
  monthlySalesTarget: number;
  monthlyOrderTarget: number;
}

export interface LoyaltySettings {
  pointsPerThousand: number;
  monthlyTargetBonus: number;
  cleanPaymentMonthBonus: number;
  newCustomerBonus: number;
  referralBonus: number;
  // Legacy settings are read during migration but no longer generate bonuses.
  onTimePaymentBonus?: number;
  orderFrequencyBonus?: number;
  paymentBonus?: number;
  purchaseTargetBonus?: number;
  partnerLevelThresholds: Record<PartnerLevel, number>;
  rewardBudgetCap: number;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  area: string;
  tier: CustomerTier;
  previousOutstandingAmount: number;
  advanceBalance: number;
  totalOutstandingAmount?: number;
  invoiceOutstandingAmount?: number;
  openingBalanceOutstandingAmount?: number;
  overdueAmount?: number;
  financialSummaryUpdatedAt?: string;
  paymentTerms: string;
  notes: string;
  status?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreditOverride {
  amount: number;
  reason: string;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
}

export interface CustomerCreditProfile {
  id: string;
  customerId: string;
  customerName: string;
  tier: CustomerTier;
  creditDays: number;
  currentOutstanding: number;
  creditHistoryDays: 60 | 90;
  totalCreditInvoiceAmountInLookback: number;
  totalCreditInvoiceAmountLast90Days?: number;
  averageMonthlyCreditSales: number;
  recentMonthlyCompletedCreditSales: number;
  representativeInvoiceValue: number;
  effectiveCycleDays: number;
  baseCreditLimit: number;
  calculatedCreditLimit: number;
  approvedCreditLimit: number;
  availableCredit: number;
  overLimitAmount: number;
  paymentFactor: number;
  historyFactor: number;
  creditPaymentScore: number;
  weightedLateDays: number;
  onTimePaymentPercentage: number;
  completedCreditInvoices: number;
  overdueAmount: number;
  oldestOverdueInvoice?: string;
  oldestOverdueDate?: string;
  oldestOverdueDays: number;
  hasOverdueBeyondGrace: boolean;
  creditStatus: CreditStatus;
  creditLimitApprovalStatus: CreditLimitApprovalStatus;
  nextInvoiceDueDate?: string;
  nextInvoiceDueAmount?: number;
  lastCreditReviewAt: string;
  lastCreditReviewReason?: string;
  manualHold?: boolean;
  manualStarterLimit?: number;
  limitSource: string;
  creditOverride?: CreditOverride;
}

export interface CustomerCreditSummary {
  id: string;
  customerId: string;
  suggestedCreditLimit?: number;
  calculatedCreditLimit?: number;
  approvedCreditLimit?: number;
  availableCredit: number;
  usedCredit: number;
  overLimitAmount: number;
  creditDays: number;
  limitSource?: string;
  oldestOverdueInvoice?: string;
  oldestOverdueDate?: string;
  oldestOverdueDays?: number;
  nextInvoiceDueDate?: string;
  nextInvoiceDueAmount?: number;
  creditStatus: CreditStatus;
  manualHold?: boolean;
  updatedAt: string;
}

export interface CreditAuditLog {
  id: string;
  customerId: string;
  customerName: string;
  action: string;
  adminUid: string;
  timestamp: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  invoiceType?: string;
  recordStatus?: string;
  isOpeningBalance?: boolean;
  date: string;
  dueDate: string;
  pcPolicyVersionAtInvoice?: number;
  tierAtInvoice?: CustomerTier;
  pcPercentageAtInvoice?: number;
  creditDaysAtInvoice?: number;
  bufferDaysAtInvoice?: number;
  savedDueDate?: string;
  finalPcCutoffDate?: string;
  termsEstimated?: boolean;
  salesAmount: number;
  costAmount: number;
  transportAmount: number;
  totalSales: number;
  totalCost: number;
  totalProfit: number;
  notes: string;
  createdAt: string;
  updatedAt?: string;
  shopId?: ShopId;
  branchSystemVersion?: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  date: string;
  pcPolicyVersionAtPayment?: number;
  // amount is the real money received from the customer.
  amount: number;
  // Amount that reduces the selected invoice. Older documents may also track old-balance allocation separately.
  amountAppliedToInvoice: number;
  // Cash left after clearing invoices is stored as advance; advance applications contain no new cash.
  advanceCreatedAmount: number;
  advanceAppliedAmount: number;
  paymentKind?: 'receipt' | 'advance_application';
  amountUsedForOldBalance: number;
  oldBalanceBeforePayment: number;
  oldBalanceAfterPayment: number;
  splitPaymentGroupId?: string;
  splitPaymentTotalAmount?: number;
  splitPaymentPart?: number;
  splitPaymentCount?: number;
  cashDiscount: number;
  mode: PaymentMode;
  notes: string;
  createdAt: string;
  updatedAt?: string;
  shopId?: ShopId;
  branchSystemVersion?: number;
  affectsShopCash?: boolean;
  cashSyncedAmount?: number;
}

export interface DueInvoiceDetail {
  invoiceId: string;
  invoiceNumber: string;
  overdueDays: number;
  amount: number;
}

export interface DueCustomerRow {
  customerId: string;
  customerName: string;
  overdueDays: number;
  amount: number;
  invoices: DueInvoiceDetail[];
}

export interface DueCustomerRecord extends DueCustomerRow {
  id: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  customerId?: string;
  customerName?: string;
  shopId?: ShopId;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface AppSettings {
  id?: string;
  key: 'erpSettings';
  giftPercentages: Record<CustomerTier, number>;
  creditDays: Record<CustomerTier, number>;
  paymentBuffers: Record<CustomerTier, number>;
  scoringWeights: {
    profit: number;
    paymentDiscipline: number;
    frequency: number;
    sales: number;
    loyalty: number;
  };
  highOutstandingThreshold: number;
  fixedMonthlyCosts: number;
  invoicePrefix: string;
  financialYearReset: boolean;
  defaultReportPeriod: 'current_month' | 'last_month' | 'previous_30_days';
  giftPeriodOptions: GiftPeriod[];
  staffPermissions: {
    canViewDashboard: boolean;
  };
  creditPolicy: {
    starterLimitCap: number;
    overdueGraceDays: number;
    lookbackDays: 60 | 90;
  };
  overduePolicy: {
    minorSalesRatioPercent: number;
    seriousSalesRatioPercent: number;
    materialDays: number;
    seriousDays: number;
    seriousInvoiceCount: number;
    repeatedEventCount: number;
  };
  targetSettings: Record<TargetTierKey, TierTargetSetting>;
  loyaltySettings: LoyaltySettings;
  showCustomerTierToCustomer: boolean;
  turnOnOrder: boolean;
  headerOrder: boolean;
  down: boolean;
  customerDown: boolean;
  updatedAt?: string;
}

export interface Offer {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  imagePath?: string;
  levelRequired?: PartnerLevel;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: string;
  createdBy?: string;
  updatedAt?: string;
}

export interface OfferFormData {
  title: string;
  description: string;
  imageUrl: string;
  imagePath?: string;
  levelRequired: PartnerLevel;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface GiftItem {
  id: string;
  giftItemName: string;
  // Current simplified gift rule: targetValue is the maximum PC points needed
  // before this item can be suggested. Legacy fields remain optional for old docs.
  targetType?: GiftItemTargetType;
  targetValue: number;
  minBudget?: number;
  maxBudget?: number;
  eligibleTier?: GiftEligibleTier;
  notes: string;
  isActive: boolean;
  imageUrl?: string;
  imagePath?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface GiftItemFormData {
  giftItemName: string;
  targetValue: number;
  notes: string;
  isActive: boolean;
}

export interface GiftHistory {
  id: string;
  customerId: string;
  customerName: string;
  tier: CustomerTier;
  tierAtGiftTime: CustomerTier;
  periodType: GiftPeriod;
  periodStart: string;
  periodEnd: string;
  salesAmount: number;
  profitConsidered: number;
  giftPercentage: number;
  giftAmount: number;
  suggestedGiftBudget: number;
  actualGiftAmount: number;
  giftItem: string;
  selectedGiftItemName?: string;
  suggestedGiftOptions?: string[];
  giftBudget?: number;
  giftedDate: string;
  giftGivenDate: string;
  giftedBy: string;
  approvedBy: string;
  status: GiftStatus;
  notes: string;
  createdAt: string;
  updatedAt?: string;
}

export interface GiftHistoryFormData {
  customerId: string;
  customerName: string;
  tier: CustomerTier;
  tierAtGiftTime: CustomerTier;
  periodType: GiftPeriod;
  periodStart: string;
  periodEnd: string;
  salesAmount: number;
  profitConsidered: number;
  giftPercentage: number;
  giftAmount: number;
  suggestedGiftBudget: number;
  actualGiftAmount: number;
  giftItem: string;
  selectedGiftItemName?: string;
  suggestedGiftOptions?: string[];
  giftBudget?: number;
  giftedDate: string;
  giftGivenDate: string;
  giftedBy: string;
  approvedBy: string;
  status: GiftStatus;
  notes: string;
}

export interface OverdueInvoiceRisk {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  tier: CustomerTier;
  invoiceDate: string;
  dueDate: string;
  effectiveDueDate: string;
  totalSales: number;
  paidAmount: number;
  overdueAmount: number;
  overdueDays: number;
  severity: 'green' | 'yellow' | 'red';
}

export interface CustomerFormData {
  name: string;
  mobile: string;
  area: string;
  tier: CustomerTier;
  paymentTerms: string;
  notes: string;
  previousOutstandingAmount: number;
  status?: string;
}

export interface InvoiceFormData {
  customerId: string;
  customerName: string;
  date: string;
  dueDate: string;
  salesAmount: number;
  costAmount: number;
  transportAmount: number;
  totalSales: number;
  totalCost: number;
  totalProfit: number;
  notes: string;
  shopId?: ShopId;
  branchSystemVersion?: number;
}

export interface PaymentFormData {
  customerId: string;
  customerName: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  amount: number;
  amountAppliedToInvoice?: number;
  cashDiscount: number;
  splitPaymentGroupId?: string;
  splitPaymentTotalAmount?: number;
  splitPaymentPart?: number;
  splitPaymentCount?: number;
  mode: PaymentMode;
  notes: string;
  shopId?: ShopId;
  branchSystemVersion?: number;
  affectsShopCash?: boolean;
  cashSyncedAmount?: number;
}

export interface ScoreBreakdownItem {
  key: 'profit' | 'paymentDiscipline' | 'frequency' | 'sales' | 'loyalty';
  label: string;
  score: number;
  weight: number;
  weightedScore: number;
  description: string;
  targetValue?: number;
  actualValue?: number;
  achievementPercent?: number;
}

export interface TierCreditPolicy {
  tier: CustomerTier;
  creditDays: number;
  bufferDays: number;
  label: string;
  description: string;
}

export interface CustomerScore {
  customerId: string;
  customerName: string;
  customerArea: string;
  customerMobile: string;
  tier: CustomerTier;
  storedTier: CustomerTier;
  creditDays: number;
  creditBufferDays: number;
  creditPolicyLabel: string;
  totalSales: number;
  totalProfit: number;
  totalPayments: number;
  outstanding: number;
  invoiceCount: number;
  averageOrderValue: number;
  monthlySalesTarget: number;
  customerMonthlySales: number;
  salesTargetAchievement: number;
  monthlyOrderTarget: number;
  customerMonthlyOrders: number;
  orderTargetAchievement: number;
  insights: string[];
  frequencyScore: number;
  paymentDisciplineScore: number;
  salesScore: number;
  profitScore: number;
  loyaltyScore: number;
  intelligenceScore: number;
  giftBudget: number;
  rank: number;
  previousRank?: number;
  previousScore?: number;
  previousTier?: CustomerTier;
  movement: CustomerMovement;
  movementReason: string;
  riskLevel: RiskLevel;
  recommendedAction: string;
  overdueStatus: string;
  tierCapReason?: string;
  isOnboarding: boolean;
  onboardingStage: OnboardingStage;
  confidenceFactor: number;
  scoreBreakdown: ScoreBreakdownItem[];
}

export interface CustomerIntelligenceSummary extends CustomerScore {
  id: string;
  calculatedAt: string;
}

export interface CustomerMonthlySnapshot {
  id: string;
  customerId: string;
  month: string;
  totalSales: number;
  totalProfit: number;
  invoiceCount: number;
  paymentsReceived: number;
  needsBackfill: boolean;
  updatedAt: string;
}

export interface BusinessMonthlySnapshot {
  id: string;
  month: string;
  totalSales: number;
  totalProfit: number;
  invoiceCount: number;
  paymentsReceived: number;
  needsBackfill: boolean;
  updatedAt: string;
}

export interface MonthlyRankingRow {
  customerId: string;
  customerName: string;
  customerArea: string;
  rank: number;
  tier: CustomerTier;
  intelligenceScore: number;
  totalSales: number;
  totalProfit: number;
  giftBudget: number;
}

export interface MonthlyRankingGroup {
  monthKey: string;
  monthLabel: string;
  periodLabel: string;
  rankings: MonthlyRankingRow[];
}

export interface MonthlyCustomerStats {
  id: string;
  customerId: string;
  month: string;
  totalSales: number;
  totalProfit?: number;
  totalPayments: number;
  orderCount: number;
  overdueAmount: number;
  target: number;
  basePcEarned?: number;
  bonusPcEarned?: number;
  availablePc?: number;
  salesTarget?: number;
  profitTarget?: number;
  frequencyTarget?: number;
  paymentScore?: number;
  profitScore?: number;
  frequencyScore?: number;
  salesScore?: number;
  loyaltyScore?: number;
  rollingScore?: number;
  calculatedTier?: CustomerTier;
  finalTier?: CustomerTier;
  tierCapReason?: string;
  isOnboarding?: boolean;
  onboardingStage?: OnboardingStage;
  confidenceFactor?: number;
  pointsEarned: number;
  currentLevel: PartnerLevel;
  progressPercent: number;
  updatedAt: string;
}

export interface CustomerApcSummary {
  currentLevel: PartnerLevel;
  apcBalance: number;
  monthlyApcEarned: number;
  progressPercent: number;
  nextLevel?: PartnerLevel;
  pointsNeededForNextLevel: number;
  pointsNeededForNextReward: number;
  rewardAvailable: boolean;
}

export interface LoyaltyLedgerEntry {
  id: string;
  customerId: string;
  type: 'purchase' | 'on_time_payment' | 'monthly_target' | 'order_frequency' | 'overdue_payment' | 'bonus' | 'redemption' | 'opening_balance' | 'manual_adjustment' | 'redemption_reversal';
  points: number;
  reason: string;
  referenceId: string;
  month: string;
  createdAt: string;
}

export interface PcBalanceRecord {
  id: string;
  customerId: string;
  availablePc: number;
  incomingPc: number;
  redeemedPc: number;
  protectedAt: string;
  lastAwardReferenceId?: string;
  lastMutationReferenceId?: string;
  updatedAt: string;
}

export interface OverduePcRequest {
  id: string;
  customerId: string;
  customerName: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  fullPaymentDate: string;
  overdueDays: number;
  invoiceAmount: number;
  suggestedCoins: number;
  approvedCoins: number;
  status: OverduePcRequestStatus;
  generatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  notes?: string;
}

export interface BonusPcRequest {
  id: string;
  customerId: string;
  customerName: string;
  bonusType: BonusPcType;
  bonusLabel: string;
  triggerType: string;
  referenceId: string;
  suggestedCoins: number;
  approvedCoins: number;
  status: BonusPcRequestStatus;
  generatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  customerSeenAt?: string;
  notes?: string;
}

export interface RewardItem {
  id: string;
  name: string;
  requiredPoints: number;
  levelRequired: PartnerLevel;
  isActive: boolean;
  description?: string;
  imageUrl?: string;
  imagePath?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface RewardFormData {
  name: string;
  requiredPoints: number;
  levelRequired: PartnerLevel;
  isActive: boolean;
  description: string;
  imageUrl: string;
  imagePath?: string;
}

export interface RedemptionRequest {
  id: string;
  customerId: string;
  customerName: string;
  rewardId: string;
  rewardName: string;
  points: number;
  status: RedemptionStatus;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  notes?: string;
}

export interface IntelligenceSummary {
  totalSales: number;
  totalProfit: number;
  totalPayments: number;
  outstanding: number;
  customerCount: number;
  averageScore: number;
  giftBudget: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  tier4Count: number;
  riskCustomerCount: number;
}
