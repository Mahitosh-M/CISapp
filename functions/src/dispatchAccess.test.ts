import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveShopIds} from './dispatchAdmin';
import {scopedState} from './dispatchOperations';
import {emptyState} from './dispatchDomain/emptyState';
import type {Trip} from './dispatchDomain/domain';
test('Admin always has both source shops while Staff/Manager retain assigned-shop scope',()=>{
 assert.deepEqual(effectiveShopIds('ADMIN',['SHOP_A']),['SHOP_A','SHOP_S']);
 assert.deepEqual(effectiveShopIds('ADMIN',['SHOP_S']),['SHOP_A','SHOP_S']);
 assert.deepEqual(effectiveShopIds('MANAGER',['SHOP_A']),['SHOP_A']);
 assert.deepEqual(effectiveShopIds('MANAGER',['SHOP_S']),['SHOP_S']);
 assert.deepEqual(effectiveShopIds('DRIVER',['SHOP_A']),['SHOP_A']);
});
test('Drivers receive assigned published trips without unreleased planning records',()=>{
 const s=emptyState();s.trips=[{id:'draft',status:'Draft',startShopId:'SHOP_A',primaryDriverId:'driver',companionId:null,stops:[]},{id:'released',status:'Released',startShopId:'SHOP_A',primaryDriverId:'driver',companionId:null,stops:[]},{id:'other',status:'Released',startShopId:'SHOP_A',primaryDriverId:'someone-else',companionId:null,stops:[]}] as unknown as Trip[];
 const state=scopedState({uid:'driver',issuer:'delivery-28165',actorId:'driver',name:'Driver',role:'DRIVER',shopIds:['SHOP_A']},s);assert.deepEqual(state.trips.map(t=>t.id),['released']);
});
