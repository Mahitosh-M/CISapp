import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { roundCashBalance } from '../../src/utils/wholeRupees';

/** Invoked in the write phase of an already-authorised financial transaction. */
export function serverCashBalanceFields(tx: Transaction, db: Firestore, shopId: string, before: number, delta: number, operationId: string, uid: string) {
  const result = roundCashBalance(before, delta);
  let roundingAuditId: string | null = null;
  if (result.adjustment !== 0) {
    const audit = db.collection('cashAdjustments').doc();
    roundingAuditId = audit.id;
    tx.create(audit, {shopId,amount:Math.abs(result.adjustment),direction:result.adjustment>0?'add':'deduct',reason:`Whole-rupee rounding: ${result.rawBalance} -> ${result.availableBalance}; operation ${operationId.slice(0,50)}`,createdAt:FieldValue.serverTimestamp(),createdBy:uid});
  }
  return {availableBalance:result.availableBalance,roundingDelta:result.adjustment,roundingAuditId};
}
