# Firestore Rules Analysis

This app uses Firebase Auth with role records in the `users` collection.

Collections used by `src/services/firestoreService.ts`:
- `customers`: Admin/Staff ERP records; customer users read their linked customer document.
- `invoices`: Admin/Staff manage; customer users read invoices where `customerId` matches their profile.
- `payments`: Admin/Staff manage; customer users read payments where `customerId` matches their profile.
- `settings`: Admin manages; authenticated users read app settings.
- `giftHistory`: Admin/Staff manage; customer users read their linked gift history.
- `giftItems`: Admin/Staff manage; customer users read active catalog data if queried by app.
- `users`: Auth profiles containing PII and roles; users read only their own document, Admin manages all.
- `alerts`: Admin/Staff manage.
- `offers`: Admin/Staff manage; authenticated users read offers.

Queries used by the app include `orderBy` on names/dates/email and `where` filters on `customerId`, `customerName`, `invoiceId`, `uid`, and `email`.

Attack review summary:
- Public reads/writes are denied.
- User role escalation is blocked because only Admin can create/update `users`.
- Customers cannot read other customer profiles from `users`.
- Customers can only read ERP documents with their own linked `customerId`.
- Admin/Staff write access is intentionally broad for ERP collections because the current app uses client-side CRUD.
- Rules are a secure prototype for the current client app and should be hardened with stricter field validation before broad external launch.
