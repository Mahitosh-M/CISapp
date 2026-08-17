import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithFirestoreEmulator = emulatorAddress ? describe : describe.skip;
const timestamp = '2026-08-11T00:00:00.000Z';

describeWithFirestoreEmulator('PC and branch cash Firestore permissions', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, portText] = emulatorAddress!.split(':');
    testEnvironment = await initializeTestEnvironment({
      projectId: 'cisapp-pc-rules-test',
      firestore: {
        host,
        port: Number(portText),
        rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
      }
    });
  });

  beforeEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment?.cleanup();
  });

  const seed = async (role: 'Admin' | 'Staff', includeBalance = true, shopId?: 'SHOP_A' | 'SHOP_S') => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'users', 'team-user'), {
        active: true,
        role,
        ...(shopId ? { shopId } : {})
      });
      await setDoc(doc(database, 'invoices', 'invoice-1'), {
        customerId: 'customer-1'
      });
      if (includeBalance) {
        await setDoc(doc(database, 'pcBalances', 'customer-1'), {
          customerId: 'customer-1',
          availablePc: 100,
          incomingPc: 120,
          redeemedPc: 20,
          protectedAt: '2026-08-02T00:00:00.000Z',
          lastMutationReferenceId: 'opening-entry',
          updatedAt: '2026-08-02T00:00:00.000Z'
        });
      }
    });
  };

  const seedManagedUser = async (
    profileId: string,
    role: 'Admin' | 'Staff' | 'customer' | 'Medical',
    shopId?: 'SHOP_A' | 'SHOP_S',
    uid = profileId
  ) => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', profileId), {
        uid,
        email: `${profileId}@example.com`,
        name: profileId,
        role,
        ...(shopId ? { shopId } : {}),
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });
  };

  it('allows Admin to assign an existing Staff profile to a shop', async () => {
    await seed('Admin');
    await seedManagedUser('staff-user', 'Staff');
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(updateDoc(doc(database, 'users', 'staff-user'), {
      shopId: 'SHOP_A',
      updatedAt: '2026-08-17T00:00:00.000Z'
    }));
    expect((await getDoc(doc(database, 'users', 'staff-user'))).data()?.shopId).toBe('SHOP_A');
  });

  it('denies Staff from assigning user profiles to shops', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedManagedUser('other-staff', 'Staff');
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertFails(updateDoc(doc(database, 'users', 'other-staff'), {
      shopId: 'SHOP_S',
      updatedAt: '2026-08-17T00:00:00.000Z'
    }));
  });

  it('allows Admin to remove a non-Admin app profile', async () => {
    await seed('Admin');
    await seedManagedUser('staff-user', 'Staff', 'SHOP_A');
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(deleteDoc(doc(database, 'users', 'staff-user')));
  });

  it('denies Staff profile removal and protects Admin profiles', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedManagedUser('customer-user', 'customer');
    const staffDatabase = testEnvironment.authenticatedContext('team-user').firestore();
    await assertFails(deleteDoc(doc(staffDatabase, 'users', 'customer-user')));

    await seed('Admin');
    await seedManagedUser('other-admin', 'Admin');
    await seedManagedUser('self-alias', 'Staff', 'SHOP_A', 'team-user');
    const adminDatabase = testEnvironment.authenticatedContext('team-user').firestore();
    await assertFails(deleteDoc(doc(adminDatabase, 'users', 'other-admin')));
    await assertFails(deleteDoc(doc(adminDatabase, 'users', 'team-user')));
    await assertFails(deleteDoc(doc(adminDatabase, 'users', 'self-alias')));
  });

  const addInvoicePcToBatch = (
    testDatabase: unknown,
    points: number,
    existingBalance: boolean
  ) => {
    const database = testDatabase as Firestore;
    const entryId = 'customer-1_invoice-1_invoice_pc';
    const batch = writeBatch(database);
    const balancePayload = {
      customerId: 'customer-1',
      availablePc: existingBalance ? 100 + points : points,
      incomingPc: existingBalance ? 120 + points : points,
      redeemedPc: existingBalance ? 20 : 0,
      protectedAt: existingBalance ? '2026-08-02T00:00:00.000Z' : '',
      lastAwardReferenceId: 'invoice-1',
      lastMutationReferenceId: entryId,
      updatedAt: timestamp
    };

    if (existingBalance) {
      batch.update(doc(database, 'pcBalances', 'customer-1'), balancePayload);
    } else {
      batch.set(doc(database, 'pcBalances', 'customer-1'), balancePayload);
    }
    batch.set(doc(database, 'loyaltyLedger', entryId), {
      customerId: 'customer-1',
      type: 'on_time_payment',
      points,
      reason: 'Invoice INV-1 PC permanently awarded',
      referenceId: 'invoice-1',
      month: '2026-08',
      createdAt: timestamp
    });

    return batch;
  };

  it('allows Staff to atomically add an invoice award to a protected balance', async () => {
    await seed('Staff');
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    await assertSucceeds(addInvoicePcToBatch(database, 5, true).commit());
  });

  it('allows Staff to create the first balance with an invoice award', async () => {
    await seed('Staff', false);
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    await assertSucceeds(addInvoicePcToBatch(database, 5, false).commit());
  });

  it('allows Admin to atomically add a manual adjustment', async () => {
    await seed('Admin');
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const batch = writeBatch(database);
    batch.update(doc(database, 'pcBalances', 'customer-1'), {
      availablePc: 110,
      incomingPc: 130,
      redeemedPc: 20,
      lastMutationReferenceId: 'manual-entry-1',
      updatedAt: timestamp
    });
    batch.set(doc(database, 'loyaltyLedger', 'manual-entry-1'), {
      customerId: 'customer-1',
      type: 'manual_adjustment',
      points: 10,
      reason: 'Approved service recovery',
      referenceId: 'manual-entry-1',
      month: '2026-08',
      createdAt: timestamp
    });

    await assertSucceeds(batch.commit());
  });

  it('denies the same manual adjustment to Staff', async () => {
    await seed('Staff');
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const batch = writeBatch(database);
    batch.update(doc(database, 'pcBalances', 'customer-1'), {
      availablePc: 110,
      incomingPc: 130,
      redeemedPc: 20,
      lastMutationReferenceId: 'manual-entry-1',
      updatedAt: timestamp
    });
    batch.set(doc(database, 'loyaltyLedger', 'manual-entry-1'), {
      customerId: 'customer-1',
      type: 'manual_adjustment',
      points: 10,
      reason: 'Unauthorized adjustment',
      referenceId: 'manual-entry-1',
      month: '2026-08',
      createdAt: timestamp
    });

    await assertFails(batch.commit());
  });

  it('denies a balance change without its immutable ledger entry', async () => {
    await seed('Admin');
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const batch = writeBatch(database);
    batch.update(doc(database, 'pcBalances', 'customer-1'), {
      availablePc: 110,
      incomingPc: 130,
      redeemedPc: 20,
      lastMutationReferenceId: 'missing-entry',
      updatedAt: timestamp
    });

    await assertFails(batch.commit());
  });

  const branchReceipt = (shopId: 'SHOP_A' | 'SHOP_S', amount = 5000) => ({
    customerId: 'customer-1',
    customerName: 'Customer One',
    invoiceId: 'invoice-1',
    invoiceNumber: 'INV-1',
    date: '2026-08-10',
    amount,
    paymentKind: 'receipt',
    branchSystemVersion: 1,
    shopId,
    affectsShopCash: true,
    cashSyncedAmount: amount,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  const addBranchReceiptBatch = (testDatabase: unknown, shopId: 'SHOP_A' | 'SHOP_S', amount = 5000) => {
    const database = testDatabase as Firestore;
    const batch = writeBatch(database);
    batch.set(doc(database, 'payments', 'branch-payment'), branchReceipt(shopId, amount));
    batch.set(doc(database, 'shopCash', shopId), {
      shopId,
      availableBalance: increment(amount),
      totalCollections: increment(amount),
      lastCashOperationId: 'branch-payment',
      lastCashOperationType: 'payment',
      updatedAt: timestamp
    }, { merge: true });
    return batch;
  };

  const initializedShopCash = (
    shopId: 'SHOP_A' | 'SHOP_S',
    availableBalance = 10_000,
    totalCollections = 12_000
  ) => ({
    shopId,
    availableBalance,
    totalCollections,
    totalExpenses: 2_000,
    totalTransferredIn: 500,
    totalTransferredOut: 500,
    openingBalance: 500,
    lastCashOperationId: shopId,
    lastCashOperationType: 'initialization',
    initializedAt: Timestamp.fromDate(new Date('2026-08-01T00:00:00.000Z')),
    initializedBy: 'admin-user',
    updatedAt: timestamp
  });

  const seedInitializedShops = async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'shopCash', 'SHOP_A'), initializedShopCash('SHOP_A'));
      await setDoc(doc(database, 'shopCash', 'SHOP_S'), initializedShopCash('SHOP_S', 20_000, 22_000));
    });
  };

  const addExpenseBatch = (
    testDatabase: unknown,
    shopId: 'SHOP_A' | 'SHOP_S',
    amount = 750,
    expenseId = 'expense-1'
  ) => {
    const database = testDatabase as Firestore;
    const batch = writeBatch(database);
    batch.set(doc(database, 'cashExpenses', expenseId), {
      shopId,
      amount,
      description: 'Delivery fuel',
      createdAt: serverTimestamp(),
      createdBy: 'team-user'
    });
    batch.update(doc(database, 'shopCash', shopId), {
      availableBalance: increment(-amount),
      totalExpenses: increment(amount),
      lastCashOperationId: expenseId,
      lastCashOperationType: 'expense',
      updatedAt: timestamp
    });
    return batch;
  };

  const addTransferBatch = (
    testDatabase: unknown,
    fromShopId: 'SHOP_A' | 'SHOP_S',
    toShopId: 'SHOP_A' | 'SHOP_S',
    amount = 2_000,
    transferId = 'transfer-1'
  ) => {
    const database = testDatabase as Firestore;
    const batch = writeBatch(database);
    batch.set(doc(database, 'shopTransfers', transferId), {
      fromShopId,
      toShopId,
      amount,
      note: 'Branch cash transfer',
      createdAt: serverTimestamp(),
      createdBy: 'team-user'
    });
    batch.update(doc(database, 'shopCash', fromShopId), {
      availableBalance: increment(-amount),
      totalTransferredOut: increment(amount),
      lastCashOperationId: transferId,
      lastCashOperationType: 'transfer',
      updatedAt: timestamp
    });
    batch.update(doc(database, 'shopCash', toShopId), {
      availableBalance: increment(amount),
      totalTransferredIn: increment(amount),
      lastCashOperationId: transferId,
      lastCashOperationType: 'transfer',
      updatedAt: timestamp
    });
    return batch;
  };

  const addAdjustmentBatch = (
    testDatabase: unknown,
    shopId: 'SHOP_A' | 'SHOP_S',
    direction: 'add' | 'deduct',
    amount = 1_000,
    adjustmentId = 'adjustment-1',
    summaryDelta = direction === 'add' ? amount : -amount
  ) => {
    const database = testDatabase as Firestore;
    const batch = writeBatch(database);
    batch.set(doc(database, 'cashAdjustments', adjustmentId), {
      shopId,
      amount,
      direction,
      reason: 'Opening transaction correction',
      createdAt: serverTimestamp(),
      createdBy: 'team-user'
    });
    batch.update(doc(database, 'shopCash', shopId), {
      availableBalance: increment(summaryDelta),
      lastCashOperationId: adjustmentId,
      lastCashOperationType: 'adjustment',
      updatedAt: timestamp
    });
    return batch;
  };

  const addInitializationBatch = (
    testDatabase: unknown,
    shopId: 'SHOP_A' | 'SHOP_S',
    openingBalance: number
  ) => {
    const database = testDatabase as Firestore;
    const batch = writeBatch(database);
    batch.set(doc(database, 'cashInitializations', shopId), {
      shopId,
      openingBalance,
      createdAt: serverTimestamp(),
      createdBy: 'team-user'
    });
    batch.set(doc(database, 'shopCash', shopId), {
      shopId,
      availableBalance: increment(openingBalance),
      totalCollections: increment(0),
      totalExpenses: increment(0),
      totalTransferredIn: increment(0),
      totalTransferredOut: increment(0),
      openingBalance: increment(openingBalance),
      lastCashOperationId: shopId,
      lastCashOperationType: 'initialization',
      initializedAt: serverTimestamp(),
      initializedBy: 'team-user',
      updatedAt: timestamp
    }, { merge: true });
    return batch;
  };

  it('allows assigned Staff to create a branch payment and cash increment for their shop', async () => {
    await seed('Staff', true, 'SHOP_A');
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addBranchReceiptBatch(database, 'SHOP_A').commit());
  });

  it('denies assigned Staff branch payment and cash writes for the other shop', async () => {
    await seed('Staff', true, 'SHOP_A');
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertFails(addBranchReceiptBatch(database, 'SHOP_S').commit());
  });

  it('allows legacy Staff to keep creating and editing legacy payments only', async () => {
    await seed('Staff');
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const legacyPaymentRef = doc(database, 'payments', 'legacy-payment');

    await assertSucceeds(setDoc(legacyPaymentRef, {
      customerId: 'customer-1',
      date: '2026-08-10',
      amount: 500,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    await assertSucceeds(setDoc(legacyPaymentRef, { amount: 450, updatedAt: timestamp }, { merge: true }));
    await assertFails(setDoc(doc(database, 'payments', 'forbidden-branch-payment'), branchReceipt('SHOP_A')));
  });

  it('allows assigned Staff to edit legacy payments without converting them', async () => {
    await seed('Staff', true, 'SHOP_A');
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'payments', 'legacy-payment'), {
        customerId: 'customer-1',
        date: '2026-08-10',
        amount: 500,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(setDoc(doc(database, 'payments', 'legacy-payment'), { amount: 450 }, { merge: true }));
  });

  it('allows transitional shopless Staff to edit a branch payment without changing its shop', async () => {
    await seed('Staff');
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'payments', 'branch-payment'), branchReceipt('SHOP_A'));
      await setDoc(doc(database, 'shopCash', 'SHOP_A'), {
        shopId: 'SHOP_A',
        availableBalance: 5000,
        totalCollections: 5000,
        updatedAt: timestamp
      });
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const batch = writeBatch(database);
    batch.update(doc(database, 'payments', 'branch-payment'), {
      amount: 4000,
      cashSyncedAmount: 4000,
      updatedAt: timestamp
    });
    batch.set(doc(database, 'shopCash', 'SHOP_A'), {
      shopId: 'SHOP_A',
      availableBalance: increment(-1000),
      totalCollections: increment(-1000),
      lastCashOperationId: 'branch-payment',
      lastCashOperationType: 'payment',
      updatedAt: timestamp
    }, { merge: true });

    await assertSucceeds(batch.commit());
  });

  it('allows Admin to atomically move a synced payment from ASHOKA to SMPA', async () => {
    await seed('Admin');
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'payments', 'branch-payment'), branchReceipt('SHOP_A'));
      await setDoc(doc(database, 'shopCash', 'SHOP_A'), {
        shopId: 'SHOP_A',
        availableBalance: 5000,
        totalCollections: 5000,
        updatedAt: timestamp
      });
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const batch = writeBatch(database);
    batch.update(doc(database, 'payments', 'branch-payment'), { shopId: 'SHOP_S', updatedAt: timestamp });
    batch.set(doc(database, 'shopCash', 'SHOP_A'), {
      shopId: 'SHOP_A',
      availableBalance: increment(-5000),
      totalCollections: increment(-5000),
      lastCashOperationId: 'branch-payment',
      lastCashOperationType: 'payment',
      updatedAt: timestamp
    }, { merge: true });
    batch.set(doc(database, 'shopCash', 'SHOP_S'), {
      shopId: 'SHOP_S',
      availableBalance: increment(5000),
      totalCollections: increment(5000),
      lastCashOperationId: 'branch-payment',
      lastCashOperationType: 'payment',
      updatedAt: timestamp
    }, { merge: true });

    await assertSucceeds(batch.commit());
  });

  it('denies assigned Staff from moving an existing payment to another shop', async () => {
    await seed('Staff', true, 'SHOP_A');
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'payments', 'branch-payment'), branchReceipt('SHOP_A'));
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertFails(setDoc(doc(database, 'payments', 'branch-payment'), { shopId: 'SHOP_S' }, { merge: true }));
  });

  it('denies mismatched cash fields and direct cross-shop cash updates', async () => {
    await seed('Staff', true, 'SHOP_A');
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    await assertFails(setDoc(doc(database, 'payments', 'bad-cash-payment'), {
      ...branchReceipt('SHOP_A'),
      cashSyncedAmount: 4000
    }));
    await assertFails(setDoc(doc(database, 'shopCash', 'SHOP_S'), {
      shopId: 'SHOP_S',
      availableBalance: 5000,
      totalCollections: 5000,
      updatedAt: timestamp
    }));
  });

  it('denies a direct own-shop collection increment without a matching payment mutation', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertFails(updateDoc(doc(database, 'shopCash', 'SHOP_A'), {
      availableBalance: increment(500),
      totalCollections: increment(500),
      updatedAt: timestamp
    }));
    await assertFails(setDoc(doc(database, 'payments', 'unpaired-payment'), branchReceipt('SHOP_A', 500)));
  });

  it('requires payment edits to apply their exact shop cash delta atomically', async () => {
    await seed('Staff', true, 'SHOP_A');
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'payments', 'branch-payment'), branchReceipt('SHOP_A'));
      await setDoc(doc(database, 'shopCash', 'SHOP_A'), {
        shopId: 'SHOP_A',
        availableBalance: 5_000,
        totalCollections: 5_000,
        updatedAt: timestamp
      });
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertFails(updateDoc(doc(database, 'payments', 'branch-payment'), {
      amount: 4_000,
      cashSyncedAmount: 4_000,
      updatedAt: timestamp
    }));
  });

  it('allows Admin to reverse one payment with an exact linked cash mutation', async () => {
    await seed('Admin');
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'payments', 'branch-payment'), branchReceipt('SHOP_A'));
      await setDoc(doc(database, 'shopCash', 'SHOP_A'), {
        shopId: 'SHOP_A',
        availableBalance: 5_000,
        totalCollections: 5_000,
        updatedAt: timestamp
      });
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const batch = writeBatch(database);
    batch.delete(doc(database, 'payments', 'branch-payment'));
    batch.update(doc(database, 'shopCash', 'SHOP_A'), {
      availableBalance: increment(-5_000),
      totalCollections: increment(-5_000),
      lastCashOperationId: 'branch-payment',
      lastCashOperationType: 'payment',
      updatedAt: timestamp
    });

    await assertSucceeds(batch.commit());
  });

  it('allows invoice deletion to reverse all linked payment cash in the same batch', async () => {
    await seed('Admin');
    const paymentCount = 25;
    const paymentAmount = 5_000;
    const totalAmount = paymentCount * paymentAmount;
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await Promise.all(Array.from({ length: paymentCount }, (_, index) => setDoc(
        doc(database, 'payments', `branch-payment-${index}`),
        branchReceipt('SHOP_A', paymentAmount)
      )));
      await setDoc(doc(database, 'shopCash', 'SHOP_A'), {
        shopId: 'SHOP_A',
        availableBalance: totalAmount,
        totalCollections: totalAmount,
        updatedAt: timestamp
      });
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const batch = writeBatch(database);
    Array.from({ length: paymentCount }, (_, index) => {
      batch.delete(doc(database, 'payments', `branch-payment-${index}`));
    });
    batch.delete(doc(database, 'invoices', 'invoice-1'));
    batch.update(doc(database, 'shopCash', 'SHOP_A'), {
      availableBalance: increment(-totalAmount),
      totalCollections: increment(-totalAmount),
      lastCashOperationId: 'invoice-1',
      lastCashOperationType: 'invoice_delete',
      updatedAt: timestamp
    });

    await assertSucceeds(batch.commit());
  });

  it('allows an assigned Staff expense only with its exact atomic summary delta', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addExpenseBatch(database, 'SHOP_A').commit());
    const summarySnapshot = await getDoc(doc(database, 'shopCash', 'SHOP_A'));
    expect(summarySnapshot.data()?.availableBalance).toBe(9_250);
    expect(summarySnapshot.data()?.totalExpenses).toBe(2_750);
    expect(summarySnapshot.data()?.totalCollections).toBe(12_000);
  });

  it('allows an audited Staff expense to take the available balance below zero', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addExpenseBatch(database, 'SHOP_A', 11_000, 'staff-pocket-expense').commit());
    const summarySnapshot = await getDoc(doc(database, 'shopCash', 'SHOP_A'));
    expect(summarySnapshot.data()?.availableBalance).toBe(-1_000);
    expect(summarySnapshot.data()?.totalExpenses).toBe(13_000);
  });

  it('denies expense writes for another branch and mismatched deltas', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertFails(addExpenseBatch(database, 'SHOP_S').commit());

    const mismatched = writeBatch(database);
    mismatched.set(doc(database, 'cashExpenses', 'expense-mismatch'), {
      shopId: 'SHOP_A',
      amount: 500,
      description: 'Fuel',
      createdAt: serverTimestamp(),
      createdBy: 'team-user'
    });
    mismatched.update(doc(database, 'shopCash', 'SHOP_A'), {
      availableBalance: increment(-400),
      totalExpenses: increment(500),
      lastCashOperationId: 'expense-mismatch',
      lastCashOperationType: 'expense',
      updatedAt: timestamp
    });
    await assertFails(mismatched.commit());
    await assertFails(updateDoc(doc(database, 'shopCash', 'SHOP_A'), {
      availableBalance: increment(-500),
      totalExpenses: increment(500),
      lastCashOperationId: 'missing-expense',
      lastCashOperationType: 'expense',
      updatedAt: timestamp
    }));
  });

  it('keeps expense audit records immutable and blocks operation ID replay', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addExpenseBatch(database, 'SHOP_A').commit());
    await assertFails(updateDoc(doc(database, 'cashExpenses', 'expense-1'), { amount: 1 }));
    await assertFails(deleteDoc(doc(database, 'cashExpenses', 'expense-1')));
    await assertFails(addExpenseBatch(database, 'SHOP_A').commit());
  });

  it('atomically transfers between initialized shops without changing collections', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addTransferBatch(database, 'SHOP_A', 'SHOP_S').commit());
    const sender = await getDoc(doc(database, 'shopCash', 'SHOP_A'));
    expect(sender.data()?.availableBalance).toBe(8_000);
    expect(sender.data()?.totalTransferredOut).toBe(2_500);
    expect(sender.data()?.totalCollections).toBe(12_000);

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const receiver = await getDoc(doc(context.firestore(), 'shopCash', 'SHOP_S'));
      expect(receiver.data()?.availableBalance).toBe(22_000);
      expect(receiver.data()?.totalTransferredIn).toBe(2_500);
      expect(receiver.data()?.totalCollections).toBe(22_000);
    });
  });

  it('denies transfer from another branch or without both exact summary updates', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertFails(addTransferBatch(database, 'SHOP_S', 'SHOP_A').commit());

    const incomplete = writeBatch(database);
    incomplete.set(doc(database, 'shopTransfers', 'transfer-incomplete'), {
      fromShopId: 'SHOP_A',
      toShopId: 'SHOP_S',
      amount: 500,
      note: '',
      createdAt: serverTimestamp(),
      createdBy: 'team-user'
    });
    incomplete.update(doc(database, 'shopCash', 'SHOP_A'), {
      availableBalance: increment(-500),
      totalTransferredOut: increment(500),
      lastCashOperationId: 'transfer-incomplete',
      lastCashOperationType: 'transfer',
      updatedAt: timestamp
    });
    await assertFails(incomplete.commit());
  });

  it('allows Admin to add or deduct an exact audited amount without changing collections', async () => {
    await seed('Admin');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addAdjustmentBatch(database, 'SHOP_A', 'add', 1_250, 'adjustment-add').commit());
    await assertSucceeds(addAdjustmentBatch(database, 'SHOP_A', 'deduct', 750, 'adjustment-deduct').commit());

    const summarySnapshot = await getDoc(doc(database, 'shopCash', 'SHOP_A'));
    expect(summarySnapshot.data()?.availableBalance).toBe(10_500);
    expect(summarySnapshot.data()?.totalCollections).toBe(12_000);
    expect(summarySnapshot.data()?.totalExpenses).toBe(2_000);
  });

  it('denies Staff, mismatched, unaudited, and negative Admin adjustments', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const staffDatabase = testEnvironment.authenticatedContext('team-user').firestore();
    await assertFails(addAdjustmentBatch(staffDatabase, 'SHOP_A', 'add').commit());

    await seed('Admin');
    const adminDatabase = testEnvironment.authenticatedContext('team-user').firestore();
    await assertFails(addAdjustmentBatch(adminDatabase, 'SHOP_A', 'add', 500, 'adjustment-mismatch', 400).commit());
    await assertFails(addAdjustmentBatch(adminDatabase, 'SHOP_A', 'deduct', 11_000, 'adjustment-too-large').commit());
    await assertFails(updateDoc(doc(adminDatabase, 'shopCash', 'SHOP_A'), {
      availableBalance: increment(500),
      lastCashOperationId: 'missing-adjustment',
      lastCashOperationType: 'adjustment',
      updatedAt: timestamp
    }));
  });

  it('keeps adjustment audits immutable and blocks operation ID replay', async () => {
    await seed('Admin');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addAdjustmentBatch(database, 'SHOP_A', 'add').commit());
    await assertFails(updateDoc(doc(database, 'cashAdjustments', 'adjustment-1'), { amount: 1 }));
    await assertFails(deleteDoc(doc(database, 'cashAdjustments', 'adjustment-1')));
    await assertFails(addAdjustmentBatch(database, 'SHOP_A', 'add').commit());
  });

  it('allows Admin to initialize an existing CRM summary without replacing collections', async () => {
    await seed('Admin');
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'shopCash', 'SHOP_A'), {
        shopId: 'SHOP_A',
        availableBalance: 5_000,
        totalCollections: 5_000,
        updatedAt: timestamp
      });
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addInitializationBatch(database, 'SHOP_A', 1_500).commit());
    const summarySnapshot = await getDoc(doc(database, 'shopCash', 'SHOP_A'));
    expect(summarySnapshot.data()?.availableBalance).toBe(6_500);
    expect(summarySnapshot.data()?.totalCollections).toBe(5_000);
    expect(summarySnapshot.data()?.openingBalance).toBe(1_500);
  });

  it('allows Admin to initialize an empty shop but denies Staff and repeat initialization', async () => {
    await seed('Staff', true, 'SHOP_A');
    const staffDatabase = testEnvironment.authenticatedContext('team-user').firestore();
    await assertFails(addInitializationBatch(staffDatabase, 'SHOP_A', 500).commit());

    await seed('Admin');
    const adminDatabase = testEnvironment.authenticatedContext('team-user').firestore();
    await assertSucceeds(addInitializationBatch(adminDatabase, 'SHOP_A', 500).commit());
    await assertFails(addInitializationBatch(adminDatabase, 'SHOP_A', 500).commit());
  });

  it('preserves initialized Cash App fields when CRM adds a later payment', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(addBranchReceiptBatch(database, 'SHOP_A', 5_000).commit());
    const summarySnapshot = await getDoc(doc(database, 'shopCash', 'SHOP_A'));
    expect(summarySnapshot.data()?.availableBalance).toBe(15_000);
    expect(summarySnapshot.data()?.totalCollections).toBe(17_000);
    expect(summarySnapshot.data()?.totalExpenses).toBe(2_000);
    expect(summarySnapshot.data()?.initializedBy).toBe('admin-user');
  });

  it('allows an assigned Staff payment correction even when spent cash makes availability negative', async () => {
    await seed('Staff', true, 'SHOP_A');
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'payments', 'branch-payment'), branchReceipt('SHOP_A'));
      await setDoc(doc(database, 'shopCash', 'SHOP_A'), initializedShopCash('SHOP_A', 1_000, 5_000));
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();
    const batch = writeBatch(database);
    batch.update(doc(database, 'payments', 'branch-payment'), {
      amount: 0,
      cashSyncedAmount: 0,
      updatedAt: timestamp
    });
    batch.update(doc(database, 'shopCash', 'SHOP_A'), {
      availableBalance: increment(-5_000),
      totalCollections: increment(-5_000),
      lastCashOperationId: 'branch-payment',
      lastCashOperationType: 'payment',
      updatedAt: timestamp
    });

    await assertSucceeds(batch.commit());
    const summarySnapshot = await getDoc(doc(database, 'shopCash', 'SHOP_A'));
    expect(summarySnapshot.data()?.availableBalance).toBe(-4_000);
    expect(summarySnapshot.data()?.totalCollections).toBe(0);
  });

  it('allows bounded own-branch history queries and denies unscoped or cross-branch reads', async () => {
    await seed('Staff', true, 'SHOP_A');
    await seedInitializedShops();
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'cashExpenses', 'expense-a'), {
        shopId: 'SHOP_A',
        amount: 100,
        description: 'ASHOKA expense',
        createdAt: Timestamp.fromDate(new Date('2026-08-10T00:00:00.000Z')),
        createdBy: 'team-user'
      });
      await setDoc(doc(database, 'cashExpenses', 'expense-s'), {
        shopId: 'SHOP_S',
        amount: 100,
        description: 'SMPA expense',
        createdAt: Timestamp.fromDate(new Date('2026-08-10T00:00:00.000Z')),
        createdBy: 'other-user'
      });
      await setDoc(doc(database, 'shopTransfers', 'transfer-a-to-s'), {
        fromShopId: 'SHOP_A',
        toShopId: 'SHOP_S',
        amount: 500,
        note: 'Outgoing',
        createdAt: Timestamp.fromDate(new Date('2026-08-11T00:00:00.000Z')),
        createdBy: 'team-user'
      });
      await setDoc(doc(database, 'shopTransfers', 'transfer-s-to-a'), {
        fromShopId: 'SHOP_S',
        toShopId: 'SHOP_A',
        amount: 500,
        note: 'Incoming',
        createdAt: Timestamp.fromDate(new Date('2026-08-12T00:00:00.000Z')),
        createdBy: 'other-user'
      });
      await setDoc(doc(database, 'cashAdjustments', 'adjustment-a'), {
        shopId: 'SHOP_A',
        amount: 250,
        direction: 'add',
        reason: 'ASHOKA correction',
        createdAt: Timestamp.fromDate(new Date('2026-08-13T00:00:00.000Z')),
        createdBy: 'admin-user'
      });
      await setDoc(doc(database, 'cashAdjustments', 'adjustment-s'), {
        shopId: 'SHOP_S',
        amount: 250,
        direction: 'deduct',
        reason: 'SMPA correction',
        createdAt: Timestamp.fromDate(new Date('2026-08-13T00:00:00.000Z')),
        createdBy: 'admin-user'
      });
    });
    const database = testEnvironment.authenticatedContext('team-user').firestore();

    await assertSucceeds(getDoc(doc(database, 'shopCash', 'SHOP_A')));
    await assertFails(getDoc(doc(database, 'shopCash', 'SHOP_S')));
    await assertSucceeds(getDoc(doc(database, 'cashExpenses', 'expense-a')));
    await assertFails(getDoc(doc(database, 'cashExpenses', 'expense-s')));
    await assertSucceeds(getDocs(query(
      collection(database, 'cashExpenses'),
      where('shopId', '==', 'SHOP_A'),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(collection(database, 'cashExpenses'), limit(10))));
    await assertFails(getDocs(query(
      collection(database, 'cashExpenses'),
      where('shopId', '==', 'SHOP_S'),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await assertSucceeds(getDocs(query(
      collection(database, 'shopTransfers'),
      where('fromShopId', '==', 'SHOP_A'),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await assertSucceeds(getDocs(query(
      collection(database, 'shopTransfers'),
      where('toShopId', '==', 'SHOP_A'),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(collection(database, 'shopTransfers'), limit(10))));
    await assertSucceeds(getDoc(doc(database, 'cashAdjustments', 'adjustment-a')));
    await assertFails(getDoc(doc(database, 'cashAdjustments', 'adjustment-s')));
    await assertSucceeds(getDocs(query(
      collection(database, 'cashAdjustments'),
      where('shopId', '==', 'SHOP_A'),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
    await assertFails(getDocs(query(collection(database, 'cashAdjustments'), limit(10))));
    await assertFails(getDocs(query(
      collection(database, 'cashAdjustments'),
      where('shopId', '==', 'SHOP_S'),
      orderBy('createdAt', 'desc'),
      limit(10)
    )));
  });
});
