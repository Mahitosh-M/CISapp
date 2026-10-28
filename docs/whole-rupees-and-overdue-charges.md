# Whole rupees and overdue invoice charges

New/edited invoice totals, receipts, cash discounts, expenses, transfers and manual cash adjustments accept whole rupees. Posted history keeps its original amounts. Cash balances round to the nearest whole rupee (half ties away from zero); a separate immutable `cashAdjustments` entry records any difference, atomically with the balance. Reading an initialized fractional Cashapp balance normalizes it once. A rounding adjustment is not customer income or a fuel expense.

## Credit and charges

Existing terms remain authoritative on each invoice. New medical invoices use 15-day credit. Other default tiers are 15, 10, 0 and 0 days, with configured settings applying to future invoices. The late-charge schedule is separate from the saved due date.

The policy starts disabled until an Admin saves it in Settings → Invoice Overdue Charges. Activation must be today or later. Choose one scope explicitly:

- New invoices created from activation onward.
- Existing unpaid invoices from activation: first assessment is the later of day 30 and activation.
- Existing unpaid invoices from their original invoice date: this can assess multiple missed periods. Review before enabling.

Opening balances, void/cancelled records and already-settled invoices are excluded from enrollment. An invoice retains its enrolled schedule when settings later change. Disabling pauses the service; it does not forgive existing assessments or rewrite schedules. Re-enabling can catch up missed periods under enrolled schedules.

At invoice date +30 days, assess 2% of unpaid principal. Every 15 days thereafter assess 1% of unpaid principal plus earlier unpaid charges. Payments and cash discounts dated on/before the assessment date reduce its base. Round the final assessment once to the nearest whole rupee: ₹100 → ₹102 on day 30 → ₹103 on day 45. For ₹1,000 with ₹500 paid before day 30, the first charge is ₹10. The service uses Asia/Kolkata business dates and runs hourly; it catches up missed assessments idempotently in bounded batches.

Each assessment has a deterministic invoice/period identity. The ledger entry, invoice charge total/cursor and customer outstanding increment commit in one transaction. Original sales, costs, profit, receipts and shop cash are unchanged by assessment. Payment allocation and Dispatch projections include assessed charges in collectible outstanding. Customer ledgers show a separate overdue-charge debit and invoice cards show the charge breakdown. Historical date views exclude charges dated later than the view.

Client rules deny assessment/policy mutation. The Admin callable records policy changes in an immutable audit. Charged invoices cannot be deleted; enrolled invoices cannot be moved to another customer/date. Backdated payments or later invoice corrections do not silently reverse an already-posted charge. A charge reversal workflow is not included in this release and requires an explicit audited follow-up.

## Driver diesel

Drivers enter the whole-rupee bill total and attach the actual receipt photograph. Litres/rate are null for these submissions; reviewers inspect the image rather than relying on invented values or OCR. Funding source remains required: no available company advance defaults to personal reimbursement. Personal approval and actual reimbursement settlement are separate. Shop-funded approval or personal reimbursement settlement posts once to the existing Cashapp Fuel ledger. Old quantity/rate records remain readable. New amount-only bills cannot support measured fuel efficiency; reports show insufficient data.

## Release checks

Build all three frontends and Functions. Run unit tests, Firestore rules tests and the late-charge/fuel emulator tests. Emulator tests never modify production records. Verify driver amount/photo capture, manager approval/cash closure, Admin/Staff Fuel history, and reload persistence before releasing. Deploy CISapp Functions + canonical Firestore rules, followed by the three matching Hosting builds. No bulk historical migration is performed.
