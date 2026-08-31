'use strict';
const returnService = require('../services/returnService');
const slaService = require('../services/slaService');
const slaHelper = require('../services/slaHelper');
const inventoryService = require('../services/inventoryService');
const reportService = require('../services/reportService');
const userService = require('../services/userService');
const db = require('../config/database');
const dateHelper = require('../utils/dateHelper');

// ─── Queue: returns awaiting / in sorting ────────────────────────────────────
exports.queue = async (req, res, next) => {
  try {
    // 1. Fetch current Sorting queue items
    const [items] = await db.query(`
      SELECT ri.item_id,
             ri.item_code AS sku,
             ri.item_name,
             ri.quantity,
             ri.disposition,
             ri.return_category,
             ri.item_category,
             ri.ikut,
             ri.ikut_wo,
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
      WHERE r.current_status IN ('Inbound','Sorting','Rekondisi','Refurbish','Write_Off','Pricing','Recovery') AND ri.disposition = 'pending'
      ORDER BY r.sla_deadline ASC, r.return_date ASC
    `);

    // 2. Annotate SLA status on each row for Sorting items
    const slaAlerts = await slaService.getSLAAlerts();
    const alertIds = new Set(slaAlerts.map(a => a.return_id));
    items.forEach(item => {
      item.slaInfo = slaService.getSLAStatus(item.sla_deadline);
      item.slaAlert = alertIds.has(item.return_id);
    });

    // Fetch active vendors/suppliers
    const [vendors] = await db.query(
      'SELECT vendor_id, vendor_name FROM vendors WHERE is_active = 1 ORDER BY vendor_name'
    );

    res.render('sorting/queue', { title: 'Sorting Queue', items, slaAlerts, vendors });
  } catch (err) { next(err); }
};

// ─── Process: view + QC items for a single return ────────────────────────────
exports.process = async (req, res, next) => {
  try {
    const ret = await returnService.getReturnById(parseInt(req.params.id));
    if (!ret) { req.flash('error', 'Return not found.'); return res.redirect('/sorting'); }

    const [vendors] = await db.query('SELECT vendor_id, vendor_name FROM vendors WHERE is_active=1 ORDER BY vendor_name');
    const sorters = await userService.getUsersByRole('admin_sorting');

    res.render('sorting/process', {
      title: `Sorting – ${ret.return_number}`,
      ret,
      vendors,
      sorters,
      slaInfo: slaService.getSLAStatus(ret.sla_deadline)
    });
  } catch (err) { next(err); }
};

// ─── Confirm Inbound (Admin Retur step: attach resi, set inbound date) ────────
exports.confirmInbound = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const ret = await returnService.getReturnById(returnId);
    if (!ret) { req.flash('error', 'Return not found.'); return res.redirect('/sorting'); }

    await returnService.confirmInbound(returnId, req.body, req.session.userId);

    // Transition to Sorting + start tracking SLA
    await returnService.updateStatus(returnId, ret.current_status, 'Sorting',
      'Inbound dikonfirmasi – masuk antrian Sorting', '', req.session.userId);
    await slaHelper.applySortingSLA(returnId);

    await reportService.logActivity(req.session.userId, 'confirm_inbound',
      `Konfirmasi inbound return #${returnId}`, req.ip, req.headers['user-agent']);

    req.flash('success', 'Inbound dikonfirmasi. Return masuk antrian Sorting.');
    res.redirect(`/sorting/${returnId}`);
  } catch (err) { next(err); }
};

// ─── Save QC for one item ─────────────────────────────────────────────────────
exports.saveItemQC = async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.itemId);
    await returnService.updateItemQC(itemId, { ...req.body, userId: req.session.userId });

    await reportService.logActivity(req.session.userId, 'item_qc',
      `QC item #${itemId}`, req.ip, req.headers['user-agent']);

    req.flash('success', 'Data QC item disimpan.');
    res.redirect(`/sorting/${req.params.id}`);
  } catch (err) { next(err); }
};

// ─── Finalize categorization for a whole return ───────────────────────────────
exports.categorize = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const { category } = req.body;

    if (!['rekondisi', 'refurbish', 'write_off', 'return_to_supplier'].includes(category)) {
      req.flash('error', 'Kategori tidak valid.');
      return res.redirect(`/sorting/${returnId}`);
    }

    const ret = await returnService.getReturnById(returnId);
    await returnService.categorizeReturn(returnId, category, req.session.userId);

    // Reset SLA for the new stage
    // Complete any active sorting SLA before moving into process stage
    await slaHelper.completeActiveStage(returnId, 'sorting');

    if (['rekondisi', 'refurbish', 'write_off'].includes(category)) {
      const processTypeMap = {
        rekondisi: 'Rekondisi',
        refurbish: 'Refurbish',
        write_off: 'Write off'
      };
      const processType = processTypeMap[category] || 'Rekondisi';
      const itemCategories = ret.items.map(item => item.item_category).filter(Boolean);
      const slaCategory = itemCategories.includes('Elektronik') ? 'Elektronik' : 'Non Elektronik';
      await slaHelper.applyProcessSLA(returnId, slaCategory, processType);
    }

    // Register items in inventory_stock
    for (const item of ret.items) {
      const itemCategory = (item.disposition && item.disposition !== 'pending') ? item.disposition : category;
      if (['rekondisi', 'refurbish', 'write_off', 'stok_utama', 'return_to_supplier'].includes(itemCategory)) {
        await inventoryService.addInventoryEntry({
          return_id: returnId,
          item_id: item.item_id,
          category: itemCategory,
          location: item.physical_location || null,
          status: 'tersedia',
          entry_date: dateHelper.getJakartaDateString(),
          vendor_id: item.vendor_id || null
        });
      }
    }

    await reportService.logActivity(req.session.userId, 'categorize_return',
      `Kategorisasi return #${returnId} → ${category}`, req.ip, req.headers['user-agent']);

    req.flash('success', `Return dikategorisasi sebagai ${category.replace('_', '-').toUpperCase()}.`);
    res.redirect(`/returns/${returnId}`);
  } catch (err) { next(err); }
};

exports.bulkProcess = async (req, res, next) => {
  try {
    let { item_ids, disposition, physical_location, vendor_id } = req.body;
    if (!item_ids || !disposition) {
      req.flash('error', 'Silakan pilih SKU dan tentukan Status QC.');
      return res.redirect('/sorting');
    }

    if (!Array.isArray(item_ids)) {
      item_ids = [item_ids];
    }

    const userId = req.session.userId;
    const vendorIdParsed = vendor_id ? parseInt(vendor_id) : null;

    for (const itemIdStr of item_ids) {
      const itemId = parseInt(itemIdStr);
      if (isNaN(itemId)) continue;

      const itemCategory = req.body['category_' + itemId] || null;
      const itemIkut = req.body['ikut_' + itemId] || null;
      const itemIkutWo = req.body['ikut_wo_' + itemId] || null;

      // 1. Update item QC
      await returnService.updateItemQC(itemId, {
        disposition,
        physical_location,
        item_category: itemCategory,
        ikut: itemIkut,
        ikut_wo: (itemIkut === 'Plastik') ? itemIkutWo : null,
        vendor_id: vendorIdParsed,
        userId: userId
      });

      // Fetch the return ID for this item
      const [itemRows] = await db.query(
        'SELECT return_id, item_code, quantity FROM return_items WHERE item_id = ?',
        [itemId]
      );
      if (!itemRows.length) continue;
      const { return_id, item_code } = itemRows[0];



      // 2. Add to inventory stock immediately
      if (['rekondisi', 'refurbish', 'write_off', 'stok_utama', 'return_to_supplier'].includes(disposition)) {
        await inventoryService.addInventoryEntry({
          return_id,
          item_id: itemId,
          category: disposition,
          location: physical_location || null,
          status: 'tersedia',
          entry_date: dateHelper.getJakartaDateString(),
          vendor_id: vendorIdParsed
        });
      }

      // 3. Check if all items in this return are sorted
      const [allItems] = await db.query(
        'SELECT item_id, disposition FROM return_items WHERE return_id = ?',
        [return_id]
      );
      const isAllSorted = allItems.every(it => it.disposition && it.disposition !== 'pending');

      if (isAllSorted) {
        // Automatically finalize categorization of the return
        await returnService.categorizeReturn(return_id, disposition, userId);
        await slaHelper.completeActiveStage(return_id, 'sorting');

        if (['rekondisi', 'refurbish', 'write_off'].includes(disposition)) {
          const processTypeMap = {
            rekondisi: 'Rekondisi',
            refurbish: 'Refurbish',
            write_off: 'Write off'
          };
          const processType = processTypeMap[disposition] || 'Rekondisi';
          const slaCategory = (disposition === 'write_off') ? 'Non Elektronik' : (itemCategory || 'Non Elektronik');
          await slaHelper.applyProcessSLA(return_id, slaCategory, processType);
        }
      }

      await reportService.logActivity(userId, 'item_qc_bulk',
        `Bulk QC item #${itemId} (${item_code}) → ${disposition} (${itemCategory || 'N/A'})`, req.ip, req.headers['user-agent']);
    }

    req.flash('success', `Berhasil memproses ${item_ids.length} SKU.`);
    res.redirect('/sorting');
  } catch (err) {
    next(err);
  }
};


