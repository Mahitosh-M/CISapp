# Firestore Loyalty Module Analysis

## Existing architecture summary

- React 18 + Vite app using Firebase Auth and Cloud Firestore modular SDK.
- Routes are split between admin/staff layout (`/`, `/dashboard`, `/customers`, `/invoices`, `/payments`, `/intelligence`, `/analytics`, `/gifts`, `/suggested-gifts`, `/reports`, `/admin`, `/settings`) and customer layout (`/customer`, `/customer/invoices`, `/customer/payments`, `/customer/offers`, `/customer/profile`).
- Roles are stored in `users/{uid}` with `Admin`, `Staff`, and `customer`.
- Existing collections: `users`, `settings`, `customers`, `invoices`, `payments`, `giftHistory`, `giftItems`, `alerts`, `offers`.
- Existing customer portal reads linked customer data, customer-scoped invoices/payments, app settings, and active offers via one-time `getDocs`/`getDoc`; no real-time listeners were found.
- Firestore database checked with Firebase CLI on 2026-07-04: `(default)`, Standard edition, native mode, free tier, `asia-south1`.

## New collections and access patterns

- `monthlyCustomerStats/{customerId_YYYY_MM}`
  - Admin/Staff list or read for status views.
  - Customer reads only documents where `customerId` matches their user profile.
  - Admin rebuilds cached monthly stats from existing invoices/payments.
- `loyaltyLedger/{deterministicId}`
  - Admin/Staff read.
  - Admin writes point entries; deterministic IDs prevent duplicate entries.
- `rewardItems/{rewardId}`
  - Admin/Staff read.
  - Customer reads active rewards only.
  - Admin creates/updates/deletes.
- `redemptionRequests/{customerId_rewardId}`
  - Admin/Staff read.
  - Customer reads own requests and creates own pending request.
  - Admin approves/rejects pending requests.

## New query shapes

- `monthlyCustomerStats`: `where("month", "==", month)`, `limit(50)` for admin status; direct `getDoc` for customer month.
- `rewardItems`: `orderBy("requiredPoints", "asc")`, `limit(50)` for admin; `where("isActive", "==", true)` for customer.
- `redemptionRequests`: `orderBy("requestedAt", "desc")`, `limit(50)` for admin; `where("customerId", "==", customerId)`, `limit(20)` for customer.

## Rules attack review for new collections

- Public list/read: denied because every rule requires an active profile.
- Unauthorized customer read: customer rules require matching `customerId` or active rewards.
- Unauthorized write: settings/rewards/stats/ledger admin-only; redemption customer create is own pending request only.
- Schema pollution: new validators use `keys().hasOnly(...)`.
- Type juggling: validators check strings, numbers, booleans, status/level enums.
- Owner hijack: customer redemption create requires `request.resource.data.customerId == customerId()`.
- Duplicate ledger/redemption writes: ledger document IDs are deterministic in service; rules restrict writes to Admin.
- Query mismatch: customer reward query filters active rewards; customer request query filters their own `customerId`.
