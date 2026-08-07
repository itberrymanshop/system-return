'use strict';
const db = require('../config/database');
const returnService = require('../services/returnService');

async function testWriteOffPending() {
  console.log('--- Starting Integration Test for Write-Off Queue ---');
  try {
    // 1. Create a return with an item
    const mockReturn = {
      return_date: '2026-07-07',
      customer_name: 'Test WriteOff',
      customer_contact: '081234567890',
      source_type: 'external_expedisi',
      return_reason: 'Testing write_off perbaikan status',
      return_category: 'pecah',
      current_status: 'Sorting',
      resi_number: 'RESI-TEST-WO-999',
      resi_courier: 'JNE',
      no_pesanan: 'OMS-TEST-WO-999'
    };

    const mockItems = [
      {
        item_code: 'SKU-WO-999',
        item_name: 'Gelas Pecah',
        quantity: 1,
        unit_price: 25000,
        return_category: 'pecah',
        condition_received: 'damaged'
      }
    ];

    const result = await returnService.createReturn(mockReturn, mockItems, 1);
    const returnId = result.returnId;
    console.log(`Created test return ID: ${returnId}`);

    // Verify initial perbaikan_status is null
    const [[initialItem]] = await db.query(
      'SELECT item_id, perbaikan_status, disposition FROM return_items WHERE return_id = ?',
      [returnId]
    );
    console.log('Initial perbaikan_status:', initialItem.perbaikan_status);
    console.log('Initial disposition:', initialItem.disposition);

    // 2. Perform QC / sorting process to set disposition as write_off
    console.log('Updating item QC to "write_off"...');
    await returnService.updateItemQC(initialItem.item_id, {
      disposition: 'write_off',
      physical_location: 'BIN-TRASH-1',
      item_category: 'Non Elektronik'
    });

    // 3. Verify perbaikan_status is now 'pending'
    const [[updatedItem]] = await db.query(
      'SELECT perbaikan_status, disposition FROM return_items WHERE item_id = ?',
      [initialItem.item_id]
    );
    console.log('Updated perbaikan_status:', updatedItem.perbaikan_status);
    console.log('Updated disposition:', updatedItem.disposition);

    if (updatedItem.disposition !== 'write_off' || updatedItem.perbaikan_status !== 'pending') {
      throw new Error('Verification failed! disposition should be write_off and perbaikan_status should be pending!');
    }

    console.log('✅ TEST PASSED: write_off items now enter perbaikan queue as pending!');

    // Cleanup
    await db.query('DELETE FROM inventory_stock WHERE return_id = ?', [returnId]);
    await db.query('DELETE FROM return_items WHERE return_id = ?', [returnId]);
    await db.query('DELETE FROM returns WHERE return_id = ?', [returnId]);
    console.log('✅ Cleanup completed.');
  } catch (err) {
    console.error('❌ TEST FAILED:', err);
  } finally {
    db.end();
  }
}

testWriteOffPending();
