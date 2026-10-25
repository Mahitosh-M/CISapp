import {FieldValue, type Firestore, type Transaction} from 'firebase-admin/firestore';
import type {AppState, Fuel} from './dispatchDomain/domain';
import {identifier, requireValue, stableId} from './dispatchCore';
import type {DispatchIdentity} from './dispatchAdmin';

// Preparation performs reads only. Commit runs after every operational read.
// These are the same cashExpenses/shopCash records consumed by CashApp.
export async function prepareFuelCashPosting(tx:Transaction, db:Firestore, s:AppState, fuel:Fuel, actor:DispatchIdentity) {
  if (fuel.status !== 'Approved' || (fuel.source === 'Personal' && fuel.reimbursement !== 'Settled')) return null;
  const id=stableId('dispatch-fuel',identifier(fuel.id));
  const expenseRef=db.doc(`cashExpenses/${id}`), markerRef=db.doc(`dispatchFuelPostings/${id}`);
  const summaryRef=db.doc(`shopCash/${identifier(fuel.shopId)}`);
  const [expense,marker,summary]=await Promise.all([tx.get(expenseRef),tx.get(markerRef),tx.get(summaryRef)]);
  if (marker.exists || expense.exists) {
    requireValue(marker.exists && expense.exists && marker.data()?.fuelId===fuel.id && marker.data()?.amountPaise===fuel.amount && expense.data()?.dispatchFuelId===fuel.id, 'Fuel posting requires accounting review; it will not be duplicated');
    fuel.cashExpenseId=id;fuel.cashPostedAt=marker.data()!.postedAt;
    return null;
  }
  requireValue(!fuel.cashExpenseId,'Existing fuel posting requires accounting review');
  requireValue(summary.exists && summary.data()?.initializedAt,'Initialize this shop in CashApp before confirming paid diesel');
  requireValue(Number.isSafeInteger(fuel.amount) && fuel.amount>0,'Invalid fuel bill');
  requireValue(Number.isFinite(summary.data()?.availableBalance) && Number.isFinite(summary.data()?.totalExpenses),'CashApp balance requires review');
  const postedAt=new Date().toISOString(), amount=fuel.amount/100;
  const trip=s.trips.find(t=>t.id===fuel.tripId);
  const vehicle=s.vehicles.find(v=>v.id===fuel.vehicleId);
  fuel.cashExpenseId=id;fuel.cashPostedAt=postedAt;
  return {commit() {
    tx.create(expenseRef,{shopId:fuel.shopId,amount,category:'fuel',description:`Diesel · ${vehicle?.registration??fuel.vehicleId} · ${trip?.name??fuel.tripId}`,createdAt:FieldValue.serverTimestamp(),createdBy:actor.uid,source:'CIS Dispatch',dispatchFuelId:fuel.id,dispatchTripId:fuel.tripId,paymentSource:fuel.source,purchasedAt:fuel.at});
    tx.create(markerRef,{fuelId:fuel.id,tripId:fuel.tripId,shopId:fuel.shopId,amountPaise:fuel.amount,expenseId:id,actorId:actor.actorId,postedAt});
    tx.update(summaryRef,{availableBalance:FieldValue.increment(-amount),totalExpenses:FieldValue.increment(amount),lastCashOperationId:id,lastCashOperationType:'expense',updatedAt:postedAt});
    tx.create(db.collection('dispatchAudit').doc(),{entityType:'fuel',entityId:fuel.id,action:'Diesel posted to CashApp',expenseId:id,amountPaise:fuel.amount,actorId:actor.actorId,at:postedAt});
  }};
}
