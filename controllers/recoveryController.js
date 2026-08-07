'use strict';
const returnService = require('../services/returnService');
const slaService = require('../services/slaService');
const slaHelper = require('../services/slaHelper');
const inventoryService = require('../services/inventoryService');
const baService = require('../services/baService');
const reportService = require('../services/reportService');
const db = require('../config/database');
const dateHelper = require('../utils/dateHelper');

// ─── Recovery Queue ───────────────────────────────────────────────────────────
exports.queue = async (req, res, next) => {
  try {
    const type = req.query.type || 'refurbish';
    req.query.type = type;
    
    // Fetch dynamic SLA hours
    const [slaWriteOff] = await db.query(
      "SELECT sla_hours FROM sla_configs WHERE code_name = 'SLA Recover' AND code_trigger_2 = 'Write off' AND is_active = 1 LIMIT 1"
    );
    const writeOffHours = slaWriteOff.length > 0 ? slaWriteOff[0].sla_hours : 72;

    const [slaRefurbish] = await db.query(
      "SELECT sla_hours FROM sla_configs WHERE code_name = 'SLA Recover' AND code_trigger_2 = 'Refurbish' AND is_active = 1 AND sla_type = 'MASA_TENGGANG' LIMIT 1"
    );
    const refurbishHours = slaRefurbish.length > 0 ? slaRefurbish[0].sla_hours : 336;

    const returns = await returnService.getRecoveryQueue(req.query);
    
    returns.forEach(item => {
      // Calculate SKU-specific SLA deadline
      const startDate = item.approved_at || item.inspected_at || item.inbound_date || item.return_date;
      const hours = (type === 'write_off') ? writeOffHours : refurbishHours;
      const itemSlaDeadline = new Date(new Date(startDate).getTime() + hours * 60 * 60 * 1000);
      
      item.sla_deadline = itemSlaDeadline;
      item.slaInfo = slaService.getSLAStatus(itemSlaDeadline);
    });

    const vendors = await baService.getVendors();

    const title = type === 'write_off' ? 'Write-Off' : 'Refurbish';
    res.render('recovery/queue', {
      title: `${title} Queue`,
      returns,
      vendors,
      filters: req.query
    });
  } catch (err) { next(err); }
};

// ─── Recovery Item Detail ─────────────────────────────────────────────────────
exports.viewItem = async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.itemId, 10);
    const [[item]] = await db.query('SELECT * FROM return_items WHERE item_id = ?', [itemId]);
    if (!item) {
      req.flash('error', 'Item not found.');
      return res.redirect('/recovery');
    }

    const returnId = item.return_id;
    const ret = await returnService.getReturnById(returnId);
    if (!ret) {
      req.flash('error', 'Return not found.');
      return res.redirect('/recovery');
    }

    // Filter ret.items to only contain the target item!
    ret.items = ret.items.filter(it => it.item_id === itemId);

    // Override parent return's category properties with the item's disposition
    ret.product_category = item.disposition;
    ret.product_categorys = item.disposition;

    const vendors = await baService.getVendors();
    const [priceHistory] = await db.query(`
      SELECT ps.*, u.full_name AS submitted_by_name, u2.full_name AS reviewed_by_name
      FROM price_submissions ps
      LEFT JOIN users u  ON ps.submitted_by = u.user_id
      LEFT JOIN users u2 ON ps.reviewed_by  = u2.user_id
      WHERE ps.item_id = ? OR (ps.item_id IS NULL AND ps.return_id = ?)
      ORDER BY ps.submission_date DESC
    `, [itemId, returnId]);

    // Ensure this item has inventory_stock record
    const [existingStocks] = await db.query(
      'SELECT * FROM inventory_stock WHERE return_id = ? AND item_id = ?',
      [returnId, itemId]
    );
    let stockItems = existingStocks;

    if (!existingStocks.length) {
      const category = item.disposition || 'rekondisi';
      const stockId = await inventoryService.addInventoryEntry({
        return_id: returnId,
        item_id: itemId,
        category: category,
        location: item.physical_location || null,
        status: 'tersedia',
        entry_date: dateHelper.getJakartaDateString()
      });
      const [[newStock]] = await db.query('SELECT * FROM inventory_stock WHERE stock_id = ?', [stockId]);
      stockItems = [newStock];
    }

    // Fetch dynamic SLA hours and calculate item-specific SLA
    const [slaWriteOff] = await db.query(
      "SELECT sla_hours FROM sla_configs WHERE code_name = 'SLA Recover' AND code_trigger_2 = 'Write off' AND is_active = 1 LIMIT 1"
    );
    const writeOffHours = slaWriteOff.length > 0 ? slaWriteOff[0].sla_hours : 72;

    const [slaRefurbish] = await db.query(
      "SELECT sla_hours FROM sla_configs WHERE code_name = 'SLA Recover' AND code_trigger_2 = 'Refurbish' AND is_active = 1 AND sla_type = 'MASA_TENGGANG' LIMIT 1"
    );
    const refurbishHours = slaRefurbish.length > 0 ? slaRefurbish[0].sla_hours : 336;

    const [[approvedSub]] = await db.query(
      "SELECT review_date FROM price_submissions WHERE item_id = ? AND status = 'approved' ORDER BY review_date DESC LIMIT 1",
      [itemId]
    );

    const startDate = (approvedSub && approvedSub.review_date) || item.inspected_at || ret.inbound_date || ret.return_date;
    const hours = (item.disposition === 'write_off') ? writeOffHours : refurbishHours;
    const itemSlaDeadline = new Date(new Date(startDate).getTime() + hours * 60 * 60 * 1000);
    
    ret.sla_deadline = itemSlaDeadline;
    const slaInfo = slaService.getSLAStatus(itemSlaDeadline);

    res.render('recovery/view', {
      title: `Recovery Item - ${item.item_code || item.sku}`,
      ret,
      vendors,
      priceHistory,
      stockItems,
      slaInfo,
      targetItemId: itemId
    });
  } catch (err) { next(err); }
};

// ─── Recovery Detail ──────────────────────────────────────────────────────────
exports.view = async (req, res, next) => {
  try {
    const ret = await returnService.getReturnById(parseInt(req.params.id));

    if (!ret) { req.flash('error', 'Return not found.'); return res.redirect('/recovery'); }

    const vendors = await baService.getVendors();
    const [priceHistory] = await db.query(`
      SELECT ps.*, u.full_name AS submitted_by_name, u2.full_name AS reviewed_by_name
      FROM price_submissions ps
      LEFT JOIN users u  ON ps.submitted_by = u.user_id
      LEFT JOIN users u2 ON ps.reviewed_by  = u2.user_id
      WHERE ps.return_id = ?
      ORDER BY ps.submission_date DESC
    `, [ret.return_id]);

    // Ensure all items have inventory_stock records if in recovery stage
    const [existingStocks] = await db.query(
      'SELECT item_id FROM inventory_stock WHERE return_id = ?',
      [ret.return_id]
    );
    const existingItemIds = new Set(existingStocks.map(s => s.item_id));

    for (const item of ret.items) {
      if (!existingItemIds.has(item.item_id)) {
        const category = ret.product_categorys || 'rekondisi';

        // Auto-heal returns.product_category if it is NULL
        if (!ret.product_categorys) {
          ret.product_categorys = category;
          await db.query('UPDATE returns SET product_category = ? WHERE return_id = ?', [category, ret.return_id]);
        }

        await inventoryService.addInventoryEntry({
          return_id: ret.return_id,
          item_id: item.item_id,
          category: category,
          location: item.physical_location || null,
          status: 'tersedia',
          entry_date: dateHelper.getJakartaDateString()
        });
      }
    }

    const [stockItems] = await db.query(`
      SELECT s.*, ri.item_name, ri.item_code
      FROM inventory_stock s
      JOIN return_items ri ON s.item_id = ri.item_id
      WHERE s.return_id = ?
    `, [ret.return_id]);

    res.render('recovery/view', {
      title: `Recovery – ${ret.return_number}`,
      ret,
      vendors,
      priceHistory,
      stockItems,
      slaInfo: slaService.getSLAStatus(ret.sla_deadline)
    });
  } catch (err) { next(err); }
};

// ─── Submit Pricing to FAT ────────────────────────────────────────────────────
exports.submitPricing = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const { proposed_price, product_category, notes, item_id } = req.body;
    const itemIdInt = parseInt(item_id, 10);

    if (!proposed_price || isNaN(parseFloat(proposed_price))) {
      req.flash('error', 'Harga pengajuan tidak valid.');
      return res.redirect(itemIdInt ? `/recovery/item/${itemIdInt}` : `/recovery/${returnId}`);
    }

    const result = await returnService.submitPricing(returnId, { proposed_price, product_category, notes },
      req.session.userId, itemIdInt || null);

    // Complete any process SLA, then begin Pricing SLA tracking only if return status transitioned
    if (result && result.statusTransitioned) {
      await slaHelper.completeActiveStage(returnId);
      await slaHelper.applyPricingSLA(returnId);
    }

    await reportService.logActivity(req.session.userId, 'submit_pricing',
      `Pengajuan harga return #${returnId}: Rp ${proposed_price}`, req.ip, req.headers['user-agent']);

    req.flash('success', 'Harga berhasil diajukan ke FAT.');
    res.redirect(itemIdInt ? `/recovery/item/${itemIdInt}` : `/recovery/${returnId}`);
  } catch (err) { next(err); }
};

// ─── Bulk Submit Pricing to FAT (Updated) ──────────────────────────────────────
exports.bulkSubmitPricing = async (req, res, next) => {
  try {
    console.log('bulkSubmitPricing req.body:', req.body);
    let { item_ids, prices, notes, categories } = req.body;
    if (!item_ids) {
      req.flash('error', 'Tidak ada item yang dipilih.');
      return res.redirect('/recovery?type=write_off');
    }

    if (!Array.isArray(item_ids)) {
      item_ids = [item_ids];
    }

    const userId = req.session.userId;
    let submittedCount = 0;

    for (let index = 0; index < item_ids.length; index++) {
      const itemIdStr = item_ids[index];
      const itemId = parseInt(itemIdStr, 10);
      if (isNaN(itemId)) continue;

      let proposedPrice = null;
      if (prices) {
        if (Array.isArray(prices)) {
          proposedPrice = prices[index];
        } else if (typeof prices === 'object') {
          proposedPrice = prices[itemIdStr];
        }
      }
      if (!proposedPrice && req.body[`prices[${itemIdStr}]`]) {
        proposedPrice = req.body[`prices[${itemIdStr}]`];
      }

      let category = null;
      if (categories) {
        if (Array.isArray(categories)) {
          category = categories[index];
        } else if (typeof categories === 'object') {
          category = categories[itemIdStr];
        }
      }
      if (!category && req.body[`categories[${itemIdStr}]`]) {
        category = req.body[`categories[${itemIdStr}]`];
      }
      if (!category) category = 'write_off';

      let itemNotes = null;
      if (notes) {
        if (Array.isArray(notes)) {
          itemNotes = notes[index];
        } else if (typeof notes === 'object') {
          itemNotes = notes[itemIdStr];
        }
      }
      if (!itemNotes && req.body[`notes[${itemIdStr}]`]) {
        itemNotes = req.body[`notes[${itemIdStr}]`];
      }

      if (!proposedPrice || isNaN(parseFloat(proposedPrice))) {
        console.log(`Skipping item #${itemId} due to invalid proposed price:`, proposedPrice);
        continue;
      }

      // Fetch the return ID for this item
      const [itemRows] = await db.query(
        'SELECT return_id FROM return_items WHERE item_id = ?',
        [itemId]
      );
      if (!itemRows.length) continue;
      const { return_id } = itemRows[0];

      // Submit pricing using returnService.submitPricing
      const result = await returnService.submitPricing(
        return_id,
        { proposed_price: proposedPrice, product_category: category, notes: itemNotes },
        userId,
        itemId
      );

      // Transition SLA if return status transitioned
      if (result && result.statusTransitioned) {
        await slaHelper.completeActiveStage(return_id);
        await slaHelper.applyPricingSLA(return_id);
      }

      await reportService.logActivity(userId, 'submit_pricing_bulk',
        `Bulk pengajuan harga item #${itemId}: Rp ${proposedPrice}`, req.ip, req.headers['user-agent']);

      submittedCount++;
    }

    req.flash('success', `Berhasil mengajukan harga ke FAT untuk ${submittedCount} SKU.`);
    res.redirect('/recovery?type=write_off');
  } catch (err) {
    next(err);
  }
};

// ─── Bulk Write-Off (Batch Berita Acara & Direct Complete) ─────────────────────
exports.bulkWriteOff = async (req, res, next) => {
  try {
    console.log('bulkWriteOff req.body:', req.body);
    let { item_ids, title, content, vendor_id } = req.body;
    
    if (!item_ids) {
      req.flash('error', 'Tidak ada item yang dipilih.');
      return res.redirect('/recovery?type=write_off');
    }

    if (!Array.isArray(item_ids)) {
      item_ids = [item_ids];
    }

    const itemIds = item_ids
      .map(id => parseInt(id, 10))
      .filter(id => !Number.isNaN(id));

    if (itemIds.length === 0) {
      req.flash('error', 'Item yang dipilih tidak valid.');
      return res.redirect('/recovery?type=write_off');
    }

    const userId = req.session.userId;

    // 1. Fetch return_item details to group by return_id
    const placeholders = itemIds.map(() => '?').join(',');
    const [items] = await db.query(
      `SELECT item_id, return_id, item_code, item_name, quantity, disposition, physical_location 
       FROM return_items 
       WHERE item_id IN (${placeholders})`,
      itemIds
    );

    if (!items.length) {
      req.flash('error', 'Tidak ada SKU yang ditemukan.');
      return res.redirect('/recovery?type=write_off');
    }

    // Group items by return_id
    const itemsByReturn = {};
    for (const item of items) {
      if (!itemsByReturn[item.return_id]) {
        itemsByReturn[item.return_id] = [];
      }
      itemsByReturn[item.return_id].push(item);
    }

    // Fetch returns metadata to construct BA and check statuses
    const returnIds = Object.keys(itemsByReturn).map(id => parseInt(id, 10));
    const returnPlaceholders = returnIds.map(() => '?').join(',');
    const [returnRows] = await db.query(
      `SELECT return_id, return_number, current_status 
       FROM returns 
       WHERE return_id IN (${returnPlaceholders})`,
      returnIds
    );

    const returnMap = {};
    for (const r of returnRows) {
      returnMap[r.return_id] = r;
    }

    let processedCount = 0;

    // 2. Process each unique return
    for (const returnId of returnIds) {
      const parentReturn = returnMap[returnId];
      if (!parentReturn) continue;

      const returnItems = itemsByReturn[returnId];

      // Create Berita Acara for this return_id
      const baTitle = `${title || 'BA Write-Off'} - ${parentReturn.return_number}`;
      const baData = {
        ba_type: 'write_off',
        return_id: returnId,
        title: baTitle,
        content: content || 'Write-off per batch.',
        vendor_id: vendor_id ? parseInt(vendor_id, 10) : null,
        final_price: null
      };

      const { baNumber } = await baService.createBA(baData, userId);

      await reportService.logActivity(
        userId,
        'create_ba',
        `BA ${baNumber} dibuat otomatis via bulk write-off untuk Return #${returnId}`,
        req.ip,
        req.headers['user-agent']
      );

      // Process each item in the return
      for (const item of returnItems) {
        // Ensure inventory_stock record exists and is set correctly
        const [existingStocks] = await db.query(
          'SELECT stock_id FROM inventory_stock WHERE return_id = ? AND item_id = ?',
          [returnId, item.item_id]
        );

        const category = item.disposition || 'write_off';

        if (!existingStocks.length) {
          await inventoryService.addInventoryEntry({
            return_id: returnId,
            item_id: item.item_id,
            category: category,
            location: item.physical_location || null,
            status: 'tersedia',
            entry_date: dateHelper.getJakartaDateString()
          });
        } else {
          const stockId = existingStocks[0].stock_id;
          await db.query(
            `UPDATE inventory_stock 
             SET status = 'tersedia', 
                 category = ?, 
                 updated_at = NOW() 
             WHERE stock_id = ?`,
            [category, stockId]
          );
        }

        // Update return_items current_status to Completed and perbaikan_status to recovery
        await db.query(
          `UPDATE return_items 
           SET current_status = 'Completed', 
               perbaikan_status = 'recovery',
               updated_at = NOW() 
           WHERE item_id = ?`,
          [item.item_id]
        );

        await reportService.logActivity(
          userId,
          'complete_item_bulk',
          `Bulk write-off SKU ${item.item_code} (#${item.item_id}) -> Completed. Stok masuk kategori ${category.toUpperCase()} (tersedia). Terkait BA ${baNumber}`,
          req.ip,
          req.headers['user-agent']
        );

        processedCount++;
      }

      // Check if all items in the return are now Completed
      const [allItems] = await db.query(
        'SELECT item_id, current_status FROM return_items WHERE return_id = ?',
        [returnId]
      );

      const isAllCompleted = allItems.every(it => it.current_status === 'Completed');

      if (isAllCompleted) {
        const [[ret]] = await db.query('SELECT current_status FROM returns WHERE return_id = ?', [returnId]);
        if (ret && ret.current_status !== 'Completed') {
          await slaHelper.completeActiveStage(returnId, 'recovery');
          await returnService.updateStatus(
            returnId,
            ret.current_status,
            'Completed',
            `Semua item write-off selesai (Bulk BA: ${baNumber})`,
            '',
            userId
          );
          await db.query('UPDATE returns SET completed_date = NOW(), product_category = ? WHERE return_id = ?', ['write_off', returnId]);
          await reportService.logActivity(
            userId,
            'complete_return_perbaikan',
            `Return #${returnId} otomatis Completed setelah write-off selesai (Bulk)`,
            req.ip,
            req.headers['user-agent']
          );
        }
      }
    }

    req.flash('success', `Berhasil membuat Berita Acara dan menyelesaikan status ${processedCount} SKU.`);
    res.redirect('/recovery?type=write_off');
  } catch (err) {
    next(err);
  }
};

// ─── Update physical location for a stock item ───────────────────────────────
exports.updateLocation = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id, 10);
    const { stock_id, item_id, location } = req.body;

    let stockIdInt = parseInt(stock_id, 10);
    const itemIdInt = parseInt(item_id, 10);

    // If stock_id is missing/invalid but we have item_id, find or create the stock entry
    if ((isNaN(stockIdInt) || !stockIdInt) && itemIdInt && !isNaN(itemIdInt)) {
      const [[existingStock]] = await db.query(
        'SELECT stock_id FROM inventory_stock WHERE return_id = ? AND item_id = ?',
        [returnId, itemIdInt]
      );
      if (existingStock) {
        stockIdInt = existingStock.stock_id;
      } else {
        const ret = await returnService.getReturnById(returnId);
        const category = (ret && ret.product_category) || 'rekondisi';

        // Auto-heal returns.product_category if it is NULL
        if (ret && !ret.product_category) {
          await db.query('UPDATE returns SET product_category = ? WHERE return_id = ?', [category, returnId]);
        }

        stockIdInt = await inventoryService.addInventoryEntry({
          return_id: returnId,
          item_id: itemIdInt,
          category: category,
          location: location || null,
          status: 'tersedia',
          entry_date: dateHelper.getJakartaDateString()
        });
      }
    }

    if (!stockIdInt || isNaN(stockIdInt)) {
      req.flash('error', 'Stock ID tidak valid.');
      return res.redirect(itemIdInt ? `/recovery/item/${itemIdInt}` : `/recovery/${returnId}`);
    }

    await inventoryService.updateLocation(stockIdInt, location);
    // Also update return_items.physical_location
    const [[stock]] = await db.query('SELECT item_id FROM inventory_stock WHERE stock_id = ?', [stockIdInt]);
    if (stock) {
      await db.query('UPDATE return_items SET physical_location = ? WHERE item_id = ?',
        [location, stock.item_id]);
    }
    req.flash('success', 'Lokasi barang diperbarui.');
    res.redirect(itemIdInt ? `/recovery/item/${itemIdInt}` : `/recovery/${returnId}`);
  } catch (err) { next(err); }
};

// ─── Record Recovery Sale ─────────────────────────────────────────────────────
exports.recordSale = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const { vendor_id, recovery_sale_price, sale_date, item_id, closing_notes } = req.body;
    const itemIdInt = parseInt(item_id, 10);
    const userId = req.session.userId;

    const ret = await returnService.getReturnById(returnId);
    if (!ret) {
      req.flash('error', 'Return not found.');
      return res.redirect('/recovery');
    }

    if (!isNaN(itemIdInt) && itemIdInt) {
      // 1. Find the stock item
      const [[stock]] = await db.query(
        'SELECT stock_id FROM inventory_stock WHERE return_id = ? AND item_id = ?',
        [returnId, itemIdInt]
      );
      if (stock) {
        // Record sale for only this stock item
        await inventoryService.recordStockSale(stock.stock_id, recovery_sale_price, sale_date, vendor_id);
      }

      // Update return item category/pricing status if needed
      await db.query(
        `UPDATE return_items SET inspection_notes = ?, current_status = 'Completed', recovery_sold_at = NOW() WHERE item_id = ?`,
        [closing_notes || null, itemIdInt]
      );

      // Check if all items in this return are sold
      const [allStocks] = await db.query(
        'SELECT status FROM inventory_stock WHERE return_id = ?',
        [returnId]
      );
      const isAllSold = allStocks.every(s => s.status === 'terjual' || s.status === 'dihapus');

      if (isAllSold) {
        await slaHelper.completeActiveStage(returnId, 'recovery');
        await returnService.updateStatus(returnId, ret.current_status, 'Completed',
          'Semua item terjual/recovery selesai', closing_notes || '', userId);
      }

      await reportService.logActivity(userId, 'record_sale_item',
        `Penjualan item #${itemIdInt} pada return #${returnId}`, req.ip, req.headers['user-agent']);

      req.flash('success', 'Penjualan item dicatat.');

      const nextDest = isAllSold ? `/returns/${returnId}` : `/recovery?type=${ret.product_category === 'write_off' ? 'write_off' : 'refurbish'}`;
      res.redirect(nextDest);
    } else {
      // Original fallback: mark all items as sold
      await slaHelper.completeActiveStage(returnId, 'recovery');
      await returnService.recordRecoverySale(returnId, req.body, userId);

      const [stocks] = await db.query('SELECT stock_id FROM inventory_stock WHERE return_id = ?', [returnId]);
      for (const s of stocks) {
        await inventoryService.recordStockSale(s.stock_id, recovery_sale_price, sale_date, vendor_id);
      }

      await reportService.logActivity(userId, 'record_sale',
        `Penjualan recovery return #${returnId}`, req.ip, req.headers['user-agent']);

      req.flash('success', 'Penjualan dicatat. Return ditutup sebagai Completed.');
      res.redirect(`/returns/${returnId}`);
    }
  } catch (err) { next(err); }
};

// ─── Bulk Complete Refurbish Items ───────────────────────────────────────────
exports.bulkComplete = async (req, res, next) => {
  try {
    console.log('bulkComplete req.body:', req.body);
    let { item_ids, title, content, vendor_id } = req.body;
    
    if (!item_ids) {
      req.flash('error', 'Tidak ada item yang dipilih.');
      return res.redirect('/recovery?type=refurbish');
    }

    if (!Array.isArray(item_ids)) {
      item_ids = [item_ids];
    }

    const itemIds = item_ids
      .map(id => parseInt(id, 10))
      .filter(id => !Number.isNaN(id));

    if (itemIds.length === 0) {
      req.flash('error', 'Item yang dipilih tidak valid.');
      return res.redirect('/recovery?type=refurbish');
    }

    const userId = req.session.userId;

    // 1. Fetch return_item details to group by return_id
    const placeholders = itemIds.map(() => '?').join(',');
    const [items] = await db.query(
      `SELECT item_id, return_id, item_code, item_name, quantity, disposition, physical_location 
       FROM return_items 
       WHERE item_id IN (${placeholders})`,
      itemIds
    );

    if (!items.length) {
      req.flash('error', 'Tidak ada SKU yang ditemukan.');
      return res.redirect('/recovery?type=refurbish');
    }

    // Group items by return_id
    const itemsByReturn = {};
    for (const item of items) {
      if (!itemsByReturn[item.return_id]) {
        itemsByReturn[item.return_id] = [];
      }
      itemsByReturn[item.return_id].push(item);
    }

    // Fetch returns metadata to construct BA and check statuses
    const returnIds = Object.keys(itemsByReturn).map(id => parseInt(id, 10));
    const returnPlaceholders = returnIds.map(() => '?').join(',');
    const [returnRows] = await db.query(
      `SELECT return_id, return_number, current_status 
       FROM returns 
       WHERE return_id IN (${returnPlaceholders})`,
      returnIds
    );

    const returnMap = {};
    for (const r of returnRows) {
      returnMap[r.return_id] = r;
    }

    let processedCount = 0;

    // 2. Process each unique return
    for (const returnId of returnIds) {
      const parentReturn = returnMap[returnId];
      if (!parentReturn) continue;

      const returnItems = itemsByReturn[returnId];

      // Find disposition of the first item to determine the BA type (default: refurbish)
      const firstItem = returnItems[0];
      const baType = ['rekondisi', 'refurbish'].includes(firstItem.disposition) ? firstItem.disposition : 'refurbish';

      // Create Berita Acara for this return_id
      const baTitle = `${title || 'BA Refurbish'} - ${parentReturn.return_number}`;
      const baData = {
        ba_type: baType,
        return_id: returnId,
        title: baTitle,
        content: content || 'Penyelesaian perbaikan per batch.',
        vendor_id: vendor_id ? parseInt(vendor_id, 10) : null,
        final_price: null
      };

      const { baNumber } = await baService.createBA(baData, userId);

      await reportService.logActivity(
        userId,
        'create_ba',
        `BA ${baNumber} dibuat otomatis via bulk complete untuk Return #${returnId}`,
        req.ip,
        req.headers['user-agent']
      );

      // Process each item in the return
      for (const item of returnItems) {
        // Ensure inventory_stock record exists and is set correctly
        const [existingStocks] = await db.query(
          'SELECT stock_id FROM inventory_stock WHERE return_id = ? AND item_id = ?',
          [returnId, item.item_id]
        );

        const category = item.disposition || 'refurbish';

        if (!existingStocks.length) {
          await inventoryService.addInventoryEntry({
            return_id: returnId,
            item_id: item.item_id,
            category: category,
            location: item.physical_location || null,
            status: 'tersedia',
            entry_date: dateHelper.getJakartaDateString()
          });
        } else {
          const stockId = existingStocks[0].stock_id;
          await db.query(
            `UPDATE inventory_stock 
             SET status = 'tersedia', 
                 category = ?, 
                 updated_at = NOW() 
             WHERE stock_id = ?`,
            [category, stockId]
          );
        }

        // Update return_items current_status to Completed and perbaikan_status to recovery
        await db.query(
          `UPDATE return_items 
           SET current_status = 'Completed', 
               perbaikan_status = 'recovery',
               updated_at = NOW() 
           WHERE item_id = ?`,
          [item.item_id]
        );

        await reportService.logActivity(
          userId,
          'complete_item_bulk',
          `Bulk complete SKU ${item.item_code} (#${item.item_id}) -> Completed. Stok masuk kategori ${category.toUpperCase()} (tersedia). Terkait BA ${baNumber}`,
          req.ip,
          req.headers['user-agent']
        );

        processedCount++;
      }

      // Check if all items in the return are now Completed
      const [allItems] = await db.query(
        'SELECT item_id, current_status FROM return_items WHERE return_id = ?',
        [returnId]
      );

      const isAllCompleted = allItems.every(it => it.current_status === 'Completed');

      if (isAllCompleted) {
        const [[ret]] = await db.query('SELECT current_status FROM returns WHERE return_id = ?', [returnId]);
        if (ret && ret.current_status !== 'Completed') {
          await slaHelper.completeActiveStage(returnId, 'recovery');
          await returnService.updateStatus(
            returnId,
            ret.current_status,
            'Completed',
            `Semua item perbaikan selesai (Bulk BA: ${baNumber})`,
            '',
            userId
          );
          await db.query('UPDATE returns SET completed_date = NOW() WHERE return_id = ?', [returnId]);
          await reportService.logActivity(
            userId,
            'complete_return_perbaikan',
            `Return #${returnId} otomatis Completed setelah perbaikan selesai (Bulk)`,
            req.ip,
            req.headers['user-agent']
          );
        }
      }
    }

    req.flash('success', `Berhasil membuat Berita Acara dan menyelesaikan status ${processedCount} SKU.`);
    res.redirect('/recovery?type=refurbish');
  } catch (err) {
    next(err);
  }
};

// ─── FAT: Pending price approvals ────────────────────────────────────────────
exports.pendingApprovals = async (req, res, next) => {
  try {
    const submissions = await returnService.getPendingPricingSubmissions({ status: 'pending' });
    const allSubmissions = await returnService.getPendingPricingSubmissions({});
    res.render('fat/approvals', { title: 'Persetujuan Harga – FAT', submissions, allSubmissions });
  } catch (err) { next(err); }
};

// ─── FAT: Approve / Reject a price submission ────────────────────────────────
exports.reviewPricing = async (req, res, next) => {
  try {
    const { submission_id, action, final_price, review_notes } = req.body;
    const status = action === 'approve' ? 'approved' : 'rejected';

    if (status === 'approved' && (!final_price || isNaN(parseFloat(final_price)))) {
      req.flash('error', 'Masukkan harga final yang valid.');
      return res.redirect('/recovery/fat-approvals');
    }

    const [[submission]] = await db.query(
      'SELECT return_id FROM price_submissions WHERE submission_id = ?',
      [parseInt(submission_id)]
    );
    const returnId = submission ? submission.return_id : null;

    const result = await returnService.reviewPricing(
      parseInt(submission_id), status, parseFloat(final_price) || null,
      review_notes, req.session.userId
    );

    if (status === 'approved' && returnId && result && result.statusTransitioned) {
      await slaHelper.completeActiveStage(returnId, 'pricing');
      const ret = await returnService.getReturnById(returnId);
      const recoveryType = ret && ret.product_category === 'write_off'
        ? 'Write off'
        : ret && ret.product_category === 'refurbish'
          ? 'Refurbish'
          : '[No Code]';
      await slaHelper.applyRecoverySLA(returnId, recoveryType);
    }

    await reportService.logActivity(req.session.userId, 'review_pricing',
      `${status} submission #${submission_id}`, req.ip, req.headers['user-agent']);

    req.flash('success', `Pengajuan harga ${status === 'approved' ? 'disetujui' : 'ditolak'}.`);
    res.redirect('/recovery/fat-approvals');
  } catch (err) { next(err); }
};
