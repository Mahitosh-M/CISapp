# Orderapp administration
CISapp already has an Admin role. No new user records or roles are created by this feature.

## Admin access
Open CISapp → Admin → **Order**. CISapp requests a custom session from createOrderAdminSession, which checks the existing active users/{uid} Admin profile. The token is delivered to the matching Orderapp popup through postMessage with exact origin, window and nonce checks; it is never put in a URL or persistent browser storage. Orderapp rechecks the Admin profile and the orderappAdmin claim. Direct links and role=admin do not grant access.

## Settings
- Category images: choose a catalogue category, upload, crop and save, or restore the original.
- Product images: search product names, choose a product, upload and fit/crop to **512 × 512**. WebP preserves transparency. Edge-connected white removal is optional; inspect the preview, especially for white packaging.
- Orders: the existing order processing controls.
- Catalogue: version/counts and manual refresh. Product names, stock, prices and category assignments remain managed in Catalogue Manager.

Images are overrides; original catalogue exports and old orders stay intact. Category images use JPEG. Product images use WebP. Both are limited to 240,000 characters. A failed save leaves the previous image intact.
Product overrides load only when their image approaches the viewport and are cached for the tab session. Only public artwork is stored in the new image collections, without account information.

## Staff orders
CISapp Staff navigation now has Orders. It lists up to 100 pending/confirmed orders and links to the selected order's processing screen in Orderapp. A single initial order check supplies both this page and the animated login alert. Dismissal lasts until the Staff layout is recreated at logout/login. Manual refresh checks again.

## Configuration and release
Local development uses ignored .env.local files:
- Orderapp: VITE_FIREBASE_CONFIG and VITE_CISAPP_FIREBASE_CONFIG (public Firebase web options).
- CISapp: existing VITE_FIREBASE_CONFIG plus VITE_ORDERAPP_FIREBASE_CONFIG.

The cross-app public Firebase web options are GitHub Actions repository variables: VITE_ORDERAPP_FIREBASE_CONFIG in CISapp and VITE_CISAPP_FIREBASE_CONFIG in Orderapp. Existing VITE_FIREBASE_CONFIG build secrets remain in use.
Release must include CISapp's createOrderAdminSession function and the two new Firestore collection rules, followed by both Hosting builds. The function's runtime identity needs permission to sign Firebase custom tokens (iam.serviceAccounts.signBlob); verify this during deployment. Local Hosting previews alone cannot call a backend function that has not been deployed. Deployment does not migrate historical invoices, payments, customer records or orders. The runtime signing permission is a separate prerequisite for Admin handoff.

## Verification
Orderapp: npm test and npm run build.
CISapp: npm run build, npm --prefix functions run build, and npx vitest run src/components/StaffOrderAlert.test.tsx.
Local-only rules and backend checks after the functions build:
npx -y firebase-tools@latest emulators:exec --only firestore --project demo-cis-category-images --config firebase.orderapp-test.json "node functions/scripts/orderAdmin.emulator.cjs"
This test refuses to run without a loopback Firestore emulator.
