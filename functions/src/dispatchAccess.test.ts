import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveShopIds} from './dispatchAdmin';
test('Admin always has both source shops while Staff/Manager retain assigned-shop scope',()=>{
 assert.deepEqual(effectiveShopIds('ADMIN',['SHOP_A']),['SHOP_A','SHOP_S']);
 assert.deepEqual(effectiveShopIds('ADMIN',['SHOP_S']),['SHOP_A','SHOP_S']);
 assert.deepEqual(effectiveShopIds('MANAGER',['SHOP_A']),['SHOP_A']);
 assert.deepEqual(effectiveShopIds('MANAGER',['SHOP_S']),['SHOP_S']);
 assert.deepEqual(effectiveShopIds('DRIVER',['SHOP_A']),['SHOP_A']);
});
