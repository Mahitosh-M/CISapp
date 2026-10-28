export type Role = "DRIVER" | "MANAGER" | "ADMIN";
export type ID = string;
export interface User {
  id: ID;
  name: string;
  role: Role;
  phone: string;
  shopIds: ID[];
  active: boolean;
}
export interface Shop {
  id: ID;
  name: string;
  town: string;
  address: string;
  phone: string;
  lat?: number;
  lng?: number;
  active: boolean;
}
export interface Vehicle {
  id: ID;
  registration: string;
  type: string;
  fuelType: string;
  expectedMileage: number;
  baseline: number;
  homeShopId: ID;
  active: boolean;
}
export interface Customer {
  id: ID;
  externalId: string | null;
  name: string;
  phone: string;
  alternate: string;
  address: string;
  area: string;
  landmark: string;
  pin: string;
  lat?: number;
  lng?: number;
  instructions: string;
  active: boolean;
}
export interface InvoiceReference {
  openingBalance?: boolean;
  id: ID;
  externalId: string | null;
  number: string;
  customerId: ID;
  shopId: ID;
  date: string;
  amount: number;
  outstanding: number;
  due: string;
  notes: string;
}
export type JobStatus =
  | "Pending"
  | "Ready"
  | "Assigned"
  | "Out for delivery"
  | "Partial"
  | "Delivered"
  | "Failed"
  | "Cancelled"
  | "Returned pending";
export interface DeliveryJob {
  purgedAt?: string; deliveredPackages?: number;
  routeId?: string; routeName?: string; routeDays?: number[]; routeStopId?: string | null; routeStopName?: string | null;
  sourceBlocked?: string;
  id: ID;
  invoiceId: ID;
  customerId: ID;
  shopId: ID;
  date: string;
  address: string;
  phone: string;
  packages: number;
  remaining: number;
  description: string;
  instructions: string;
  priority: "Normal" | "High";
  status: JobStatus;
  tripId: ID | null;
  revision: number;
  createdAt: string;
  returnsReconciled: boolean;
}
export interface DeliveryAttempt {
  id: ID;
  jobId: ID;
  tripId: ID;
  actorId: ID;
  at: string;
  outcome: string;
  delivered: number;
  reason: string;
  note: string;
  evidenceId: ID | null;
  location?: string;
}
export type StopKind = "Delivery" | "Collection" | "Sales visit";
export interface Stop {
  id: ID;
  kind: StopKind;
  customerId: ID;
  jobId: ID | null;
  completed: boolean;
  arrivedAt?: string;
}
export interface Trip {
  closedAt?: string; purgedAt?: string;
  routeTemplateId?: string;
  corrections?: {
    id: ID;
    opening: number;
    closing: number;
    note: string;
    actorId: ID;
    at: string;
  }[];
  id: ID;
  name: string;
  date: string;
  startShopId: ID;
  endShopId: ID;
  vehicleId: ID;
  primaryDriverId: ID;
  companionId: ID | null;
  status:
    "Draft" | "Released" | "Active" | "End submitted" | "Closed" | "Cancelled";
  stops: Stop[];
  opening: number | null;
  closing: number | null;
  openingPhoto: ID | null;
  closingPhoto: ID | null;
  openingNote: string;
  endNote: string;
  openingAdvance: number;
  startedAt: string | null;
  endedAt: string | null;
  loaded: boolean;
  returnConfirmed: boolean;
  approvedOdometer: boolean;
  cashReceived: number;
  handoverConfirmed: boolean;
  cashExplanation: string;
  cashReviewedExpected?: number;
  exceptions: string[];
  revision: number;
}
export type CollectionMode = "Cash" | "UPI" | "Bank transfer" | "Credit";
export interface Allocation {
  invoiceId: ID;
  amount: number;
}
export interface Collection {
  id: ID;
  submissionId: ID;
  tripId: ID;
  customerId: ID;
  shopId: ID;
  driverId: ID;
  invoiceIds: ID[];
  amount: number;
  mode: CollectionMode;
  reference: string;
  note: string;
  evidenceId: ID | null;
  status: "Pending" | "Approved" | "Rejected";
  allocations: Allocation[];
  unallocated: number;
  createdAt: string;
  approvedAt: string | null;
  approvalId: ID | null;
  reviewNote: string;
  digitalVerified: boolean;
}
export interface Fuel {
  calculatedAmount?: number;
  roundingAdjustment?: number;
  cashExpenseId?: string;
  cashPostedAt?: string;
  id: ID;
  tripId: ID;
  vehicleId: ID;
  driverId: ID;
  shopId: ID;
  at: string;
  litres: number | null;
  rate: number | null;
  entryMode?: "bill_amount" | "quantity_rate";
  amount: number;
  pump: string;
  odometer: number | null;
  receiptId: ID;
  source: "Shop advance" | "Personal";
  status: "Submitted" | "Approved" | "Rejected" | "Clarification";
  reimbursement: "Not applicable" | "Pending" | "Settled";
  reviewNote: string;
  settledAt: string | null;
  fullTank: boolean;
}
export interface SalesRequest {
  id: ID;
  tripId: ID;
  shopId: ID;
  driverId: ID;
  customerId: ID | null;
  leadName: string;
  phone: string;
  area: string;
  products: string;
  date: string;
  notes: string;
  status:
    | "Submitted"
    | "Under review"
    | "Accepted"
    | "Rejected"
    | "Converted externally";
  decision: string;
  createdAt: string;
}
export interface Audit {
  id: ID;
  entityType: string;
  entityId: ID;
  action: string;
  actorId: ID;
  at: string;
  before: string;
  after: string;
}
export interface OutboxEvent {
  id: ID;
  entityId: ID;
  action: string;
  at: string;
  status: "Saved locally";
}
export interface Evidence {
  tripId?: string;
  id: ID;
  name: string;
  mime: string;
  dataUrl: string;
  actorId: ID;
  at: string;
}
export interface AppState {
  integration?: {
    lastPull: string;
    identityKey: string;
    publishedTripIds: string[];
    conflicts: string[];
    collectionLinks: Record<
      string,
      {
        cloudId: string;
        status: string;
        reviewedAt?: string;
        postedAmount: number;
        receiptIds: string[];
        unallocated: number;
      }
    >;
  };
  id: "main";
  schemaVersion: 2;
  users: User[];
  shops: Shop[];
  vehicles: Vehicle[];
  customers: Customer[];
  invoices: InvoiceReference[];
  jobs: DeliveryJob[];
  attempts: DeliveryAttempt[];
  trips: Trip[];
  collections: Collection[];
  fuels: Fuel[];
  salesRequests: SalesRequest[];
  audit: Audit[];
  outbox: OutboxEvent[];
  settings: { fuelTolerance: number };
  seededAt: string;
}
export interface Snapshot {
  state: AppState;
  evidence: Evidence[];
}
export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const businessDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
export function paise(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error("Enter a positive amount with at most two decimals");
  const [whole, fraction = ""] = text.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n)) throw new Error("Amount is too large");
  return n;
}
export function wholePaise(value: string | number): number {
  const amount = paise(value);
  if (amount % 100 !== 0) throw new Error('Enter a whole rupee amount');
  return amount;
}
export const timestamp = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
export const activeJob = (j: DeliveryJob) =>
  !["Delivered", "Cancelled"].includes(j.status);

// Exact calculation inputs; round only the final bill to a whole rupee.
export function fuelBill(litres: string | number, ratePaise: number): number {
  const product = paise(litres) * ratePaise;
  if (!Number.isSafeInteger(ratePaise) || ratePaise <= 0 || !Number.isSafeInteger(product))
    throw new Error("Invalid fuel quantity or rate");
  return Math.round(product / 10000) * 100;
}
