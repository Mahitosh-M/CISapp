export type CustomerTier = 'Tier 1' | 'Tier 2' | 'Tier 3' | 'Tier 4';

export type CustomerMovement = 'Promoted' | 'Demoted' | 'Stable' | 'New';

export type RiskLevel = 'Low' | 'Medium' | 'High';

export type OnboardingStage = 'None' | 'Stage A' | 'Stage B' | 'Stage C' | 'Stage D';

export type PaymentMode = 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Card' | 'Other';

export type UserRole = 'Admin' | 'Staff' | 'customer';

export type GiftPeriod = '1_month' | '3_months' | '6_months' | '1_year' | 'custom';

export type GiftStatus = 'Pending Approval' | 'Approved' | 'Given';

export type GiftItemTargetType = 'profit' | 'sales' | 'score';

export type GiftEligibleTier = CustomerTier | 'All';

export type PartnerLevel = 'Active Partner' | 'Silver Partner' | 'Gold Partner' | 'Platinum Partner';

export type RedemptionStatus = 'Pending' | 'Approved' | 'Rejected' | 'Gifted';

export type OverduePcRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export type BonusPcRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export type BonusPcType = 'new_customer' | 'payment' | 'purchase_target' | 'referral';

export type TargetTierKey = 'tier1' | 'tier2' | 'tier3' | 'tier4';

export interface TierTargetSetting {
  monthlySalesTarget: number;
  monthlyOrderTarget: number;
}

export interface LoyaltySettings {
  pointsPerThousand: number;
  onTimePaymentBonus: number;
  monthlyTargetBonus: number;
  orderFrequencyBonus: number;
  newCustomerBonus: number;
  paymentBonus: number;
  purchaseTargetBonus: number;
  referralBonus: number;
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

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  invoiceType?: string;
  isOpeningBalance?: boolean;
  date: string;
  dueDate: string;
  salesAmount: number;
  costAmount: number;
  transportAmount: number;
  totalSales: number;
  totalCost: number;
  totalProfit: number;
  notes: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  date: string;
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
}

export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  customerId?: string;
  customerName?: string;
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
    canViewReports: boolean;
    canViewDashboard: boolean;
  };
  targetSettings: Record<TargetTierKey, TierTargetSetting>;
  loyaltySettings: LoyaltySettings;
  showCustomerTierToCustomer: boolean;
  turnOnOrder: boolean;
  headerOrder: boolean;
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

export interface MonthlyRankingRow {
  customerId: string;
  customerName: string;
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
  type: 'purchase' | 'on_time_payment' | 'monthly_target' | 'order_frequency' | 'overdue_payment' | 'bonus' | 'redemption';
  points: number;
  reason: string;
  referenceId: string;
  month: string;
  createdAt: string;
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
