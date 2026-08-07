'use strict';
const fs             = require('fs');
const path           = require('path');
const XLSX           = require('xlsx');
const returnService  = require('../services/returnService');
const approvalService = require('../services/approvalService');
const userService    = require('../services/userService');
const reportService  = require('../services/reportService');
const db             = require('../config/database');
const slaService     = require('../services/slaService');
const slaHelper      = require('../services/slaHelper');
const dateHelper     = require('../utils/dateHelper');

// ─── Upload helpers ───────────────────────────────────────────────────────────
// Collect all uploaded photos per item key as an array
function buildFileMap(files) {
  const map = {};
  (files || []).forEach(file => {
    const m = file.fieldname.match(/^items\[(\d+)\]\[photos\]\[\]$/);
    if (m) {
      if (!map[m[1]]) map[m[1]] = [];
      map[m[1]].push('/uploads/returns/' + file.filename);
    }
  });
  return map;
}

function deleteUploadedFile(urlPath) {
  if (!urlPath) return;
  fs.unlink(path.join(__dirname, '..', urlPath.replace(/^\//, '')), () => {});
}

// ─── List ─────────────────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const returns = await returnService.getReturns(req.query);
    res.render('returns/list', { title: 'All Returns', returns, filters: req.query });
  } catch (err) { next(err); }
};

// ─── Pending ──────────────────────────────────────────────────────────────────
exports.pending = async (req, res, next) => {
  try {
    const returns = await returnService.getPendingReturns();
    res.render('returns/pending', { title: 'Pending Returns', returns });
  } catch (err) { next(err); }
};

// ─── Inspection Queue ─────────────────────────────────────────────────────────
exports.inspection = async (req, res, next) => {
  try {
    const { returns, items } = await returnService.getInspectionQueue();
    const myCount = returns.filter(r => r.inspector_user_id === req.session.userId).length;
    res.render('returns/inspection', {
      title: 'Inspection Queue', returns, items, myCount
    });
  } catch (err) { next(err); }
};

// ─── View ─────────────────────────────────────────────────────────────────────
exports.view = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const [items] = await db.query('SELECT item_id FROM return_items WHERE return_id = ? ORDER BY item_id LIMIT 1', [returnId]);
    if (items && items.length > 0) {
      return res.redirect(`/returns/item/${items[0].item_id}`);
    }

    const ret = await returnService.getReturnById(returnId);
    if (!ret) { req.flash('error', 'Return not found.'); return res.redirect('/returns'); }

    const agingDays = Math.floor((Date.now() - new Date(ret.return_date)) / 86400000);
    res.render('returns/view', { title: `Return ${ret.return_number}`, ret, agingDays });
  } catch (err) { next(err); }
};

// ─── View Item ─────────────────────────────────────────────────────────────────
exports.viewItem = async (req, res, next) => {
  try {
    const ret = await returnService.getReturnItemDetail(parseInt(req.params.id));
    if (!ret) { req.flash('error', 'Return Item not found.'); return res.redirect('/returns'); }

    // Override product category with item disposition
    ret.product_category = ret.disposition;

    // Calculate item-specific SLA if applicable
    if (['write_off', 'refurbish', 'rekondisi'].includes(ret.disposition)) {
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
        [parseInt(req.params.id)]
      );

      const startDate = (approvedSub && approvedSub.review_date) || ret.inspected_at || ret.inbound_date || ret.return_date;
      const hours = (ret.disposition === 'write_off') ? writeOffHours : refurbishHours;
      ret.sla_deadline = new Date(new Date(startDate).getTime() + hours * 60 * 60 * 1000);
    }

    // Map single item to ret.items so existing views/returns/view.ejs works seamlessly
    ret.items = [ { ...ret } ];

    const agingDays = Math.floor((Date.now() - new Date(ret.return_date)) / 86400000);
    res.render('returns/view', { 
      title: `Return Item - ${ret.item_code || ret.item_name}`, 
      ret, 
      agingDays, 
      isItemDetail: true 
    });
  } catch (err) { next(err); }
};

// ─── Create GET ───────────────────────────────────────────────────────────────
exports.createForm = async (req, res, next) => {
  try {
    const inspectors = await userService.getUsersByRole('inspector');
    const managers   = await userService.getUsersByRole('manager');
    const [couriers] = await db.query("SELECT * FROM master_expedisi WHERE status = 'active' ORDER BY nama_expedisi ASC");
    res.render('returns/create', { title: 'New Return', inspectors, managers, couriers, formData: {} });
  } catch (err) { next(err); }
};

// ─── Create POST ──────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { items, ...data } = req.body;

    if (!items || !Object.keys(items).length) {
      req.flash('error', 'Please add at least one item.');
      return res.redirect('/returns/create');
    }

    const fileMap = buildFileMap(req.files);
    const itemArray = Object.entries(items)
      .filter(([, i]) => i.item_name)
      .map(([key, i]) => {
        const newFiles = fileMap[key] || [];
        return { ...i, image_path: newFiles.length ? JSON.stringify(newFiles) : null };
      });

    // Auto-populate overall return category from first item
    data.return_category = itemArray[0] ? itemArray[0].return_category : null;

    // Evaluate decision tree
    let totalValue = 0;
    itemArray.forEach(i => { totalValue += (parseFloat(i.quantity) || 1) * (parseFloat(i.unit_price) || 0); });

    const returnPayload = {
      total_value    : totalValue,
      return_category: data.return_category,
      source_type    : data.source_type
    };

    const actions = await approvalService.processDecisionTree(returnPayload);

    let picUserId       = req.session.userId;
    let inspectorUserId = null;
    let currentStatus   = 'Inbound';
    let completedDate   = null;

    for (const action of actions) {
      if (action.type === 'assign_inspector') {
        const sorters = await userService.getUsersByRole('admin_sorting');
        if (sorters.length) {
          inspectorUserId = sorters[0].user_id;
        }
      }
      if (action.type === 'assign_pic') {
        const pics = await userService.getUsersByRole(action.value);
        if (pics.length) picUserId = pics[0].user_id;
      }
    }

    // Handle "other" courier input
    if (data.resi_courier === 'other' && data.other_courier) {
      data.resi_courier = data.other_courier;
    }

    const inboundDate = dateHelper.getJakartaDateTimeString();
    // Ensure sorting inspector is assigned
    if (!inspectorUserId) {
      const sorters = await userService.getUsersByRole('admin_sorting');
      if (sorters.length) {
        inspectorUserId = sorters[0].user_id;
      }
    }

    const { returnId, returnNumber } = await returnService.createReturn(
      {
        ...data,
        current_status: currentStatus,
        pic_user_id: picUserId,
        inspector_user_id: inspectorUserId,
        inbound_date: inboundDate,
        completed_date: completedDate,
        sla_days: null,
        sla_deadline: null
      },
      itemArray,
      req.session.userId
    );

    if (currentStatus === 'Inbound') {
      await slaHelper.applySortingSLA(returnId);
    }

    if (data.resi_number && data.no_pesanan) {
      await returnService.markManifestProcessed(data.resi_number, data.no_pesanan);
    }

    await reportService.logActivity(
      req.session.userId, 'create_return', `Created return ${returnNumber}`,
      req.ip, req.headers['user-agent']
    );

    req.flash('success', `Return ${returnNumber} created successfully!`);
    res.redirect('/returns/pending');
  } catch (err) { next(err); }
};

// ─── Edit GET ──────────────────────────────────────────────────────────────────
exports.editForm = async (req, res, next) => {
  try {
    const ret = await returnService.getReturnById(parseInt(req.params.id));
    if (!ret) { req.flash('error', 'Return not found.'); return res.redirect('/returns'); }

    const itemId = req.query.itemId || '';
    if (itemId) {
      const parsedItemId = parseInt(itemId);
      const singleItem = ret.items.find(i => i.item_id === parsedItemId);
      if (!singleItem) {
        req.flash('error', 'Item not found in this return.');
        return res.redirect('/returns');
      }
      if (singleItem.current_status === 'Completed' || singleItem.disposition === 'restock') {
        req.flash('error', 'Cannot edit completed items.');
        return res.redirect(`/returns/item/${itemId}`);
      }
      ret.items = [singleItem];
    } else {
      if (ret.current_status === 'Completed') {
        req.flash('error', 'Cannot edit completed returns.');
        return res.redirect(`/returns/${req.params.id}`);
      }
    }

    const inspectors = await userService.getUsersByRole('inspector');
    const managers   = await userService.getUsersByRole('manager');
    const [couriers] = await db.query("SELECT * FROM master_expedisi WHERE status = 'active' ORDER BY nama_expedisi ASC");
    res.render('returns/edit', {
      title: `Edit ${ret.return_number}`, ret, inspectors, managers, couriers, itemId
    });
  } catch (err) { next(err); }
};

// ─── Edit POST ─────────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const itemId = req.query.itemId;
    const { items, ...data } = req.body;

    if (!items || !Object.keys(items).length) {
      req.flash('error', 'Please add at least one item.');
      return res.redirect(`/returns/${returnId}/edit${itemId ? '?itemId=' + itemId : ''}`);
    }

    const fileMap  = buildFileMap(req.files);
    const itemArray = Object.entries(items)
      .filter(([, i]) => i.item_name)
      .map(([key, i]) => {
        const newFiles = fileMap[key] || [];
        let existing = [];
        if (i.clear_photo !== '1') {
          try { existing = JSON.parse(i.existing_image_path || '[]'); }
          catch { existing = i.existing_image_path ? [i.existing_image_path] : []; }
        }
        const all = [...existing, ...newFiles];
        return { ...i, image_path: all.length ? JSON.stringify(all) : null };
      });

    const ret = await returnService.getReturnById(returnId);
    if (!ret) {
      req.flash('error', 'Return not found.');
      return res.redirect('/returns');
    }

    // Handle "other" courier input
    if (data.resi_courier === 'other' && data.other_courier) {
      data.resi_courier = data.other_courier;
    }

    if (itemId) {
      const parsedItemId = parseInt(itemId);
      const dbItem = ret.items.find(i => i.item_id === parsedItemId);
      if (!dbItem) {
        req.flash('error', 'Item not found in this return.');
        return res.redirect(`/returns/${returnId}/edit?itemId=${itemId}`);
      }
      if (dbItem.current_status === 'Completed' || dbItem.disposition === 'restock') {
        req.flash('error', 'Cannot edit completed items.');
        return res.redirect(`/returns/item/${itemId}`);
      }

      const editedItem = itemArray[0];
      const mergedItem = { ...dbItem, ...editedItem };
      const additionalItems = itemArray.slice(1).filter(item => item.item_name);

      // Build hypothetical list of all items to determine return-level status/category
      const hypotheticalItems = ret.items.map(item => {
        if (item.item_id === parsedItemId) return mergedItem;
        return item;
      });
      hypotheticalItems.push(...additionalItems);

      data.current_status = ret.current_status;
      data.completed_date = ret.completed_date;

      await returnService.updateReturnItem(returnId, parsedItemId, data, mergedItem, req.session.userId);
      if (additionalItems.length) {
        await returnService.addReturnItems(returnId, data, additionalItems);
      }

      // Delete files no longer referenced by this item
      let originalPaths = [];
      try { originalPaths = JSON.parse(dbItem.image_path || '[]'); }
      catch { originalPaths = dbItem.image_path ? [dbItem.image_path] : []; }

      let keptPaths = [];
      try { keptPaths = JSON.parse(mergedItem.image_path || '[]'); }
      catch { keptPaths = mergedItem.image_path ? [mergedItem.image_path] : []; }

      const keptSet = new Set(keptPaths);
      originalPaths.forEach(p => { if (!keptSet.has(p)) deleteUploadedFile(p); });

    } else {
      if (ret.current_status === 'Completed') {
        req.flash('error', 'Cannot edit completed returns.');
        return res.redirect(`/returns/${returnId}`);
      }
      // Original logic for updating all items of the return
      const oldPaths = await returnService.getItemImagePaths(returnId);
      
      // Auto-populate overall return category from first item
      data.return_category = itemArray[0] ? itemArray[0].return_category : null;

      data.current_status = ret.current_status;
      data.completed_date = ret.completed_date;

      await returnService.updateReturn(returnId, data, itemArray, req.session.userId);

      // Delete files no longer referenced by any item
      const keptSet = new Set(
        itemArray.flatMap(i => { try { return JSON.parse(i.image_path || '[]'); } catch { return []; } })
      );
      oldPaths.forEach(p => { if (!keptSet.has(p)) deleteUploadedFile(p); });
    }

    if (data.current_status === 'Inbound') {
      await slaHelper.applySortingSLA(returnId);
    }

    await reportService.logActivity(
      req.session.userId, 'update_return', `Updated return #${returnId}`,
      req.ip, req.headers['user-agent']
    );

    req.flash('success', 'Return updated successfully.');
    
    if (ret.current_status === 'Inbound') {
      res.redirect('/returns/pending');
    } else {
      res.redirect(itemId ? `/returns/item/${itemId}` : `/returns/${returnId}`);
    }
  } catch (err) { next(err); }
};

// ─── Delete Inbound Item POST ─────────────────────────────────────────────────
exports.deleteInboundItem = async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.id);
    if (!itemId) {
      req.flash('error', 'Invalid item id.');
      return res.redirect('/returns/pending');
    }

    const result = await returnService.deleteInboundItem(itemId);

    (result.deletedImagePaths || []).forEach(p => deleteUploadedFile(p));

    await reportService.logActivity(
      req.session.userId,
      'delete_inbound_item',
      `Deleted inbound item ${itemId} from return ${result.returnId}`,
      req.ip,
      req.headers['user-agent']
    );

    if (result.returnDeleted) {
      req.flash('success', 'Item deleted. Parent return was removed because it had no remaining items.');
    } else {
      req.flash('success', 'Inbound item deleted successfully.');
    }
    res.redirect('/returns/pending');
  } catch (err) {
    if (err && err.message) {
      req.flash('error', err.message);
      return res.redirect('/returns/pending');
    }
    next(err);
  }
};

// ─── Update Status POST ──────────────────────────────────────────────────────
exports.updateStatus = async (req, res, next) => {
  try {
    const returnId  = parseInt(req.params.id);
    const itemId = req.query.itemId;
    const { new_status, reason, comments } = req.body;

    const ret = await returnService.getReturnById(returnId);
    if (!ret) { req.flash('error', 'Return not found.'); return res.redirect('/returns'); }

    await returnService.updateStatus(
      returnId, ret.current_status, new_status, reason, comments, req.session.userId
    );

    if (['Inbound', 'Sorting'].includes(new_status)) {
      await slaHelper.applySortingSLA(returnId);
    }

    req.flash('success', 'Status updated successfully.');
    res.redirect(itemId ? `/returns/item/${itemId}` : `/returns/${returnId}`);
  } catch (err) { next(err); }
};

// ─── Add Comment POST ─────────────────────────────────────────────────────────
exports.addComment = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const itemId = req.query.itemId;
    const { comment_text, is_internal } = req.body;

    await returnService.addComment(returnId, req.session.userId, comment_text, !!is_internal);
    req.flash('success', 'Comment added.');
    res.redirect(itemId ? `/returns/item/${itemId}` : `/returns/${returnId}`);
  } catch (err) { next(err); }
};

// ─── Update Item Inspection POST ─────────────────────────────────────────────
exports.updateItemInspection = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const itemId = req.query.itemId;
    const { item_id, inspection_result, inspection_notes, disposition } = req.body;

    await returnService.updateItemInspection(parseInt(item_id), {
      inspectionResult: inspection_result,
      inspectionNotes : inspection_notes,
      disposition
    });

    req.flash('success', 'Item inspection result saved.');
    res.redirect(itemId ? `/returns/item/${itemId}` : `/returns/${returnId}`);
  } catch (err) { next(err); }
};

// ─── Manifest Uploader Form GET ──────────────────────────────────────────────
exports.uploadForm = async (req, res, next) => {
  try {
    res.render('returns/upload', { title: 'Upload Manifest' });
  } catch (err) { next(err); }
};

// ─── Handle Manifest Upload POST ─────────────────────────────────────────────
exports.handleUpload = async (req, res, next) => {
  if (!req.file) {
    req.flash('error', 'Please select an Excel file to upload.');
    return res.redirect('/returns/manifests');
  }

  const filePath = req.file.path;
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      throw new Error('Excel file is empty or contains no data rows.');
    }

    const normalizeKey = (k) => String(k).toLowerCase().replace(/[\s_.]+/g, '');

    const manifestsMap = new Map();

    for (let r = 0; r < rawRows.length; r++) {
      const rawRow = rawRows[r];
      if (Object.values(rawRow).every(v => v === '')) continue;

      const getVal = (possibleNames) => {
        const normalizedPossible = possibleNames.map(p => normalizeKey(p));
        for (const k of Object.keys(rawRow)) {
          if (normalizedPossible.includes(normalizeKey(k))) {
            return String(rawRow[k]).trim();
          }
        }
        return null;
      };

      const nomor_daftar = getVal(['Nomor Daftar', 'nomordaftar', 'Nomor Daftar Outbound', 'nomordaftaroutbound']);
      const no_pesanan_wms = getVal(['Nomor Pesanan WMS', 'nopesananwms', 'order_wms', 'orderwms']);
      const nomor = getVal(['Nomor', 'nomor', 'no']);
      const no_pesanan_oms = getVal(['Nomor Pesanan OMS', 'nopesananoms', 'order_oms', 'orderoms', 'Nomor Perintah OMS', 'nomorperintahoms']);
      const no_pesanan = getVal(['Nomor Pesanan Platform (Wajib di isi)', 'Nomor Pesanan Platform', 'no_pesanan', 'order_number', 'nopesanan', 'nomorpesananplatform']);
      const sku_product = getVal(['SKU Produk (Wajib di isi)', 'SKU Produk', 'sku_product', 'sku', 'item_code', 'itemcode', 'skuproduct', 'skuproduk']);
      const nama_product = getVal(['Nama Produk (Wajib di isi)', 'Nama Produk', 'nama_product', 'item_name', 'namaproduct', 'namabarang', 'namaproduk']);
      const varian_product = getVal(['Varian Produk', 'varian_product', 'variant', 'varianproduct', 'varian', 'varianproduk']);
      const status = getVal(['Status', 'status']);
      const jumlahVal = getVal(['Jumlah', 'jumlah', 'quantity', 'qty']);
      const jumlah = jumlahVal ? parseInt(jumlahVal) || 1 : 1;
      const nama_toko = getVal(['Nama Toko', 'nama_toko', 'toko', 'namatoko']);
      const gudang = getVal(['Gudang', 'gudang']);
      const rak = getVal(['Rak', 'rak']);
      const metode_pengiriman = getVal(['Metode Pengiriman', 'metode_pengiriman', 'kurir', 'metodepengiriman']);
      const jenis_pengiriman = getVal(['Jenis Pengiriman', 'jenis_pengiriman', 'jenispengiriman']);
      const nomor_pengiriman = getVal(['Nomor Pengiriman (Wajib Di isi)', 'Nomor Pengiriman', 'nomor_pengiriman', 'resi', 'resinumber', 'resi_number', 'nomorpengiriman']);
      const penerima = getVal(['Penerima', 'penerima', 'customer', 'customer_name', 'customername']);
      const alamat_pengiriman = getVal(['Alamat Pengiriman', 'alamat_pengiriman', 'alamat', 'alamatpengiriman']);
      const waktu_pesanan = getVal(['Waktu Pesanan', 'waktupesanan', 'Waktu Pemesanan', 'waktupemesanan']);
      const batas_waktu_pengiriman = getVal(['Batas Waktu Pengiriman', 'bataswaktupengiriman']);
      const waktu_outbound = getVal(['Waktu Outbound', 'waktu_outbound', 'outbound_time', 'waktuoutbound']);
      const catatan = getVal(['Catatan', 'catatan', 'notes', 'keterangan']);
      const waktu_cetak = getVal(['Waktu Cetak', 'waktucetak', 'Waktu Cetak Pesanan', 'waktucetakpesanan']);
      const mata_uang = getVal(['Mata Uang', 'matauang']);
      const total_harga_pesanan_val = getVal(['Total Harga Pesanan', 'total_harga_pesanan', 'total_price', 'total_value', 'totalhargapesanan']);
      const total_harga_pesanan = total_harga_pesanan_val ? parseFloat(total_harga_pesanan_val) || 0.00 : 0.00;
      const nama_pemilik = getVal(['Nama Pemilih', 'Nama Pemilik', 'nama_pemilik', 'owner', 'namapemilik', 'namapemilih']);
      const waktu_picking = getVal(['Waktu Picking', 'waktu_picking', 'picking_time', 'waktupicking']);
      const admin_pengemasan = getVal(['Admin Pengemasan', 'admin_pengemasan', 'packer', 'adminpengemasan']);
      const waktu_packing = getVal(['Waktu Packing', 'waktu_packing', 'packing_time', 'waktupacking']);

      if (!nomor_pengiriman || !no_pesanan) {
        throw new Error(`Row ${r + 2} is missing Nomor Pengiriman or Nomor Pesanan Platform.`);
      }
      if (!sku_product) {
        throw new Error(`Row ${r + 2} is missing SKU Produk.`);
      }
      if (!nama_product) {
        throw new Error(`Row ${r + 2} is missing Nama Produk.`);
      }

      const key = `${nomor_pengiriman}||${no_pesanan}`;
      if (!manifestsMap.has(key)) {
        manifestsMap.set(key, {
          resi_number: nomor_pengiriman,
          no_pesanan: no_pesanan,
          customer_name: penerima || nama_pemilik || null,
          customer_contact: null,
          source_type: metode_pengiriman || null,
          return_category: null,
          return_reason: null,
          notes: catatan || null,
          
          nama_toko,
          metode_pengiriman,
          jenis_pengiriman,
          penerima,
          alamat_pengiriman,
          waktu_outbound,
          total_harga_pesanan,
          nama_pemilik,
          waktu_picking,
          admin_pengemasan,
          waktu_packing,

          nomor_daftar,
          no_pesanan_wms,
          no_pesanan_oms,
          status,
          gudang,
          waktu_pesanan,
          batas_waktu_pengiriman,
          waktu_cetak,
          mata_uang,
          
          items: []
        });
      }

      const manifest = manifestsMap.get(key);
      manifest.items.push({
        nomor,
        item_code: sku_product,
        item_name: nama_product,
        varian_product: varian_product,
        quantity: jumlah,
        unit_price: 0.00,
        item_description: varian_product ? `Variant: ${varian_product}` : null,
        rak
      });
    }

    const manifests = Array.from(manifestsMap.values());
    const batchSize = 200;
    for (let i = 0; i < manifests.length; i += batchSize) {
      const batch = manifests.slice(i, i + batchSize);
      await returnService.saveManifestsBatch(batch);
    }


    try { fs.unlinkSync(filePath); } catch (e) {}

    req.flash('success', `Seluruh data return manifest (${manifestsMap.size} data) berhasil diunggah dan disimpan ke database. Produk di dalamnya juga telah terdaftar di master barang.`);
    res.redirect('/returns/manifests');
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch (e) {}
    req.flash('error', `Failed to upload manifest: ${err.message}`);
    res.redirect('/returns/manifests');
  }
};

// ─── Download Manifest Template GET ──────────────────────────────────────────
exports.downloadTemplate = async (req, res, next) => {
  try {
    const headers = [
      'Nomor Daftar Outbound',
      'Nomor Pesanan WMS',
      'Nomor Wave',
      'Nomor Perintah OMS',
      'Nomor Pesanan Platform',
      'SKU Produk',
      'Nama Produk',
      'Varian Produk',
      'Status',
      'Jumlah',
      'Nama Toko',
      'Gudang',
      'Rak',
      'Metode Pengiriman',
      'Jenis Pengiriman',
      'Nomor Pengiriman',
      'Penerima',
      'Alamat Pengiriman',
      'Waktu Pemesanan',
      'Batas Waktu Pengiriman',
      'Waktu Outbound',
      'Catatan',
      'Waktu Cetak Pesanan',
      'Mata Uang',
      'Total Harga Pesanan',
      'Nama Pemilih',
      'Waktu Picking',
      'Admin Pengemasan',
      'Waktu Packing'
    ];

    const sampleData = [
      {
        'Nomor Daftar Outbound': 'REG12345',
        'Nomor Pesanan WMS': 'WMS-998877',
        'Nomor Wave': '',
        'Nomor Perintah OMS': 'OMS-887766',
        'Nomor Pesanan Platform': 'ORD99988',
        'SKU Produk': 'PROD001',
        'Nama Produk': 'Sepatu Berryman Merah',
        'Varian Produk': '42',
        'Status': 'Pending',
        'Jumlah': 2,
        'Nama Toko': 'Berryman Official Store',
        'Gudang': 'Gudang Utama',
        'Rak': 'A-01-02',
        'Metode Pengiriman': 'Firstmile',
        'Jenis Pengiriman': 'Reguler',
        'Nomor Pengiriman': 'JP123456789',
        'Penerima': 'Budi Santoso',
        'Alamat Pengiriman': 'Jl. Sudirman No. 12, Jakarta',
        'Waktu Pemesanan': '2026-06-10 09:00:00',
        'Batas Waktu Pengiriman': '2026-06-12 18:00:00',
        'Waktu Outbound': '2026-06-10 14:30:00',
        'Catatan': 'Harap handle dengan hati-hati',
        'Waktu Cetak Pesanan': '2026-06-10 09:30:00',
        'Mata Uang': 'IDR',
        'Total Harga Pesanan': 300000,
        'Nama Pemilih': 'Budi Santoso',
        'Waktu Picking': '2026-06-10 10:15:00',
        'Admin Pengemasan': 'Packer A',
        'Waktu Packing': '2026-06-10 10:30:00'
      },
      {
        'Nomor Daftar Outbound': 'REG12345',
        'Nomor Pesanan WMS': 'WMS-998877',
        'Nomor Wave': '',
        'Nomor Perintah OMS': 'OMS-887766',
        'Nomor Pesanan Platform': 'ORD99988',
        'SKU Produk': 'PROD002',
        'Nama Produk': 'Kaos Kaki Sport Berryman',
        'Varian Produk': 'Black L',
        'Status': 'Pending',
        'Jumlah': 3,
        'Nama Toko': 'Berryman Official Store',
        'Gudang': 'Gudang Utama',
        'Rak': 'B-02-04',
        'Metode Pengiriman': 'Firstmile',
        'Jenis Pengiriman': 'Reguler',
        'Nomor Pengiriman': 'JP123456789',
        'Penerima': 'Budi Santoso',
        'Alamat Pengiriman': 'Jl. Sudirman No. 12, Jakarta',
        'Waktu Pemesanan': '2026-06-10 09:00:00',
        'Batas Waktu Pengiriman': '2026-06-12 18:00:00',
        'Waktu Outbound': '2026-06-10 14:30:00',
        'Catatan': 'Harap handle dengan hati-hati',
        'Waktu Cetak Pesanan': '2026-06-10 09:30:00',
        'Mata Uang': 'IDR',
        'Total Harga Pesanan': 300000,
        'Nama Pemilih': 'Budi Santoso',
        'Waktu Picking': '2026-06-10 10:15:00',
        'Admin Pengemasan': 'Packer A',
        'Waktu Packing': '2026-06-10 10:30:00'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=return_manifest_template.xlsx');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
};

// ─── API Manifest Lookup GET ──────────────────────────────────────────────────
exports.lookupManifest = async (req, res, next) => {
  try {
    const queryStr = req.query.q;
    if (!queryStr) {
      return res.status(400).json({ error: 'Query parameter q is required.' });
    }
    const manifest = await returnService.getManifestByQuery(queryStr);
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest not found.' });
    }
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.manifestsList = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const search = (req.query.search || '').trim();
    const month = req.query.month || '';
    const year = req.query.year || '';

    // Parse cookies from headers (keeping parsing logic if needed elsewhere)
    const cookieHeader = req.headers.cookie || '';
    const cookies = {};
    cookieHeader.split(';').forEach(c => {
      const parts = c.split('=');
      if (parts.length >= 2) {
        cookies[parts[0].trim()] = decodeURIComponent(parts[1].trim());
      }
    });

    let scannedBarcodes = [];
    if (cookies.scanned_manifests) {
      try {
        scannedBarcodes = JSON.parse(cookies.scanned_manifests);
      } catch (e) {
        scannedBarcodes = [];
      }
    }

    if (!Array.isArray(scannedBarcodes)) {
      scannedBarcodes = [];
    }

    // Always fetch manifests (all scanned ones are in return_manifests)
    const result = await returnService.getManifestsListPaginated({ page, limit, search, month, year });
    const manifests = result.rows;
    const total = result.total;
    const totalPages = result.totalPages;
    
    const stats = await returnService.getManifestsStats({ month, year });

    res.render('returns/manifests', {
      title: 'Return Manifests',
      manifests,
      stats,
      month,
      year,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        search
      }
    });
  } catch (err) { next(err); }
};

// ─── API Manifest Items GET ──────────────────────────────────────────────────
exports.getManifestItems = async (req, res, next) => {
  try {
    const manifestId = parseInt(req.params.id);
    const items = await returnService.getManifestItems(manifestId);
    const [manifestRows] = await db.query('SELECT * FROM return_manifests WHERE manifest_id = ?', [manifestId]);
    const manifest = manifestRows[0] || null;
    res.json({ manifest, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Delete Return Manifest POST ──────────────────────────────────────────────
exports.deleteManifest = async (req, res, next) => {
  try {
    const manifestId = parseInt(req.params.id);
    const [manifestRows] = await db.query('SELECT resi_number, no_pesanan FROM return_manifests WHERE manifest_id = ?', [manifestId]);
    const manifest = manifestRows[0];

    if (!manifest) {
      req.flash('error', 'Manifest tidak ditemukan.');
      return res.redirect('/returns/manifests');
    }

    await returnService.deleteManifest(manifestId);

    await reportService.logActivity(
      req.session.userId, 'delete_manifest', `Deleted manifest resi: ${manifest.resi_number}, order: ${manifest.no_pesanan}`,
      req.ip, req.headers['user-agent']
    );

    req.flash('success', 'Manifest berhasil dihapus.');
    res.redirect('/returns/manifests');
  } catch (err) {
    req.flash('error', `Gagal menghapus manifest: ${err.message}`);
    res.redirect('/returns/manifests');
  }
};

// ─── Delete All Pending Return Manifests POST ──────────────────────────────────
exports.deleteAllPendingManifests = async (req, res, next) => {
  try {
    await returnService.deleteAllPendingManifests();

    await reportService.logActivity(
      req.session.userId, 'delete_all_pending_manifests', 'Deleted all pending return manifests',
      req.ip, req.headers['user-agent']
    );

    req.flash('success', 'Semua pending manifest berhasil dihapus.');
    res.redirect('/returns/manifests');
  } catch (err) {
    req.flash('error', `Gagal menghapus semua pending manifest: ${err.message}`);
    res.redirect('/returns/manifests');
  }
};

// ─── Export Return Manifests to Excel GET ──────────────────────────────────────
exports.exportManifests = async (req, res, next) => {
  try {
    const rows = await returnService.getAllManifestsWithItems();

    const headers = [
      'Nomor Daftar',
      'Nomor Pesanan WMS',
      'Nomor',
      'Nomor Pesanan OMS',
      'Nomor Pesanan Platform',
      'SKU Produk',
      'Nama Produk',
      'Varian Produk',
      'Status',
      'Jumlah',
      'Nama Toko',
      'Gudang',
      'Rak',
      'Metode Pengiriman',
      'Jenis Pengiriman',
      'Nomor Pengiriman',
      'Penerima',
      'Alamat Pengiriman',
      'Waktu Pesanan',
      'Batas Waktu Pengiriman',
      'Waktu Outbound',
      'Catatan',
      'Waktu Cetak',
      'Mata Uang',
      'Total Harga Pesanan',
      'Nama Pemilih',
      'Waktu Picking',
      'Admin Pengemasan',
      'Waktu Packing'
    ];

    const data = rows.map(r => ({
      'Nomor Daftar': r.nomor_daftar || '',
      'Nomor Pesanan WMS': r.no_pesanan_wms || '',
      'Nomor': r.nomor || '',
      'Nomor Pesanan OMS': r.no_pesanan_oms || '',
      'Nomor Pesanan Platform': r.no_pesanan || '',
      'SKU Produk': r.sku_product || r.item_code || '',
      'Nama Produk': r.nama_product || r.item_name || '',
      'Varian Produk': r.varian_product || '',
      'Status': r.status || '',
      'Jumlah': r.jumlah || r.quantity || 0,
      'Nama Toko': r.nama_toko || '',
      'Gudang': r.gudang || '',
      'Rak': r.rak || '',
      'Metode Pengiriman': r.metode_pengiriman || r.source_type || '',
      'Jenis Pengiriman': r.jenis_pengiriman || '',
      'Nomor Pengiriman': r.nomor_pengiriman || r.resi_number || '',
      'Penerima': r.penerima || r.customer_name || '',
      'Alamat Pengiriman': r.alamat_pengiriman || '',
      'Waktu Pesanan': r.waktu_pesanan || '',
      'Batas Waktu Pengiriman': r.batas_waktu_pengiriman || '',
      'Waktu Outbound': r.waktu_outbound || '',
      'Catatan': r.notes || '',
      'Waktu Cetak': r.waktu_cetak || '',
      'Mata Uang': r.mata_uang || '',
      'Total Harga Pesanan': r.total_harga_pesanan || r.total_value || 0,
      'Nama Pemilih': r.nama_pemilik || '',
      'Waktu Picking': r.waktu_picking || '',
      'Admin Pengemasan': r.admin_pengemasan || '',
      'Waktu Packing': r.waktu_packing || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Manifests Export');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=return_manifests_export_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) { next(err); }
};

// ─── Toggle Manifest Item Check status POST ──────────────────────────────────
exports.toggleManifestItemCheck = async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.itemId);
    const { isChecked } = req.body;
    
    // Find the item first
    const [itemRows] = await db.query('SELECT * FROM return_manifest_items WHERE manifest_item_id = ?', [itemId]);
    const item = itemRows[0];
    if (!item) {
      return res.status(404).json({ error: 'Item manifest tidak ditemukan.' });
    }
    
    const isCheckedVal = isChecked ? 1 : 0;
    const checkedBy = isChecked ? req.session.username : null;
    const checkedAt = isChecked ? new Date() : null;
    
    await db.query(
      `UPDATE return_manifest_items 
       SET is_checked = ?, checked_by = ?, checked_at = ? 
       WHERE manifest_item_id = ?`,
      [isCheckedVal, checkedBy, checkedAt, itemId]
    );
    
    // Log activity
    await reportService.logActivity(
      req.session.userId,
      'check_manifest_item',
      `${isChecked ? 'Checked' : 'Unchecked'} SKU ${item.item_code || ''} (${item.item_name}) in manifest ID ${item.manifest_id}`,
      req.ip,
      req.headers['user-agent']
    );
    
    res.json({ 
      success: true, 
      is_checked: isCheckedVal,
      checked_by: checkedBy,
      checked_at: checkedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Toggle Manifest Check status POST ───────────────────────────────────────
exports.toggleManifestCheck = async (req, res, next) => {
  try {
    const manifestId = parseInt(req.params.id);
    const { isChecked } = req.body;
    
    // Find the manifest first
    const [manifestRows] = await db.query('SELECT * FROM return_manifests WHERE manifest_id = ?', [manifestId]);
    const manifest = manifestRows[0];
    if (!manifest) {
      return res.status(404).json({ error: 'Manifest tidak ditemukan.' });
    }
    
    const isCheckedVal = isChecked ? 1 : 0;
    const checkedBy = isChecked ? req.session.username : null;
    const checkedAt = isChecked ? new Date() : null;
    
    await db.query(
      `UPDATE return_manifests 
       SET is_checked = ?, checked_by = ?, checked_at = ? 
       WHERE manifest_id = ?`,
      [isCheckedVal, checkedBy, checkedAt, manifestId]
    );
    
    // Log activity
    await reportService.logActivity(
      req.session.userId,
      'check_manifest',
      `${isChecked ? 'Checked' : 'Unchecked'} manifest resi ${manifest.resi_number} (ID: ${manifestId})`,
      req.ip,
      req.headers['user-agent']
    );
    
    res.json({ 
      success: true, 
      is_checked: isCheckedVal,
      checked_by: checkedBy,
      checked_at: checkedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


