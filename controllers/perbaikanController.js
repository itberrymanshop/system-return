'use strict';
const returnService = require('../services/returnService');
const slaService = require('../services/slaService');
const slaHelper = require('../services/slaHelper');
const reportService = require('../services/reportService');
const db = require('../config/database');

// ─── Queue: items awaiting / in perbaikan ────────────────────────────────────
exports.perbaikanQueue = async (req, res, next) => {
  try {
    // 1. Fetch Grace Period SLA for Refurbish to determine grace hours
    const [slaRows] = await db.query(
      `SELECT sla_hours FROM sla_configs 
       WHERE sla_type = 'MASA_TENGGANG' AND code_trigger_2 = 'Refurbish' AND is_active = 1
       LIMIT 1`
    );
    const graceHours = slaRows.length > 0 ? slaRows[0].sla_hours : 336; // Fallback to 336 hours (14 days)

    // 2. Fetch return items in Repair (disposition in 'rekondisi', 'refurbish' and perbaikan_status = 'pending')
    // whose grace period has passed. Start time of grace period starts from ri.inspected_at,
    // falling back to r.inbound_date, falling back to r.return_date.
    const [expiredItems] = await db.query(`
      SELECT ri.item_id, ri.return_id, ri.item_code, ri.quantity
      FROM return_items ri
      JOIN returns r ON ri.return_id = r.return_id
      WHERE ri.disposition IN ('rekondisi', 'refurbish')
        AND ri.perbaikan_status = 'pending'
        AND DATE_ADD(COALESCE(ri.inspected_at, r.inbound_date, r.return_date), INTERVAL ? HOUR) < NOW()
    `, [graceHours]);

    if (expiredItems.length > 0) {
      const itemIds = expiredItems.map(item => item.item_id);

      // Update disposition to write_off for expired items
      await db.query(`
        UPDATE return_items
        SET disposition = 'write_off',
            perbaikan_status = NULL,
            qc_status = 'tidak_lulus',
            updated_at = NOW()
        WHERE item_id IN (?)
      `, [itemIds]);

      // Update inventory category to write_off
      await db.query(`
        UPDATE inventory_stock
        SET category = 'write_off',
            updated_at = NOW()
        WHERE item_id IN (?)
      `, [itemIds]);

      const systemUserId = req.session.userId || 1;
      for (const item of expiredItems) {
        await reportService.logActivity(systemUserId, 'auto_write_off',
          `SKU ${item.item_code} otomatis masuk ke write off karena melewati SLA Masa Tenggang (${graceHours} jam)`, req.ip, req.headers['user-agent']);
      }

      // Group by return_id to check if we need to complete the return(s)
      const uniqueReturnIds = [...new Set(expiredItems.map(item => item.return_id))];
      for (const returnId of uniqueReturnIds) {
        const [allItems] = await db.query(
          'SELECT item_id, disposition, perbaikan_status FROM return_items WHERE return_id = ?',
          [returnId]
        );

        const isAllResolved = allItems.every(it => {
          if (!it.disposition || it.disposition === 'pending') return false;
          if (['rekondisi', 'refurbish'].includes(it.disposition)) {
            return it.perbaikan_status && it.perbaikan_status !== 'pending';
          }
          return true;
        });

        if (isAllResolved) {
          const [[ret]] = await db.query('SELECT current_status FROM returns WHERE return_id = ?', [returnId]);
          if (ret && ret.current_status !== 'Completed') {
            await slaHelper.completeActiveStage(returnId);
            await returnService.updateStatus(returnId, ret.current_status, 'Completed',
              'Semua item perbaikan selesai (Auto Write-off SLA Masa Tenggang)', '', systemUserId);

            // Check if all items in this return are write_off. If so, set return product_category to 'write_off'
            const isAllWriteOff = allItems.every(it => it.disposition === 'write_off');
            const returnCategoryUpdate = isAllWriteOff ? ", product_category = 'write_off'" : "";

            await db.query(`UPDATE returns SET completed_date = NOW() ${returnCategoryUpdate} WHERE return_id = ?`, [returnId]);
            await reportService.logActivity(systemUserId, 'complete_return_perbaikan',
              `Return #${returnId} otomatis Completed setelah perbaikan selesai (Auto Write-off)`, req.ip, req.headers['user-agent']);
          }
        }
      }
    }

    const type = req.query.type || 'rekondisi';
    const currentType = ['rekondisi', 'refurbish', 'write_off'].includes(type) ? type : 'rekondisi';

    // 3. Fetch current Perbaikan queue items (selecting ri.inspected_at)
    const [perbaikanItems] = await db.query(`
      SELECT ri.item_id,
             ri.item_code AS sku,
             ri.item_name,
             ri.quantity,
             ri.disposition,
             ri.return_category,
             ri.item_category,
             ri.ikut,
             ri.ikut_wo,
             ri.perbaikan_status,
             ri.inspected_at,
             r.return_id,
             r.return_number,
             r.return_date,
             r.inbound_date,
             r.sla_deadline,
             r.source_type,
             r.resi_courier,
             r.resi_number,
             u1.full_name AS pic_name,
             u2.full_name AS inspector_name,
             DATEDIFF(NOW(), r.return_date) AS aging_days
      FROM return_items ri
      JOIN returns r ON ri.return_id = r.return_id
      LEFT JOIN users u1 ON r.pic_user_id      = u1.user_id
      LEFT JOIN users u2 ON r.inspector_user_id = u2.user_id
      WHERE ri.disposition = ? AND ri.perbaikan_status = 'pending'
      ORDER BY r.sla_deadline ASC, r.return_date ASC
    `, [currentType]);

    // 4. Annotate SLA status on each row for Perbaikan items (per-item calculated deadline)
    const slaAlerts = await slaService.getSLAAlerts();
    perbaikanItems.forEach(item => {
      const startDate = item.inspected_at || item.inbound_date || item.return_date;
      const itemSlaDeadline = new Date(new Date(startDate).getTime() + graceHours * 60 * 60 * 1000);
      item.sla_deadline = itemSlaDeadline;
      item.slaInfo = slaService.getSLAStatus(itemSlaDeadline);
      item.slaAlert = item.slaInfo.status === 'overdue' || item.slaInfo.status === 'critical';
    });

    res.render('perbaikan/proses', { title: 'Proses Perbaikan', perbaikanItems, slaAlerts, type: currentType });
  } catch (err) { next(err); }
};

exports.bulkUpdatePerbaikanStatus = async (req, res, next) => {
  try {
    const type = req.query.type || 'rekondisi';
    const currentType = ['rekondisi', 'refurbish', 'write_off'].includes(type) ? type : 'rekondisi';

    let { item_ids, action } = req.body;
    if (!item_ids || !action) {
      req.flash('error', 'Silakan pilih SKU dan tentukan tindakan perbaikan.');
      return res.redirect('/perbaikan?type=' + currentType);
    }

    if (!Array.isArray(item_ids)) {
      item_ids = [item_ids];
    }

    const itemIds = item_ids
      .map(id => parseInt(id, 10))
      .filter(id => !Number.isNaN(id));

    if (itemIds.length === 0 || !['rekondisi', 'recovery'].includes(action)) {
      req.flash('error', 'Data perbaikan tidak valid.');
      return res.redirect('/perbaikan?type=' + currentType);
    }

    const placeholders = itemIds.map(() => '?').join(',');
    const [items] = await db.query(
      `SELECT item_id, return_id, item_code FROM return_items WHERE item_id IN (${placeholders})`,
      itemIds
    );

    if (!items.length) {
      req.flash('error', 'Tidak ada SKU yang ditemukan.');
      return res.redirect('/perbaikan?type=' + currentType);
    }

    await db.query(
      `UPDATE return_items 
       SET perbaikan_status = ?,
           current_status = CASE 
             WHEN disposition = 'write_off' THEN 'Write_Off'
             WHEN disposition = 'rekondisi' THEN 'Rekondisi'
             WHEN disposition = 'refurbish' THEN 'Refurbish'
             ELSE current_status
           END
       WHERE item_id IN (${placeholders})`,
      [action, ...itemIds]
    );

    const returnIds = [...new Set(items.map(item => item.return_id))];
    const userId = req.session.userId;

    for (const returnId of returnIds) {
      const [allItems] = await db.query(
        'SELECT disposition, perbaikan_status FROM return_items WHERE return_id = ?',
        [returnId]
      );

      const isAllResolved = allItems.every(it => {
        if (!it.disposition || it.disposition === 'pending') return false;
        if (['rekondisi', 'refurbish', 'write_off'].includes(it.disposition)) {
          return it.perbaikan_status && it.perbaikan_status !== 'pending';
        }
        return true;
      });

      if (isAllResolved) {
        const [[ret]] = await db.query('SELECT current_status FROM returns WHERE return_id = ?', [returnId]);
        if (ret) {
          await slaHelper.completeActiveStage(returnId);
          await returnService.updateStatus(returnId, ret.current_status, 'Completed',
            'Semua item perbaikan selesai', '', userId);
          await db.query('UPDATE returns SET completed_date = NOW() WHERE return_id = ?', [returnId]);
          await reportService.logActivity(userId, 'complete_return_perbaikan',
            `Return #${returnId} otomatis Completed setelah perbaikan selesai`, req.ip, req.headers['user-agent']);
        }
      }
    }

    await reportService.logActivity(userId, 'bulk_update_perbaikan_status',
      `Bulk update ${itemIds.length} SKU perbaikan -> ${action}`, req.ip, req.headers['user-agent']);

    req.flash('success', `Berhasil mengupdate status perbaikan ${itemIds.length} SKU menjadi ${action.toUpperCase()}.`);
    res.redirect('/perbaikan?type=' + currentType);
  } catch (err) {
    next(err);
  }
};

exports.updatePerbaikanStatus = async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.itemId);
    const { action } = req.body; // 'rekondisi' or 'recovery'
    const userId = req.session.userId;

    if (!['rekondisi', 'recovery'].includes(action)) {
      req.flash('error', 'Tindakan perbaikan tidak valid.');
      return res.redirect('/perbaikan');
    }

    // 1. Get the return item to check if it exists and find the return_id
    const [[item]] = await db.query(
      'SELECT return_id, item_code FROM return_items WHERE item_id = ?',
      [itemId]
    );
    if (!item) {
      req.flash('error', 'Item tidak ditemukan.');
      return res.redirect('/perbaikan');
    }
    const returnId = item.return_id;

    // 2. Update perbaikan_status
    await db.query(
      `UPDATE return_items 
       SET perbaikan_status = ?,
           current_status = CASE 
             WHEN disposition = 'write_off' THEN 'Write_Off'
             WHEN disposition = 'rekondisi' THEN 'Rekondisi'
             WHEN disposition = 'refurbish' THEN 'Refurbish'
             ELSE current_status
           END
       WHERE item_id = ?`,
      [action, itemId]
    );

    // 3. Log activity
    await reportService.logActivity(userId, 'update_perbaikan_status',
      `Update status perbaikan SKU ${item.item_code} (#${itemId}) -> ${action}`, req.ip, req.headers['user-agent']);

    // 4. Check if all items in this return are resolved/completed
    const [allItems] = await db.query(
      'SELECT item_id, disposition, perbaikan_status FROM return_items WHERE return_id = ?',
      [returnId]
    );
    
    const isAllResolved = allItems.every(it => {
      if (!it.disposition || it.disposition === 'pending') return false;
      if (['rekondisi', 'refurbish'].includes(it.disposition)) {
        return it.perbaikan_status && it.perbaikan_status !== 'pending';
      }
      return true;
    });

    if (isAllResolved) {
      // Get return current status to log history
      const [[ret]] = await db.query('SELECT current_status FROM returns WHERE return_id = ?', [returnId]);
      
      // Complete any active SLA stage
      await slaHelper.completeActiveStage(returnId);

      // Update return status to Completed
      await returnService.updateStatus(returnId, ret.current_status, 'Completed',
        'Semua item perbaikan selesai', '', userId);
        
      // Update completed_date
      await db.query('UPDATE returns SET completed_date = NOW() WHERE return_id = ?', [returnId]);
      
      await reportService.logActivity(userId, 'complete_return_perbaikan',
        `Return #${returnId} otomatis Completed setelah perbaikan selesai`, req.ip, req.headers['user-agent']);
    }

    req.flash('success', `Berhasil mengupdate status perbaikan menjadi ${action.toUpperCase()} (Selesai).`);
    res.redirect('/perbaikan');
  } catch (err) { next(err); }
};
