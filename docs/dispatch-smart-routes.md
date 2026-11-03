# Dispatch smart-route development extension

Companion projects are on `dev-smart-routes`. This feature has not been merged, pushed or deployed. Cashapp accounting and the December overdue policy are unchanged.

The complete phase report, configuration, manual workflow, costs, tests, native-navigation blockers and rollback guide is in the Dispatch working copy at `D:/DELIVERY/cis-dispatch/docs/SMART-ROUTES.md`.

## CISapp and backend changes

- The existing post-save Delivery dialog now accepts a confirmed delivery pin, reminder threshold/instructions and optional time window. It shows the customer's saved pin and supports an invoice-specific override.
- Customer-master changes use a separate Admin-only trusted action and audit entry. Ordinary Staff cannot change master coordinates through Firestore Rules. Invoice totals, creation/payment ordering and financial status are untouched.
- New bridge actions: `routeHistory`, `seedWeeklyRoutes`, `confirmShopLocations`, `invoiceDeliveryLocation`, `saveCustomerDeliveryLocation`, `routeCostSettings`, `saveRouteCostSettings`, `routeProfitability`.
- Existing `operation` adds `amendStops`, `reviewLocation`, `ackRoute`, `visitWaypoint` and `arrivalReminder`. It retains stable acknowledgement IDs, transaction validation, assignment/shop scope and the existing financial posting path.
- `dispatchSmartRoutes.ts` replaces client geometry with trusted template data. Release requires confirmed pins and unchanged source details. The compatibility publisher uses the same gate and cannot overwrite an operational trip behind the command service.
- New server-only collections: `dispatchRouteTemplateVersions`, `dispatchRouteCodes`, `dispatchRouteCostSettings`, `dispatchTripValuations`. No new composite index is required for current single-field queries.
- Profitability reads authoritative invoice amounts/costs through a Manager/Admin-only endpoint. It captures a reporting-only closure valuation and separates current adjustments. Drivers never receive these financial projections. Partial/multi-trip attribution remains explicitly unavailable rather than being derived from package percentages.
- The existing approved fuel workflow still posts exactly once to Cashapp's Fuel category. Route reports do not create expenses or receipts.
- Seven-day Dispatch retention also clears new itinerary/customer location detail and reminders while preserving minimal reporting summaries. Source CISapp records are not deleted.

## Shared contract

The pure domain, commands, route geography, template types, smart-routing, costs and retention modules under `functions/src/dispatchDomain` are mirrored from Dispatch. `syncMerge.ts` changes only its relative imports for this mirror. Keep these copies in step until they are extracted to an existing shared package in a later change. Core operational schema version remains 2 with optional fields; the browser database migration is independently versioned at 4.

Leaflet renders ordinary online map tiles. `src/utils/map-provider.ts` has no configured geocoder, road router or paid optimisation service. Paid Google APIs are disabled. PWA foreground coordinates and saved itineraries are implemented; native/background turn-by-turn and reliable traffic-based arrival notifications require the separate Android/provider setup described in the companion guide.

## Verification / release

Build: `npm.cmd run build` and `npm.cmd --prefix functions run build`.

Ordinary regressions: `npm.cmd test -- --run` (157 passed). Local Firestore/Auth checks cover receipt and fuel idempotency, source balances/credit, the unchanged overdue schedule, route revisions/pins/report privacy and account lifecycle. The Firestore rules suites passed 62 checks. No production credentials or live data were used for the isolated backend emulator writes.

Deploy this extension to a development target and verify actual accounts before any main/live release. A local frontend pointed at the existing production bridge will not have the new backend actions until a reviewed backend release. Preserve additive fields and immutable audit/version/valuation records during rollback.
