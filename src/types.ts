export type CustomerTier = 'Tier 1' | 'Tier 2' | 'Tier 3';

export type CustomerMovement = 'Promoted' | 'Demoted' | 'Stable' | 'New';

export type RiskLevel = 'Low' | 'Medium' | 'High';

export type PaymentMode = 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Card' | 'Other';

export type UserRole = 'Admin' | 'Staff' | 'customer';

export type GiftPeriod = '1_month' | '3_months' | '6_months' | '1_year' | 'custom';

export type GiftStatus = 'Pending Approval' | 'Approved' | 'Given';

export type GiftItemTargetType = 'profit' | 'sales' | 'score';

export type GiftEligibleTier = CustomerTier | 'All';

export type AlertStatus = 'Open' | 'Reviewed' | 'Resolved';

export type AlertSeverity = 'Low' | 'Medium' | 'High';

export type AlertType =
  | 'overdue_payment'
  | 'high_outstanding'
  | 'negative_profit'
  | 'inactive_customer'
  | 'gift_pending'
  | 'tier_downgrade_risk'
  | 'automatic_tier_change'
  | 'tier3_credit_warning';

export type TargetTierKey = 'tier1' | 'tier2' | 'tier3';

export interface TierTargetSetting {
  monthlySalesTarget: number;
  monthlyOrderTarget: number;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  area: string;
  tier: CustomerTier;
  tierOverride?: boolean;
  previousOutstandingAmount: number;
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
  // Only this part of amount reduces the selected invoice after old balance is cleared first.
  amountAppliedToInvoice: number;
  amountUsedForOldBalance: number;
  oldBalanceBeforePayment: number;
  oldBalanceAfterPayment: number;
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
  invoicePrefix: string;
  financialYearReset: boolean;
  defaultReportPeriod: 'current_month' | 'last_month' | 'previous_30_days';
  giftPeriodOptions: GiftPeriod[];
  staffPermissions: {
    canViewReports: boolean;
    canViewDashboard: boolean;
  };
  targetSettings: Record<TargetTierKey, TierTargetSetting>;
  showCustomerTierToCustomer: boolean;
  updatedAt?: string;
}

export interface Offer {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  imagePath?: string;
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
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface GiftItem {
  id: string;
  giftItemName: string;
  // Current simplified gift rule: targetValue is the maximum gift budget needed
  // before this item can be suggested. Legacy fields remain optional for old docs.
  targetType?: GiftItemTargetType;
  targetValue: number;
  minBudget?: number;
  maxBudget?: number;
  eligibleTier?: GiftEligibleTier;
  notes: string;
  isActive: boolean;
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

export interface OverdueInvoiceAlert {
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
  tierOverride?: boolean;
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
  cashDiscount: number;
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
  scoreBreakdown: ScoreBreakdownItem[];
}

export interface Alert {
  id: string;
  uniqueKey: string;
  customerId: string;
  customerName: string;
  invoiceId?: string;
  invoiceNumber?: string;
  alertType: AlertType;
  severity: AlertSeverity;
  date: string;
  status: AlertStatus;
  actionRequired: string;
  message: string;
  createdAt: string;
  updatedAt?: string;
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
  riskCustomerCount: number;
}
