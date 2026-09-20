# Notification feature — DEV review and setup

Status: release approved. Notification Functions and cloud configuration were deployed before the code release. The user approved including the earlier Offers and navigation changes. Separate unfinished invoice and Firestore-rule edits remain on `dev`.

## What changed and why

CISapp existing files:
- `src/App.tsx`: Admin-protected `/notifications` route.
- `src/components/Layout.tsx`: Admin navigation entry and device enable/disable button.
- `src/components/CustomerMobileLayout.tsx`: the same small notification button.
- `src/services/authService.ts`: clear notification ownership on account changes and before logout; notification failures do not prevent sign-out.
- `public/sw.js`: handle data-only Web Push and notification clicks in the existing worker, preserving its caching handlers.
- `functions/src/index.ts`: export the notification-only backend handlers.
- `.env.example`: optional public VAPID key placeholder. No credentials were added.

CISapp new files:
- `src/services/notificationService.ts`: opt-in registration, account binding, bounded logout cleanup and callable client.
- `src/components/NotificationControl.tsx`: explicit enable/disable action, with no first-load permission prompt.
- `src/pages/Notifications.tsx`: Audience, Title, Message and Send only.
- `functions/src/notifications.ts`: trusted sending, token ownership, audience synchronization and event deduplication.
- `functions/src/notificationPolicy.ts`: notification eligibility and split-receipt guards using existing fields.
- `functions/src/notificationPolicy.test.ts`, `notificationWorker.test.ts`, `notifications.integration.test.ts`: audience, privacy, authorization, event and worker checks.
- `src/services/notificationService.test.ts`: opt-in, offline logout, account change and late-registration checks.
- `NOTIFICATIONS.md`: this review/setup guide.

Orderapp changes (also on dev):
- `firebase.json`: add only its Functions source/runtime/build entry.
- `eslint.config.js`: exclude the new generated Functions output from lint.
- New `functions/package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `src/index.ts`: one authenticated order-event relay. No Orderapp frontend or order-save code was changed.

No invoice, payment, PC, outstanding, credit or order calculation was changed. No global theme, authentication policy, existing Firestore rule, scheduler, polling, extra storage product or analytics feature was added by this work.

## Data and functions

Existing profiles are `users/{uid}` (legacy profile documents with matching `uid` are also supported). The existing `customerId` connects an authenticated customer to `customers/{customerId}`. Active customer roles are `customer` and `Medical`; staff uses `Staff`, admin uses `Admin`. The customer's existing `customerType` takes precedence over the fallback Medical role for audience selection.

| Audience | Topics |
| --- | --- |
| General customer | `customers_all`, `customers_general` |
| Medical customer | `customers_all`, `customers_medicals` |
| Staff | `staff_announcements` |
| Admin | No automatic marketing topic |

CISapp Functions:
1. `syncNotificationDevice`: authenticated device registration/removal; topic membership is derived on the server.
2. `notificationUserChanged`: role, linked customer, activation or account deletion synchronizes existing devices. Other profile edits return immediately.
3. `notificationCustomerGroupChanged`: existing customer type changes synchronize linked accounts. Unrelated customer updates return immediately without extra reads.
4. `notifyInvoiceCreated`: `invoices/{invoiceId}` creation, excluding the same draft/cancel/void/non-sale categories used by the existing invoice eligibility helper.
5. `notifyPaymentCreated`: `payments/{paymentId}` creation; positive receipts only, not advance applications. Split receipts wait until all saved parts exist, then use their saved amounts for one message.
6. `sendNotificationBroadcast`: callable checks active Admin authority before accepting one of the four audiences. Title is limited to 120 characters and message to 500. It accepts no arbitrary URL.
7. `notifyStaffOfCustomerOrder`: IAM-private HTTP receiver, callable only by the separately authorized Orderapp runtime identity.

Orderapp Function:
8. `relayCustomerOrderNotification`: `orders/{orderId}` creation relays only order ID and customer ID using a Google-signed identity token. No browser credential or cross-project database reader is introduced.

Invoice/payment messages use registered device tokens only, never topics. Each linked profile is checked against the current canonical identity and active customer role. Staff orders use `customers.branchId`: SINDHANUR -> `users.shopId = SHOP_S`, MASKI -> SHOP_A. Unknown branch mapping falls back to active staff, with a generic message containing no customer/product/amount details.

## Security and shared devices

Device tokens live at `users/{uid}/notificationDevices/{tokenHash}`. A backend-only `notificationTokenOwners/{tokenHash}` index gives one token one account owner and serializes topic changes. Up to ten devices per account are accepted. These new paths remain denied to direct browser Firestore access by the existing catch-all rules; the Admin SDK manages them. No client rules expansion is needed.

Only the user's own authenticated UID is accepted for registration; the client cannot supply a role or customer group. All four old memberships are removed before adding the correct memberships. Account/group-change handlers refresh them too.

Logout first clears a local IndexedDB binding and closes displayed notifications. Network cleanup is best effort, limited to three seconds. The existing worker checks the binding before displaying and before opening every message. Old-account private messages are discarded even when offline cleanup could not reach Firebase. Only data payloads are sent: FCM's automatically displayed `notification` payload is intentionally not used. The browser installation token is kept dormant instead of deleting it asynchronously during a possible new login; the backend removes its account/device registration and topics.

Permanent invalid-token errors remove stale registrations. Error logs contain a failure count, not tokens or business documents. The worker permits only fixed same-origin destinations.

## Reliability limits

Each invoice, receipt, order and Admin send claims a small backend-only `notificationEvents/{hash}` marker before sending. Duplicate trigger deliveries or repeated submission of the same Admin request do not resend it. This is an at-most-once tradeoff: a process crash or transient send failure after the claim can lose a notification. FCM delivery is not guaranteed, and a successful send does not prove a device displayed it. The saved business record is unaffected; no notification is a financial receipt or source of truth.

There is no notification-history UI, retry queue, polling, campaign system or business-data recalculation. A partially saved split receipt does not announce the planned unsaved total. Notifications apply only to new events after trigger deployment; there is no historical backfill.

The current Orderapp rules permit public order access, and its launch role is not trusted Firebase authorization. This pre-existing issue was not expanded or rewritten under this task. There is therefore no existing *secured* order-detail destination that this implementation can safely claim to use. An order notification opens CISapp's authenticated staff landing page and says to open Orderapp to view. Securing Orderapp itself is separate work required before offering a secured direct order-detail link. Public order creation also makes notification/Function abuse and costs possible.

## Setup after approval — do not deploy during DEV review

1. Review the dev code and Admin Notifications page locally. With no VAPID key, the notification button is hidden and broadcasting is disabled; other app operations continue normally.
2. Blaze/billing is enabled only on the Firebase projects needed for these notification Functions: CISapp and Orderapp. Orderapp was linked to the existing billing account with explicit user authorization.
3. In CISapp Firebase Console -> Project settings -> Cloud Messaging, enable/check the Cloud Messaging API and generate a Web Push certificate key pair. Put only the public key in `VITE_FIREBASE_VAPID_KEY` in the ignored `.env.local` and the approved build environment. Never place an Admin key or service-account JSON in React or Git. This key is public, not a privileged secret.
4. Deploy the CISapp notification Functions only after approval. Their runtime identity needs the normal required Firestore and Firebase Cloud Messaging permissions. Keep the order receiver IAM-private. Inspect the actual deployed function URL; do not assume a Cloud Run service name.
5. In Google Cloud IAM for that receiver's underlying Cloud Run service, grant `Cloud Run Invoker` only to the Orderapp relay's runtime service account. Get the actual service-account email from its Function configuration. Do not grant allUsers or allAuthenticatedUsers; do not share service-account private keys. The receiver uses the platform's IAM verification of the Google ID token.
6. Set Orderapp `functions/.env` -> `CIS_ORDER_NOTIFICATION_URL` to the full approved receiver URL. Deploy the Orderapp relay after the IAM link is ready. The URL is configuration, not a shared secret.
7. Deploy the approved CISapp frontend/worker build with the public VAPID setting. Existing GitHub workflow build environments also need that variable forwarded if deployment through those workflows is chosen later. This task did not change CI or deploy.
8. Use HTTPS (localhost is suitable for local UI development), allow browser notifications using Enable alerts, and verify the browser supports Web Push. On iOS, Home Screen installation and a supported iOS version may be required. No permission prompt appears until the user asks.
9. Configure billing budgets/alerts for both projects. Alerts are not spending caps. Monitor early usage before wider rollout.

## Costs

FCM messaging itself has no charge. See [Firebase pricing](https://firebase.google.com/pricing). Server Functions, Firestore reads/writes for account/device lookup and deduplication, Eventarc delivery, build/artifact storage, logs and network traffic can incur charges. Generation 2 Functions use Google Cloud infrastructure under the hood; no separate custom always-running service or manually managed Pub/Sub system is introduced.

All new Functions use minInstances=0, maxInstances=2, 256 MiB, fractional generation-1 CPU allocation and concurrency=1. There are no scheduled jobs or database polls. Normal activity for about 100–500 customers should be small and is designed around available no-cost allowances, but project-wide use, region, existing usage, abuse, deployments and retained artifacts can produce a bill. Max instances is not a billing cap. No permanent ₹0 guarantee is made.

Firestore triggers cannot filter by changed field: the two membership triggers are invoked on their collection writes but immediately return when relevant fields have not changed. Order events require two function invocations because orders and notification devices live in different existing projects. Deduplication markers accumulate one small record per notification event; no TTL or cleanup scheduler is enabled.

References: [Function resource controls](https://firebase.google.com/docs/functions/manage-functions), [Web FCM receiving](https://firebase.google.com/docs/cloud-messaging/web/receive-messages), [Admin topic management](https://firebase.google.com/docs/cloud-messaging/manage-topic-subscriptions).

## Validation and required live checks

Local automated tests check audience selection, active Admin enforcement including direct non-Admin calls, private customer isolation, invoice exclusions, split receipts, duplicate events, token/topic removal, branch targeting and worker account/logout gates. These tests do not send messages or modify a Firebase project.

After an approved deployment, verify with separate General, Medical, Staff and Admin accounts and two browser profiles:
- General gets all/general; Medical gets all/medicals; Staff gets staff announcements only.
- Each customer receives only their own new invoice/payment; editing an existing invoice causes no new push.
- A split receipt produces one message; an advance application produces none.
- Changing customer type removes the old audience and adds the new one.
- A SINDHANUR order alerts SHOP_S staff; MASKI alerts SHOP_A staff.
- Direct broadcast calls by Staff/customer are rejected.
- Log out while offline, then send the old account a private message; no private contents should display. Log into another account on the same browser and repeat.
- Test foreground/background notifications, click navigation, permission denied/revoked and multiple devices.
- Confirm normal login/logout and invoice/payment/order saving still work when notifications are disabled or unavailable.

Actual device delivery, IAM deployment and browser visual review remain unverified until the approved setup is available. No claim of live end-to-end success is made.


### Local validation results

- CISapp production build (including TypeScript): passed.
- CISapp existing frontend tests: 131 passed; 54 Firestore emulator tests skipped because no emulator was running.
- New notification client tests: 4 passed, including offline logout and late-registration protection.
- CISapp Functions build and tests: 20 passed.
- Orderapp production build and Functions TypeScript build: passed.
- Orderapp tests: 23 passed.
- Lint of new Orderapp Functions source: passed. Full Orderapp lint remains blocked only by the existing `src/inputSecurity.ts:17` no-control-regex error; this unrelated file was not modified.
- CISapp has no lint script. Both repositories' diff whitespace checks passed.
- Both local branches remain `dev`; main still points to CISapp `ae32dbe` and Orderapp `9d74d3f`. No push, main merge or deployment was performed.
- Browser/device delivery was not tested; the in-app browser was unavailable and live Firebase notification configuration was deliberately not changed.

### Release configuration and cost safeguards

- The public Web Push key is configured in the ignored local environment and the CISapp GitHub build secret. No private key or service-account credential is committed.
- The CISapp order receiver remains IAM-private. An unauthenticated request returned HTTP 403. Only the dedicated Orderapp relay identity has receiver invocation access.
- Firestore event retries expire after fifteen minutes. The Orderapp relay also stops transient retries after fifteen minutes and does not retry permanent HTTP configuration errors.
- Only the final saved part of a split payment reads its completed group, avoiding repeated group reads for every part.
- Re-registering an unchanged device skips topic subscription calls and Firestore writes.
- All new Functions use Node 22, 256 MiB, zero minimum instances, maximum two instances, and generation-1 fractional CPU allocation.
- Firebase configured build-image cleanup at one day. This reduces Artifact Registry accumulation but is not a billing cap.
- The notification feature requires no broader Firestore client access. Existing rules remain unchanged in this release.
- Orderapp's existing public order creation remains the main abuse-related cost risk and should be secured as a separate change because its launch flow does not yet use trusted Firebase Authentication.
