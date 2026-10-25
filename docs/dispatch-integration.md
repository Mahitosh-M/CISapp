# CIS Dispatch bridge: development implementation

19 October 2026. All changes are on `dev`. Nothing has been merged, pushed or deployed. Existing live CISapp, Cashapp and Firebase data have not been changed.

## What is implemented

- Invoices: Delivery required checkbox opens a separate operational form only after the existing invoice and same-day receipt save has completed. Saved business invoices also have Mark for delivery / Edit delivery actions. Opening balances cannot be dispatched. Delivery metadata does not alter invoice financial status.
- Server-only delivery projection keyed by source invoice ID; repeated marking cannot create duplicate delivery jobs. A source-change trigger retains the projection/history and flags deleted, cancelled or reassigned invoices.
- HTTPS `dispatchBridge` authenticates CISapp staff/Admin tokens or delivery-project driver tokens. Revocation checks and active profile / Admin-approved driver UID mappings are mandatory. Drivers never become CISapp Staff users.
- Protected route publication and assigned operational/customer/reference downloads. Drivers receive necessary reference balances, without purchase costs, profit or unassigned customer access. Direct client access to bridge collections remains denied by the existing Firestore rules.
- Driver collection submissions with stable IDs. Local/demo approvals are not replayed. CISapp /dispatch lets managers verify, allocate, reject or approve received claims. Admin can authorise driver-project UIDs for one or both shops.
- Trusted receipt posting transaction re-reads current customer invoices and receipts, uses existing opening-balance-first ordering/payment-effect/allocation helpers, checks overrides, posts deterministic split receipt IDs, updates customer outstanding, shared shop funds, monthly snapshots and immutable PC awards atomically. Credit authorisation creates no receipt. UPI/bank require a reference and independent manager verification.
- Excess stays unallocated in the claim; it never automatically becomes a customer advance. Existing advances are preserved. Existing CISapp receipt editing/deletion remains available; later receipt changes are flagged in the connected snapshot and cannot replay the original approval.
- A durable task uses the current frontend credit/scoring helpers, including the existing medical 15-day changes, and retries without posting another receipt or award.

`src/utils/financialDocuments.ts` contains the previously inline financial document mappers, extracted without changing their legacy defaults. Both the existing client service and new backend use them. Other authoritative calculations are imported from their existing source modules rather than rebuilt in Dispatch.

## New fields and collections

Invoice fields: `deliveryRequired`, `deliveryDetails` (required/date/address/contact/packages/instructions), `deliveryRevision`. They are set by the trusted marking operation. No invoice total/cost/profit fields are changed by delivery marking.

CIS project backend collections: `dispatchDeliveryRequests`, `dispatchIdentities`, `dispatchTrips`, `dispatchVehicleLocks`, `dispatchCollections`, `dispatchApprovals`, `dispatchPostingTasks`, `dispatchAudit`. Driver Auth stays in `delivery-28165`; this bridge uses CISapp's existing Firestore so invoice/receipt posting and deduplication can share one trusted transaction. It does not require the currently unavailable delivery-project Firestore service.

`dispatchCollections` stores reported money and review/posting states. `dispatchApprovals` stores a unique approval acknowledgement and receipt IDs. Physical driver cash, company advances and handovers are separate from receipt posting. No Cashapp expense, transfer or second collection is created.

## Current limits / activation requirements

The backend and updated frontends are **not deployed**. Default browser endpoint is the proposed CISapp HTTPS function. An undeployed endpoint must show an error while preserving local data. Deployment still requires user review/approval and verification of runtime IAM, service availability, revocation-check access to driver Authentication, authorised origins/accounts and deployment contents. Main branches remain unchanged.

This is the invoice/collection connection stage. Delivery execution, POD photos/signatures, fuel, local shift review and physical custody evidence still live on the originating installation. They are not centrally synced or verified. Managers may explicitly acknowledge a locally closed/reviewed shift to release a published vehicle assignment; that acknowledgement creates no financial event. Full multi-device operational reconciliation, central protected evidence storage, route execution conflict resolution and local-cache security hardening remain required before a production driver rollout. The non-secure demo role switcher is still labelled and is not a security boundary.

Existing unlinked customers/invoices, demo rows and previously locally approved collections remain local. Transfer of genuine pre-existing operational records requires explicit audited ID mappings; see Dispatch's migration dry-run guide. Do not silently map names or import old approvals as receipts.

## Local validation commands

From D:/CISapp:

```powershell
npm run build
npx vitest run src/utils
npm --prefix functions test
firebase emulators:exec --only firestore --project demo-cis-dispatch --config firebase.dispatch-test.json "node --test functions/lib/functions/src/dispatchBridge.emulator.test.js"
firebase emulators:exec --only firestore --project demo-cis-dispatch --config firebase.dispatch-test.json "npx vitest run src/services/dispatchRules.test.ts"
```

The emulator project is deliberately fictitious. Do not replace it with a production project for testing. The service regression test also checks PC awards, medical credit, receipt-change detection, overlapping vehicle publication and idempotent closure. No emulator test creates a real account, invoice or receipt.


## Weekly route catalogue (23 October 2026, dev)

Dispatch Admin configures dispatchRouteTemplates via routeCatalog/saveWeeklyRoute bridge operations. Templates hold ordered named stops, authorised shops and any weekdays (many routes/day, many days/route). Staff select route/stop in the saved-invoice delivery dialog, see current weekly loading days and can override the suggested next matching date. Deliveries & collections also lists the current weekly catalogue. Server marking resolves metadata and stores route snapshots on invoice.deliveryDetails and delivery requests; later weekly remapping does not rewrite historical deliveries. Drivers confirm actual loading separately. Templates are Admin-write, shop-scoped Staff/Manager-read and unavailable to Drivers; direct Firestore access remains denied by existing rules. No invoice/payment calculation changes. Dispatch planner can use route-tagged requests in stop order. Details and validation: D:/DELIVERY/cis-dispatch/docs/phase2/WEEKLY-ROUTES.md.


## Refresh and departure-shop release policy (23 October 2026)

Dispatch workspace refresh runs at login/page reload and user-requested pull-down or Synchronise now. Identity-only interval/reconnect checks retain access revocation handling. Operational saves still send commands immediately online; approval balance validation remains server-side. Staff/Manager release authority is based on the trip's starting shop, not its ending shop. Admin effective shop scope is always both source shops, including old Admin identity links with a single saved shop. Drivers remain unable to release routes. Tested through the trusted operation emulator and signed-in fictional browser workflows. No main branch changes or live Hosting release.
