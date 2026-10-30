# Separate Medical customer policies

This release adds separate Medical customer policies and theme-matched invoice overdue-charge controls. No production settings, existing invoices or posted PC are migrated by deployment. Unfinished smart-route work is excluded.

## Admin workflow

Open **Settings → Medical Customer Settings**. Medical customers now have independent:

- Credit days by Partner Level (default **15 days for every tier**).
- Invoice PC percentage by tier, applied to invoice profit using the existing PC formula.
- PC buffer days by tier.
- Provisional starter credit cap (up to the existing ₹10,000 safety ceiling).
- Monthly sales and order targets by tier.
- Monthly-target, clean-payment-month, new-customer and referral bonus PC amounts.
- Overdue credit-risk thresholds used by credit scoring/holds.

These values are stored under `settings.medicalSettings`. Changing them does not change the normal customer policy fields. Defaults are independently copied from the original policy where applicable; Medical values do not silently inherit subsequent normal-customer edits. Normal invoice PC percentages and fixed bonus policy remain unchanged.

After saving, reload an already-open invoice/customer screen to obtain the latest settings. Credit recommendations refresh through the existing review/recalculation workflow; changing settings does not post transactions or change invoice balances.

## Invoice behavior

Selecting a Medical customer or changing the invoice date prefills the due date using that Medical tier's credit days. With default settings, an invoice dated **1 November 2026** prefills **16 November 2026**. A normal Tier 4 customer retains its normal same-day default.

A manually supplied due date remains an explicit override. Opening-balance records keep their existing special handling. New invoices snapshot the category-specific PC percentage, credit days and buffer. Existing saved invoice terms and earned/posted PC are preserved; incorrectly dated older invoices are not mass-rewritten by this change.

Customer edit labels, intelligence summaries, credit calculations, gift previews and portal Partner Level benefits now use Medical rules for Medical customer records. Medical targets feed the Medical sales/order score, tier purchase gates and portal progress. The existing onboarding, payment-discipline and hold safeguards remain in effect.

## Bonus integrity

New Medical bonus requests save their amount plus `policyCategory: medical` and the source settings document ID. Approval uses the saved request amount. If a request was generated for **7 PC**, changing the setting to **20 PC** does not change that request; future qualifying requests use the new amount. Zero disables new requests for that Medical bonus type. Existing request IDs, one-time welcome/referral guards, immutable ledger IDs and atomic PC balance updates are reused.

Firestore Rules enforce Medical category and configured amount at creation, then preserve the request's policy and amount during review. A normal customer cannot use the Medical configured rate. Repeated approval/ledger writes cannot credit the same award twice. Normal legacy requests retain their original fixed amounts.

The active Medical bonus amounts and monthly targets are separate as requested. Global business costs, technical scoring weights, invoice numbering and order-login controls remain their existing application-wide settings. Overdue **credit risk** is distinct from overdue **charges**: this change does not alter the December charge policy, payment allocation, cash reconciliation or Cashapp posting.

## Verification

- CISapp build and Functions TypeScript build: passed.
- Ordinary CISapp tests: **164 passed**, including Medical default dates, category isolation, PC/credit snapshots, Medical targets/bonuses and starter cap validation.
- Cross-app React component checks: **6 passed**, including real invoice form selection/date changes and Admin Medical settings saves while normal settings remain unchanged.
- Firestore security/financial checks: **62 passed in the isolated release**. The Medical test additionally verifies a saved 7-PC bonus posts once to the PC ledger and balance after settings change, and rejects a duplicate credit.
- Backend Firestore/Auth workflow checks: passed for existing collection posting, customer credit/PC, cash integration and account lifecycle.

Release the frontend, Medical-aware Dispatch Functions and Firestore Rules together. No credentials or migration are needed to read legacy settings: missing Medical configuration receives independent defaults. Do not remove request policy metadata when rolling code back; retain awarded history and review compatible rules first.
