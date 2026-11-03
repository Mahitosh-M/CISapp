# Medical combined invoice rewards — development only

Implemented in D:/DELIVERY/.release/cisapp on dev-smart-routes. No merge, remote push, deployment, live-data migration or historical-record update was performed.

## Behavior and policy

- Only the stored customer type medical shows TROIKAA Coins. Other customer types hide it and clear an unsaved proposal. Products and quantities do not affect eligibility.
- Existing Staff sales, cost and transport entry remains as authorised. The TROIKAA panel and its quote response show only derived coin limits, entitlement, final reward and validation; no raw profit/cost/margin is returned by the new quote endpoint.
- Admin → Settings → Medical Customer Settings adds Maximum Combined Reward Percentage, default 8. Existing Settings persistence is reused. New settings accept whole percentages from 0 to 100, provided the ceiling covers every configured Medical level rate. Legacy saved invoice percentage snapshots remain valid and unchanged. No level rates are changed by this feature.
- Existing PC/gift accounting uses one PC per rupee of reward budget. This feature reuses that representation; there is no new wallet, exchange-rate setting or cash conversion.
- Positive profit is the existing sales minus cost minus transport calculation. The maximum whole coins is floor(positive profit × configured maximum / 100), computed using decimal rational arithmetic.
- Manual coins propose a TOTAL. The reward budget is max(existing normal reward budget, manual proposal), followed by the existing payment-retention and settlement formula. There is one existing invoice PC ledger ID and one balance mutation, never two awards.
- The original normal budget is snapshotted without whole-coin rounding before payment weighting, preserving normal reward qualification behavior when the proposal is lower or absent.
- Proposals over the ceiling, negative/fractional/non-finite coins and non-Medical promotional data are rejected. Changes in invoice amounts refresh the quote. Save-time Firestore validation independently checks the financial inputs, customer type, configured/saved rates, snapshot and final total.

## History and confirmation

The existing workflow has no separate persisted draft/confirm stage. The unsaved form is unconfirmed and uses current settings; a successful invoice save is the confirmation boundary. New Medical invoices save their policy. Subsequent settings edits do not change saved policy percentages. Editing an unpaid new invoice recalculates its reward using that saved policy. A customer reassignment before posting uses the destination customer's current policy, consistent with existing invoice term reassignment.

Historical invoices without medicalReward stay on the original PC calculation and cannot be retrofitted with promotional metadata. The Medical button remains visible but explains that the historical reward is protected. No record is backfilled. Posted ledger entries remain immutable through existing edits/deletions; automatic cancellation/return/credit-note reward reversals are deliberately not introduced, following the user's instruction to retain the existing accounting behavior.

One mathematical edge case requires review: the existing normal entitlement can round up to one whole PC while a tight financial ceiling floors down to zero. New affected invoices are rejected with a specific message asking Admin to increase the cap; the feature neither reduces the normal entitlement nor exceeds the financial ceiling. This does not touch old records.

## Additive storage and backend

- Existing settings document: medicalSettings.maximumCombinedRewardPercentage. Missing legacy setting defaults to 8 without writing a migration.
- New Medical invoices: optional medicalReward map with version, manualTroikaaCoins, maximumPercentage, levelPercentage, maximumAllowedCoins, levelRewardCoins, normalRewardValue, finalCombinedRewardCoins and settingsId. normalRewardValue is the original reward budget, not invoice profit.
- Existing pcBalances and loyaltyLedger collections and customer_invoice_invoice_pc identity are reused. No new financial collection, wallet, index or database migration.
- quoteMedicalInvoiceReward: active Admin/Staff, shop scope for an existing invoice, authoritative customer-type lookup, current or saved policy, strictly derived response. Inputs reuse the authorised existing cost-entry workflow.
- postMedicalInvoiceReward: transactionally rereads invoice, payments, existing ledger and balance, applies the same qualification/protection policy, creates the same single immutable ledger entry and updates the same balance. Repeated/concurrent verification returns the existing award.
- Firestore Rules validate both creates and updates, protect saved percentage snapshots and posted proposals, use the after-state for atomic eligibility changes, and deny direct client posting of combined Medical awards. The trusted existing Dispatch settlement path shares the calculator and ledger identity.
- Settings writes remain Admin-only. The pre-existing Settings service has no general settings-change audit stream; this feature does not add one. Settings keep their existing updatedAt metadata.

## Changed files

UI: src/pages/Invoices.tsx; src/components/TroikaaCoins.tsx; src/components/TroikaaCoins.css; src/components/MedicalSettingsEditor.tsx.

Policy/data: src/types.ts; src/utils/settings.ts; src/utils/medicalReward.ts; src/utils/medicalRewardContract.ts; src/utils/customerPortal.ts; src/utils/financialDocuments.ts; src/services/medicalRewardService.ts; src/services/firestoreService.ts.

Backend: functions/src/medicalRewards.ts; functions/src/index.ts; firestore.rules.

Tests: src/utils/medicalReward.test.ts; src/components/TroikaaCoins.test.tsx; src/pages/Invoices.medicalReward.test.tsx; src/services/medicalRewardRules.test.ts; functions/src/medicalRewards.emulator.test.ts.

Development-only component-test dependencies: package.json and package-lock.json. Existing route dependencies and edits were retained.

## Local verification and manual review

Application build: npm.cmd run build. Backend build: npm.cmd --prefix functions run build.

Tests: npm.cmd test runs ordinary tests; emulator-only tests are skipped outside an emulator. Run the three security suites against a local demo Firestore emulator with --hookTimeout 60000 --maxWorkers 1. Run the compiled medicalRewards.emulator.test.js against that same local emulator to verify concurrent posting and preserved history. The full application suite can also run inside emulators:exec so those security checks execute rather than skip.

The new callable endpoints are not deployed. A frontend pointed at production will not have them. For a dedicated local emulator preview, the reward client supports VITE_FUNCTIONS_EMULATOR_URL=http://127.0.0.1:5001; the surrounding app's Auth/Firestore session must also be configured for a local demo target before creating test invoices. Never seed tests into the production database.

Manual checks: select Medical, enter sales/cost/transport, open TROIKAA Coins, try lower/equal/above-cap totals, change the financial inputs, change to a normal customer, then inspect the Admin maximum setting. Example with profit 2000, saved level 2%, maximum 8%: proposals 20/100/160 produce one provisional entitlement of 40/100/160; 200 is rejected. Test payment posting in the emulator, not production. Historical rewards and non-Medical calculations stay on their existing path.

## Results executed 3 November 2026

- Final frontend production build: passed.
- Final Functions TypeScript build: passed.
- Complete application suite inside the isolated demo Firestore emulator: 306 passed across 38 files, with no skips. This includes 229 ordinary application/UI tests and 77 security tests (60 existing PC/cash, 3 Dispatch isolation, 14 Medical reward rules).
- Backend emulator and date-policy verification: 5 tests passed, covering customer-only charge enrollment/assessment/reopening, preservation of existing Medical charges, December dates, and the trusted quote and concurrent/idempotent settlement workflow, including 4 concurrent verification requests, one 160-PC wallet increment, saved-cap preservation, customer reassignment, cross-shop denial and historical-record preservation.
- git diff --check: passed.
- Release checkout remained clean on release/medical-settings-theme; development HEAD remained 8c2f1b7. No commit, remote push, main merge or deployment.

The first emulator attempt exposed a new rule syntax error, which was corrected. A subsequent parallel Dispatch hook timed out; the final complete run used one worker and a 60-second hook limit and passed.

## Customer portal and invoice refinements

- Medical Offers omit both Grow your partnership and Benefits at every level. Actual promotions remain visible. Regular customers open those sections using separate buttons; their transaction data loads once per authenticated session and is cleared on logout. One load may read multiple Firestore documents; it is not a claim of one billable document read.
- Customer Home is removed from navigation and the customer index redirects to Dashboard. Medical customers have a Ledger page with total outstanding in large red text, four centered month buttons in two columns (current month and the previous three calendar months), and an invoice/payment table with the current month newest first and previous months in chronological order. A single Amount column displays invoice amounts in blue and payments in green; the running outstanding after each row is red. The table uses a black background with white labels. Opening/closing balances, separate invoice/payment counts, grouped split receipts, discounts and advance labels preserve the existing accounting. The Medical dashboard no longer shows the old outstanding history panel.
- Staff invoice history displays expected PC instead of Cost, using saved invoice terms. Existing Staff cost entry remains. TROIKAA Coins uses a numeric text input so mouse-wheel scrolling cannot change it.
- Medical settings and charge settings omit their explanatory copy. Maximum Combined Reward is a whole-number input.
- Future overdue invoice charges enroll and assess regular customers only. Medical customers and saved Medical invoice markers are excluded; existing assessed charges and financial history are preserved. These backend changes remain local until an explicitly authorized deployment.

## Shared Staff/Admin customer modes

Customers, Invoices, Payments and Delivery have a top-left Medical switch. Initial mode is Customers. Entering Medical is immediate; returning to Customers opens a masked password dialog and requires the requested switch PIN 1122. This is a local screen-switch check; Firebase authentication and existing server permissions are unchanged. The selected mode is stored per user in session storage across navigation/reloads and cleared on logout. Admin-only pages and Staff-only Collections keep their existing scope.

The four shared pages filter customer lists, searches, selectors, invoice/payment histories, customer-ledger and branch tools, and delivery requests/collection reviews using the current stored customer type. Missing legacy customer types remain regular customers; unrelated orphan transactions are not displayed. New records use the selected mode's customer type. A mode change remounts the current shared page to clear drafts, selections and previously loaded rows. Filtering happens before visible page limits, expanding existing cached queries when a page contains the other category, so older matching records remain discoverable. No backfill, customer reclassification or financial write was run.

Latest verification for the monthly ledger and shared-page mode changes: frontend build and TypeScript checks passed; the ordinary application suite passed. Emulator-only suites remain covered by the prior isolated run above; this refinement changes no rules or backend code.

The royal-blue (#4169E1) invoice cards and thick gold record borders apply only to Customer and Medical portal invoices (/customer/invoices), via CustomerInvoiceCard. The shared Staff/Admin invoice table keeps its prior dark appearance; the temporary shared-page theme was removed.

Medical Ledger hides invoice numbers. Only the current month displays newest records first; the previous three months run from the first date to the last. Accounting calculations always remain chronological. Monthly opening balances reuse the preceding closing balance, carrying unchanged balances through months with no records.

Medical portal invoice cards show the PC coin, days wheel and balance wheel at equal sizes in one row. The balance wheel shows three values without visible amount labels: red pending, green paid and dark-blue invoice total, with full labels retained for screen readers. Duplicate amount tiles are omitted on Medical cards. It uses the existing invoice view balance and performs no additional data reads. Customer-role accounts now share this presentation; Staff/Admin pages retain their existing invoice table.

Customer and Medical day/balance wheel rings use the original bright red (#FF003D) and bright green (#00E676) with black centers. Balance values use readable red, green and blue text on black, with pending larger than the other values and the ₹ symbol in place of Rs. Existing amount calculations and other roles are unchanged.

Customer-role accounts now receive the same three-circle invoice presentation and four-month Ledger page/navigation as Medical accounts. This is presentation reuse only; customer classifications, invoice policies, reward calculations and stored data are unchanged. The Customer dashboard retains its total-outstanding arrow/history panel. Medical behavior and Staff/Admin pages are preserved. Customer Offers retains Grow your partnership and Benefits at every level with the existing click-only, session-cached loading.

Customer-role Ledger adds larger prior-month amount text, a yellow Opening value and a large boxed yellow Closing total below the table. Opening/Closing labels omit outstanding. These visual adjustments are scoped to the Customer role; the Medical ledger and monthly arithmetic are unchanged.

Both Customer and Medical ledgers now share larger older-month amount fonts, yellow Opening and Closing values, short Opening/Closing labels and a boxed Closing balance. Closing is smaller than Total Outstanding, whose amount is explicitly bold. All ledger amounts display ₹ instead of Rs.; account balances, month ordering and continuity calculations are unchanged.

## Dashboard welcome and controls

Customer and Medical dashboards share a purple-and-gold Namaste welcome banner. The Explore Rewards button below the PC coin is removed; Rewards remains in bottom navigation. The regular Customer total outstanding stays visible as a static amount, with its expandable arrow/history removed. Medical visibility and the PC history toggle are preserved. No financial records or Staff/Admin dashboards change.

## Dashboard sizing and portal borders

Customer and Medical dashboard cards share the available dynamic viewport between header and navigation. Navigation remains below the cards, and PC history opens as a closable overlay. Optional advance and bonus summaries share the space. Other portal pages retain their scrolling layout. Gold borders are scoped to the Customer/Medical portal: 1px details, 2px level cards, 3px summary/promo cards, 4px ledger tables, and the existing 6px invoice outline. Staff/Admin appearance and all financial data remain unchanged.
