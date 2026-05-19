export type CustomerTier = 'Tier 1' | 'Tier 2' | 'Tier 3';

export type CustomerMovement = 'Promoted' | 'Demoted' | 'Stable' | 'New';

export type RiskLevel = 'Low' | 'Medium' | 'High';

export type PaymentMode = 'Cash' | 'UPI' | 'Bank Transfer' | 'Cheque' | 'Card' | 'Other';

export type UserRole = 'Admin' | 'Staff';

export type GiftPeriod = '3_months' | '6_months' | '1_year';

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  area: string;
  tier: CustomerTier;
  paymentTerms: string;
  notes: string;
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
  amount: number;
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
  updatedAt?: string;
}

export interface GiftHistory {
  id: string;
  customerId: string;
  customerName: string;
  tier: CustomerTier;
  periodType: GiftPeriod;
  periodStart: string;
  periodEnd: string;
  salesAmount: number;
  giftPercentage: number;
  giftAmount: number;
  giftedDate: string;
  giftedBy: string;
  notes: string;
  createdAt: string;
  updatedAt?: string;
}

export interface GiftHistoryFormData {
  customerId: string;
  customerName: string;
  tier: CustomerTier;
  periodType: GiftPeriod;
  periodStart: string;
  periodEnd: string;
  salesAmount: number;
  giftPercentage: number;
  giftAmount: number;
  giftedDate: string;
  giftedBy: string;
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
