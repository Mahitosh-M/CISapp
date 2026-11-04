# Reward and offer portal visibility

Development feature: Admin Reward Catalogue and Offers have a Visible to selector with Customer, Medical and Both. New forms default to Both. Editing and toggling activation preserve the selected audience; Admin record tables show the selection.

The optional customerAudience field stores customer, medical or both on rewardItems and offers. An omitted field means Both, so old documents require no backfill. A linked customer's stored customerType is authoritative; missing legacy type means Customer. Only an unlinked portal falls back to its Medical/customer login role.

Existing active-catalogue reads and caching are reused. Audience filtering happens before list limits, along with existing level/date eligibility. Reward availability and next-reward progress use the filtered rewards. Offers partnership details retain their click-only loading. No new composite indexes or per-item queries are introduced.

Rules validate the bounded audience enum on Admin creates and updates. Staff and customers cannot change catalogue targeting. New redemption requests and rejected-request retries check the current stored reward audience against the customer's stored classification. Approved/gifted history remains unchanged. Active catalogue read permissions retain their existing scope; the selector controls portal presentation and redemption eligibility, not confidential document storage.

No production write, backfill, merge, push or deployment is part of this change.

## Verification

- 27 targeted application checks passed, including Admin audience saves/edits, offer activation preservation, legacy defaults, portal filtering/progress, click-only partnership loading and manual numeric entry.
- 83 isolated Firestore emulator checks passed (9 audience checks, 60 existing PC/cash permission checks and 14 Medical reward checks).
- Frontend production build and Functions type check passed.

## Targeted Rules audit

```json
{
  "score": 5,
  "summary": "Audience-field writes and new/retried redemption eligibility use validated enums, Admin-only catalogue mutations, existing customer ownership and stored customer classification. Active catalogue read permissions intentionally retain their existing scope. The audit is limited to this feature delta.",
  "findings": []
}
```
