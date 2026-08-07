'use strict';
const db = require('../config/database');
const returnService = require('../services/returnService');
const dateHelper = require('../utils/dateHelper');

async function testBaikCreation() {
  console.log('--- Starting Integration Test for Condition "Baik" ---');
  try {
    const mockData = {
      return_date: '2026-07-07',
      customer_name: 'Test Customer Baik',
      customer_contact: '081234567890',
      source_type: 'external_expedisi',
      return_reason: 'Testing auto-complete for baik condition',
      return_category: 'baik',
      current_status: 'Completed', // set by controller
      completed_date: dateHelper.getJakartaDateTimeString(),
      resi_number: 'RESI-TEST-BAIK-999',
      resi_courier: 'JNE',
      no_pesanan: 'OMS-TEST-BAIK-999'
    };

    const mockItems = [
      {
        item_code: 'SKU-BAIK-999',
        item_name: 'Sabun Mandi Wangi',
        quantity: 5,
        unit_price: 15000,
        return_category: 'baik',
        condition_received: 'good'
      }
    ];

    // Create the return
    console.log('Inserting mock return with "baik" condition...');
    const result = await returnService.createReturn(mockData, mockItems, 1);
    const returnId = result.returnId;
    console.log(`Created return ID: ${returnId}, Return Number: ${result.returnNumber}`);

    // Verify returns table record
    const [[retRow]] = await db.query(
      'SELECT current_status, completed_date FROM returns WHERE return_id = ?',
      [returnId]
    );
    console.log('Verified return status:', retRow.current_status);
    console.log('Verified completed date:', retRow.completed_date);

    if (retRow.current_status !== 'Completed' || !retRow.completed_date) {
      throw new Error('Return status is not Completed or completed_date is missing!');
    }

    // Verify return_items table record
    const [[itemRow]] = await db.query(
      'SELECT item_id, disposition, qc_status, inspection_result FROM return_items WHERE return_id = ?',
      [returnId]
    );
    console.log('Verified item disposition:', itemRow.disposition);
    console.log('Verified item QC status:', itemRow.qc_status);
    console.log('Verified item inspection result:', itemRow.inspection_result);

    if (itemRow.disposition !== 'restock' || itemRow.qc_status !== 'lulus' || itemRow.inspection_result !== 'accept') {
      throw new Error('Item disposition is not restock, qc_status is not lulus, or inspection_result is not accept!');
    }

    // Verify inventory_stock table record
    const [[stockRow]] = await db.query(
      'SELECT category, status FROM inventory_stock WHERE return_id = ? AND item_id = ?',
      [returnId, itemRow.item_id]
    );
    console.log('Verified inventory stock category:', stockRow ? stockRow.category : 'NOT FOUND');
    console.log('Verified inventory stock status:', stockRow ? stockRow.status : 'NOT FOUND');

    if (!stockRow || stockRow.category !== 'stok_utama' || stockRow.status !== 'tersedia') {
      throw new Error('Inventory stock entry is missing or incorrect!');
    }

    console.log('✅ ALL TEST EXPECTATIONS PASSED SUCCESSFULLY!');

    // Cleanup
    console.log('Cleaning up test records from database...');
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

testBaikCreation();
