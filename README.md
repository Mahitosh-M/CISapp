# Customer Intelligence ERP

Professional React + Firebase ERP for a pharma wholesale/retail business.

## Purpose

This app helps the business manually operate daily customer work:

- Add, edit, delete, and search customers.
- Create, edit, delete, print, and filter invoices.
- Add, edit, delete, and filter payments.
- Track partial payments and multiple payments per invoice.
- Calculate outstanding as `Sales - Payments`.
- Rank customers using rolling 2-month customer intelligence.
- View Recharts analytics for sales, profit, tiers, outstanding, payments, and top customers.
- Track gift eligibility and prevent duplicate gifts for the same sales period.
- Protect ERP pages with Firebase Authentication and Admin/Staff roles.
- Export reports to PDF or Excel.

## Tech Stack

- React
- React Router
- Firebase Firestore
- Firebase Authentication
- Recharts
- TypeScript
- Vite
- Functional components
- Inline CSS styling

## Firestore Collections

The app uses these Firestore collections:

- `customers`
- `invoices`
- `payments`
- `settings`
- `giftHistory`
- `users`
- `offers`

## Free Tier Optimization Notes

This app is tuned to stay friendly for roughly 200-300 customers on the Firebase free tier:

- Dashboard, Analytics, and Reports use date-filtered invoice/payment queries instead of loading all history by default.
- Reports default to the current month. Use From Date, To Date, and Apply Filter before reviewing older periods.
- Customer portal reads only the logged-in customer's linked records. `customerId` is preferred; `customerName` is only a legacy fallback.
- Invoice and Payment list pages fetch the latest 50 records first and load older rows only when Load More is clicked.
- Customer offer reads fetch active offers only; inactive offers are filtered away from customer popup/carousel.
- Offer images should be compressed and hosted externally when possible, ideally below 1 MB for mobile customers.
- Monitor the Firebase Usage dashboard monthly, especially Firestore document reads.

Firestore may ask for composite indexes the first time new filtered queries run. Create the Firebase Console index from the error link if prompted. Common index shapes are:

- `invoices`: `customerId ASC, date DESC`
- `invoices`: `date DESC`
- `payments`: `customerId ASC, date DESC`
- `payments`: `invoiceId ASC, date DESC`
- `payments`: `date DESC`
- `giftHistory`: `giftedDate DESC`
- `offers`: `isActive ASC, createdAt DESC`

## Project Setup

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## Customer Intelligence Rules

Customer scoring uses rolling 2-month data:

- Profit Contribution: 35%
- Payment Discipline: 25%
- Order Frequency: 20%
- Sales Volume: 15%
- Loyalty: 5%

Gift budget is configurable per tier in the Settings page.

## Authentication And Roles

Only logged-in Firebase Authentication users can access the ERP.

Admin users can:

- Edit settings.
- Change tier gift percentages.
- Change credit days and payment buffers.
- Change scoring weights.
- Create staff accounts.
- Delete records.
- Access reports, analytics, and gift history.

Staff users can:

- Add customers.
- Create invoices.
- Add payments.
- Use the daily operational screens.

Staff users cannot delete records or change system settings.

First login in a new Firebase project becomes Admin automatically. After that, Admin users should create Staff accounts from Settings.

## Tier Rules

Tier 1:
- Strategic customers
- Default 15 day credit
- Default 3 day payment buffer

Tier 2:
- Loyal medium customers
- Default 10 day credit

Tier 3:
- Low priority customers
- No credit

## Gift Workflow

Gift periods can be:

- 3 months
- 6 months
- 1 year

After a gift is marked as issued, the same customer sales period cannot be rewarded again. The Gift Budget page checks overlapping date ranges in `giftHistory` before allowing a new gift.

## Git And GitHub Workflow

Git is the local version control system. It records changes in commits so you can see history and roll back when needed.

GitHub is the online backup and collaboration place for your Git repository. It stores your code safely in the cloud.

### First-Time Git Setup

Create a Git repository:

```bash
git init
```

Add all project files:

```bash
git add .
```

Create your first commit:

```bash
git commit -m "Initial Customer Intelligence ERP setup"
```

### Main And Development Branches

Create a development branch:

```bash
git checkout -b development
```

Recommended workflow:

1. Build new features in `development`.
2. Test the app with `npm run build`.
3. Merge tested work into `main`.

Switch to main:

```bash
git checkout main
```

Merge development into main:

```bash
git merge development
```

### Push To GitHub

Connect your local project to GitHub:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
```

Push main branch:

```bash
git push -u origin main
```

Push development branch:

```bash
git push -u origin development
```

### Daily Commit Workflow

Check changed files:

```bash
git status
```

Stage changes:

```bash
git add .
```

Commit changes:

```bash
git commit -m "Add invoice CRUD"
```

Push changes to GitHub:

```bash
git push
```

### Rollback Basics

View commit history:

```bash
git log --oneline
```

Restore one file from the latest commit:

```bash
git checkout -- src/pages/Invoices.tsx
```

Create a safe rollback commit:

```bash
git revert COMMIT_ID
```

Use `git revert` for shared GitHub projects because it keeps history clean and does not erase other people's work.
