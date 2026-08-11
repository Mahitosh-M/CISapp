import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithFirestoreEmulator = emulatorAddress ? describe : describe.skip;
const timestamp = '2026-08-11T00:00:00.000Z';

describeWithFirestoreEmulator('PC Firestore permissions', () => {
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

  const seed = async (role: 'Admin' | 'Staff', includeBalance = true) => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'users', 'team-user'), {
        active: true,
        role
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
});
