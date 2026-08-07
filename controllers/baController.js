'use strict';
const baService = require('../services/baService');
const reportService = require('../services/reportService');
const db = require('../config/database');
const XLSX          = require('xlsx');

// ─── List ─────────────────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const docs = await baService.getBAList(req.query);
    const vendors = await baService.getVendors();

    // Determine selected BA
    let selectedBa = null;
    let items = [];

    let baId = req.query.ba_id ? parseInt(req.query.ba_id) : null;
    // If no ba_id is in query, default to the first document in the filtered list
    if (!baId && docs && docs.length > 0) {
      baId = docs[0].ba_id;
    }

    if (baId) {
      selectedBa = await baService.getBAById(baId);
      if (selectedBa) {
        // Fetch items linked directly in inventory_stock
        const [stockItems] = await db.query(`
          SELECT 
            ri.item_code AS sku, ri.item_name, ri.quantity, 
            s.category AS disposition, s.status AS current_status,
            v.vendor_name,
            mb.harga_beli AS harga_vendor,
            COALESCE(s.sale_price, ri.total_price) AS harga_final,
            s.stock_id
          FROM inventory_stock s
          JOIN return_items ri ON s.item_id = ri.item_id
          LEFT JOIN vendors v ON s.vendor_id = v.vendor_id
          LEFT JOIN master_barang mb ON ri.item_code COLLATE utf8mb4_unicode_ci = mb.kode_barang COLLATE utf8mb4_unicode_ci
          WHERE s.ba_id = ?
        `, [selectedBa.ba_id]);

        if (stockItems && stockItems.length > 0) {
          items = stockItems;
        } else {
          // Fallback to legacy return_id logic if no items are explicitly linked in inventory_stock
          let itemSql = `
            SELECT 
              ri.item_code AS sku, ri.item_name, ri.quantity, ri.disposition, 
              ri.disposition AS category,
              r.current_status,
              v.vendor_name,
              mb.harga_beli AS harga_vendor,
              ri.total_price AS harga_final
            FROM return_items ri
            JOIN returns r ON ri.return_id = r.return_id
            LEFT JOIN vendors v ON ri.vendor_id = v.vendor_id
            LEFT JOIN master_barang mb ON ri.item_code COLLATE utf8mb4_unicode_ci = mb.kode_barang COLLATE utf8mb4_unicode_ci
            WHERE ri.return_id = ?
          `;
          const params = [selectedBa.return_id];
          if (selectedBa.ba_type === 'write_off') {
            itemSql += " AND ri.disposition = 'write_off'";
          } else if (['refurbish', 'rekondisi'].includes(selectedBa.ba_type)) {
            itemSql += " AND ri.disposition IN ('refurbish', 'rekondisi')";
          } else if (selectedBa.ba_type === 'retur_supplier') {
            itemSql += " AND ri.disposition = 'return_to_supplier'";
            if (selectedBa.vendor_id) {
              itemSql += " AND ri.vendor_id = ?";
              params.push(selectedBa.vendor_id);
            }
          }
          const [oldItems] = await db.query(itemSql, params);
          items = oldItems.map(it => ({
            sku: it.sku,
            item_name: it.item_name,
            quantity: it.quantity,
            disposition: it.disposition,
            current_status: it.current_status,
            vendor_name: it.vendor_name,
            harga_vendor: it.harga_vendor,
            harga_final: it.harga_final
          }));
        }
      }
    }

    res.render('ba/list', {
      title: 'Berita Acara',
      docs,
      vendors,
      filters: req.query,
      ba: selectedBa,
      items
    });
  } catch (err) { next(err); }
};

// ─── View ─────────────────────────────────────────────────────────────────────
exports.view = async (req, res, next) => {
  try {
    const ba = await baService.getBAById(parseInt(req.params.id));
    if (!ba) { req.flash('error', 'Berita Acara tidak ditemukan.'); return res.redirect('/ba'); }

    // Fetch items linked directly in inventory_stock
    let items = [];
    const [stockItems] = await db.query(`
      SELECT 
        ri.item_code AS sku, ri.item_name, sum(ri.quantity) as quantity, 
            s.category AS disposition, s.status AS current_status,
            v.vendor_name
      FROM inventory_stock s
      JOIN return_items ri ON s.item_id = ri.item_id
      LEFT JOIN vendors v ON s.vendor_id = v.vendor_id
      LEFT JOIN master_barang mb ON ri.item_code COLLATE utf8mb4_unicode_ci = mb.kode_barang COLLATE utf8mb4_unicode_ci
      WHERE s.ba_id = ?
      GROUP BY  ri.item_code, ri.item_name, ri.quantity, s.category, s.status,v.vendor_name, mb.harga_beli 
    `, [ba.ba_id]);

    if (stockItems && stockItems.length > 0) {
      items = stockItems;
    } else {
      // Fallback to legacy return_id logic if no items are explicitly linked in inventory_stock
      let itemSql = `
        SELECT 
          ri.item_code AS sku, ri.item_name, ri.quantity, ri.disposition, 
          ri.disposition AS category,
          r.current_status,
          v.vendor_name,
          mb.harga_beli AS harga_vendor,
          ri.total_price AS harga_final
        FROM return_items ri
        JOIN returns r ON ri.return_id = r.return_id
        LEFT JOIN vendors v ON ri.vendor_id = v.vendor_id
        LEFT JOIN master_barang mb ON ri.item_code COLLATE utf8mb4_unicode_ci = mb.kode_barang COLLATE utf8mb4_unicode_ci
        WHERE ri.return_id = ?
      `;
      const params = [ba.return_id];
      if (ba.ba_type === 'write_off') {
        itemSql += " AND ri.disposition = 'write_off'";
      } else if (['refurbish', 'rekondisi'].includes(ba.ba_type)) {
        itemSql += " AND ri.disposition IN ('refurbish', 'rekondisi')";
      } else if (ba.ba_type === 'retur_supplier') {
        itemSql += " AND ri.disposition = 'return_to_supplier'";
        if (ba.vendor_id) {
          itemSql += " AND ri.vendor_id = ?";
          params.push(ba.vendor_id);
        }
      }
      const [oldItems] = await db.query(itemSql, params);
      items = oldItems.map(it => ({
        sku: it.sku,
        item_name: it.item_name,
        quantity: it.quantity,
        disposition: it.disposition,
        current_status: it.current_status,
        vendor_name: it.vendor_name,
        harga_vendor: it.harga_vendor,
        harga_final: it.harga_final
      }));
    }

    res.render('ba/view', { title: `BA – ${ba.ba_number}`, ba, items });
  } catch (err) { next(err); }
};

// ─── Create Form / Automatic BA Creation ──────────────────────────────────────
exports.createForm = async (req, res, next) => {
  try {
    const stockIdsParam = req.query.stock_ids || '';
    if (!stockIdsParam) {
      req.flash('error', 'Silakan pilih item dari Stok terlebih dahulu.');
      return res.redirect('/ba');
    }

    const stockIds = stockIdsParam.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    if (stockIds.length === 0) {
      req.flash('error', 'Silakan pilih item dari Stok terlebih dahulu.');
      return res.redirect('/ba');
    }

    // Query details of selected stock items
    const [stockItems] = await db.query(`
      SELECT s.stock_id, s.return_id, s.category, s.vendor_id, s.sale_price,
             ri.item_name, ri.item_code, ri.sku, ri.serial_number, ri.quantity,
             ri.total_price
      FROM inventory_stock s
      JOIN return_items ri ON s.item_id = ri.item_id
      WHERE s.stock_id IN (?)
        AND s.ba_id IS NULL
    `, [stockIds]);

    if (stockItems.length === 0) {
      req.flash('error', 'Item stok terpilih tidak valid atau sudah masuk BA lain.');
      return res.redirect('/ba');
    }

    if (stockItems.length !== stockIds.length) {
      req.flash('error', 'Sebagian item stok sudah masuk BA lain. Silakan pilih ulang item yang tersedia.');
      return res.redirect('/ba');
    }

    // Determine BA type from selected stock category
    const categories = [...new Set(stockItems.map(item => item.category).filter(Boolean))];
    const baTypeMap = {
      rekondisi: 'rekondisi',
      refurbish: 'refurbish',
      write_off: 'write_off',
      return_to_supplier: 'retur_supplier'
    };
    let baType = 'retur_final';
    if (categories.length === 1 && baTypeMap[categories[0]]) {
      baType = baTypeMap[categories[0]];
    }

    // Get the first return_id
    const firstReturnId = stockItems[0].return_id;
    const vendorIds = [...new Set(stockItems.map(item => item.vendor_id).filter(id => id !== null))];
    const vendorId = vendorIds.length === 1 ? vendorIds[0] : null;

    // Calculate final price as sum of sale_price or total_price
    const totalFinalPrice = stockItems.reduce((sum, item) => {
      const val = parseFloat(item.sale_price) || parseFloat(item.total_price) || 0;
      return sum + val;
    }, 0);

    // Default values for automatic BA
    const defaultData = {
      ba_type: baType,
      return_id: firstReturnId,
      title: 'Berita acara retur Final',
      content: 'Dibuat secara otomatis dari item stok terpilih.',
      final_price: totalFinalPrice > 0 ? totalFinalPrice : null,
      vendor_id: vendorId
    };

    // Create the BA
    const { baId, baNumber } = await baService.createBA(defaultData, req.session.userId);

    // Link inventory stock items to this BA and update status to completed
    await db.query('UPDATE inventory_stock SET ba_id = ?, status = ? WHERE stock_id IN (?) AND ba_id IS NULL', [baId, 'completed', stockIds]);

    // Update return_items current_status to Completed for linked items
    await db.query(`
      UPDATE return_items ri
      SET ri.current_status = ?
      WHERE ri.item_id IN (
        SELECT item_id FROM inventory_stock WHERE stock_id IN (?)
      )
    `, ['Completed', stockIds]);

    // Link returns to this BA
    await db.query(`
      UPDATE returns 
      SET ba_id = ? 
      WHERE return_id IN (
        SELECT DISTINCT return_id FROM inventory_stock WHERE stock_id IN (?)
      )
    `, [baId, stockIds]);

    await reportService.logActivity(req.session.userId, 'create_ba',
      `BA ${baNumber} dibuat secara otomatis dari Stok`, req.ip, req.headers['user-agent']);

    req.flash('success', `Berita Acara ${baNumber} berhasil dibuat.`);
    res.redirect(`/ba?ba_id=${baId}`);
  } catch (err) { next(err); }
};

// ─── Create POST ──────────────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { stock_ids } = req.body;
    const { baId, baNumber } = await baService.createBA(req.body, req.session.userId);

    if (stock_ids) {
      const stockIds = stock_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
      if (stockIds.length > 0) {
        // Link inventory stock items to this BA and update status to completed
        await db.query('UPDATE inventory_stock SET ba_id = ?, status = ? WHERE stock_id IN (?) AND ba_id IS NULL', [baId, 'completed', stockIds]);

        // Update return_items current_status to Completed for linked items
        await db.query(`
          UPDATE return_items ri
          SET ri.current_status = ?
          WHERE ri.item_id IN (
            SELECT item_id FROM inventory_stock WHERE stock_id IN (?)
          )
        `, ['Completed', stockIds]);

        // Link returns to this BA
        await db.query(`
          UPDATE returns 
          SET ba_id = ? 
          WHERE return_id IN (
            SELECT DISTINCT return_id FROM inventory_stock WHERE stock_id IN (?)
          )
        `, [baId, stockIds]);
      }
    }

    await reportService.logActivity(req.session.userId, 'create_ba',
      `BA ${baNumber} dibuat`, req.ip, req.headers['user-agent']);

    req.flash('success', `Berita Acara ${baNumber} berhasil dibuat.`);
    res.redirect(`/ba/${baId}`);
  } catch (err) { next(err); }
};

// ─── Submit for Signing ───────────────────────────────────────────────────────
exports.submitForSigning = async (req, res, next) => {
  try {
    await baService.submitForSigning(parseInt(req.params.id));
    req.flash('success', 'BA dikirim untuk ditandatangani.');
    res.redirect(`/ba/${req.params.id}`);
  } catch (err) { next(err); }
};

// ─── Signature Form ───────────────────────────────────────────────────────────
exports.signForm = async (req, res, next) => {
  try {
    const ba = await baService.getBAById(parseInt(req.params.id));
    if (!ba) { req.flash('error', 'Berita Acara tidak ditemukan.'); return res.redirect('/ba'); }

    const role = req.session.userRole;
    // Map role to signature field
    const sigFieldMap = {
      staff_recover: 'staff_recover',
      purchasing: 'fat',
      manager: 'fat',
      admin: 'admin'
    };
    const sigField = sigFieldMap[role];
    if (!sigField) {
      req.flash('error', 'Role Anda tidak berwenang menandatangani BA ini.');
      return res.redirect(`/ba/${req.params.id}`);
    }

    res.render('ba/sign', { title: `Tanda Tangan BA – ${ba.ba_number}`, ba, sigField });
  } catch (err) { next(err); }
};

// ─── Save Signature ───────────────────────────────────────────────────────────
exports.saveSign = async (req, res, next) => {
  try {
    const { sig_field, signature_data } = req.body;
    const baId = parseInt(req.params.id);

    if (!signature_data || !signature_data.startsWith('data:image/')) {
      req.flash('error', 'Tanda tangan tidak valid. Silakan coba lagi.');
      return res.redirect(`/ba/${baId}/sign`);
    }

    await baService.signBA(baId, sig_field, signature_data, req.session.userId);

    await reportService.logActivity(req.session.userId, 'sign_ba',
      `BA #${baId} ditandatangani (${sig_field})`, req.ip, req.headers['user-agent']);

    req.flash('success', 'Tanda tangan digital berhasil disimpan.');
    res.redirect(`/ba/${baId}`);
  } catch (err) { next(err); }
};

// ─── Void BA ─────────────────────────────────────────────────────────────────
exports.void = async (req, res, next) => {
  try {
    await baService.voidBA(parseInt(req.params.id));
    await reportService.logActivity(req.session.userId, 'void_ba',
      `BA #${req.params.id} di-void`, req.ip, req.headers['user-agent']);
    req.flash('warning', 'Berita Acara telah di-void.');
    res.redirect('/ba');
  } catch (err) { next(err); }
};

// ─── Vendor Management ────────────────────────────────────────────────────────
exports.vendorList = async (req, res, next) => {
  try {
    const vendors = await baService.getVendors(false);
    res.render('ba/vendors', { title: 'Manajemen Vendor', vendors });
  } catch (err) { next(err); }
};

exports.createVendor = async (req, res, next) => {
  try {
    await baService.createVendor(req.body, req.session.userId);
    req.flash('success', 'Vendor baru berhasil ditambahkan.');
    res.redirect('/ba/vendors');
  } catch (err) { next(err); }
};

exports.updateVendor = async (req, res, next) => {
  try {
    await baService.updateVendor(parseInt(req.params.id), req.body);
    req.flash('success', 'Data vendor diperbarui.');
    res.redirect('/ba/vendors');
  } catch (err) { next(err); }
};

// ─── Export Excel ─────────────────────────────────────────────────────────────
exports.exportExcel = async (req, res, next) => {
  try {
    const ba = await baService.getBAById(parseInt(req.params.id));
    if (!ba) {
      req.flash('error', 'Berita Acara tidak ditemukan.');
      return res.redirect('/ba');
    }

    // Fetch items linked directly in inventory_stock
    let items = [];
    const [stockItems] = await db.query(`
      SELECT 
        ri.item_code AS sku, ri.item_name, ri.quantity, 
        s.category AS disposition, s.status AS current_status,
        v.vendor_name
      FROM inventory_stock s
      JOIN return_items ri ON s.item_id = ri.item_id
      LEFT JOIN vendors v ON s.vendor_id = v.vendor_id
      LEFT JOIN master_barang mb ON ri.item_code COLLATE utf8mb4_unicode_ci = mb.kode_barang COLLATE utf8mb4_unicode_ci
      WHERE s.ba_id = ?
      GROUP BY  ri.item_code, ri.item_name, ri.quantity, s.category, s.status,v.vendor_name, mb.harga_beli 
    `, [ba.ba_id]);

    if (stockItems && stockItems.length > 0) {
      items = stockItems;
    } else {
      // Fallback logic
      let itemSql = `
        SELECT 
          ri.item_code AS sku, ri.item_name, ri.quantity, ri.disposition, 
          ri.disposition AS category,
          r.current_status,
          v.vendor_name,
          mb.harga_beli AS harga_vendor,
          ri.total_price AS harga_final
        FROM return_items ri
        JOIN returns r ON ri.return_id = r.return_id
        LEFT JOIN vendors v ON ri.vendor_id = v.vendor_id
        LEFT JOIN master_barang mb ON ri.item_code COLLATE utf8mb4_unicode_ci = mb.kode_barang COLLATE utf8mb4_unicode_ci
        WHERE ri.return_id = ?
      `;
      const params = [ba.return_id];
      if (ba.ba_type === 'write_off') {
        itemSql += " AND ri.disposition = 'write_off'";
      } else if (['refurbish', 'rekondisi'].includes(ba.ba_type)) {
        itemSql += " AND ri.disposition IN ('refurbish', 'rekondisi')";
      } else if (ba.ba_type === 'retur_supplier') {
        itemSql += " AND ri.disposition = 'return_to_supplier'";
        if (ba.vendor_id) {
          itemSql += " AND ri.vendor_id = ?";
          params.push(ba.vendor_id);
        }
      }
      const [oldItems] = await db.query(itemSql, params);
      items = oldItems.map(it => ({
        sku: it.sku,
        item_name: it.item_name,
        quantity: it.quantity,
        disposition: it.disposition,
        current_status: it.current_status,
        vendor_name: it.vendor_name,
        harga_vendor: it.harga_vendor,
        harga_final: it.harga_final
      }));
    }

    const data = [];
    
    // Row 1: title A-H (8 columns for proper alignment)
    data.push(['BERITA ACARA RETUR FINAL', '', '', '', '', '', '', '']);
    
    // Row 2: headers
    data.push(['', '', '', 'BERRYMAN', '', 'Approved by:', '', '']);
    
    // Row 3: Judul
    data.push(['', '', '', 'Judul', ba.title || 'Berita acara retur Final', 'Manager Ops', 'Purchasing', 'FAT']);
    
    // Row 4: Periode
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const docDate = ba.created_at ? new Date(ba.created_at) : new Date();
    const docPeriod = `${months[docDate.getMonth()]} ${docDate.getFullYear()}`;
    data.push([
      '', '', '', 
      'Periode Dokumen', docPeriod, 
      ba.sig_admin_name || 'Nama', 
      ba.sig_fat_name || 'Nama',
      ba.sig_staff_recover_name || 'Nama'
    ]);
    
    // Row 5: Signature placeholders
    data.push([
      '', '', '', 
      '', '', 
      ba.sig_admin ? 'SIGNED' : '', 
      ba.sig_fat ? 'SIGNED' : '',
      ba.sig_staff_recover ? 'SIGNED' : ''
    ]);
    
    // Row 6: Column headers (8 columns)
    data.push(['No', 'SKU', 'Nama Produk', 'QTY', 'Kategori Retur', 'Keterangan', 'Vendor', '']);
    
    // Rows 7+: Items
    items.forEach((item, idx) => {
      const catMap = { rekondisi: 'Rekondisi', refurbish: 'Refurbish', write_off: 'Write off', return_to_supplier: 'Retur Supplier' };
      data.push([
        idx + 1,
        item.sku || '-',
        item.item_name || '',
        item.quantity || 0,
        catMap[item.disposition] || item.disposition || '-',
        '',
        item.vendor_name || '-',
        ''
      ]);
    });
    
    // Add empty rows up to minimum 10 item rows
    const minRows = 10;
    const emptyRowsCount = Math.max(0, minRows - items.length);
    for (let i = 0; i < emptyRowsCount; i++) {
      data.push(['', '', '', '', '', '', '', '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, // Row 1 title A-H (8 columns)
      { s: { r: 1, c: 0 }, e: { r: 4, c: 2 } }, // Row 2-5 black box A-C
      { s: { r: 1, c: 3 }, e: { r: 1, c: 4 } }, // Row 2 BERRYMAN header D-E
      { s: { r: 1, c: 5 }, e: { r: 1, c: 7 } }  // Row 2 Approved by header F-H
    ];

    ws['!cols'] = [
      { wch: 6 },  // No
      { wch: 15 }, // SKU
      { wch: 30 }, // Nama Produk
      { wch: 8 },  // QTY
      { wch: 18 }, // Kategori Retur
      { wch: 30 }, // Keterangan
      { wch: 20 }, // Vendor
      { wch: 5 }   // Empty column for spacing
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Berita Acara');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    const safeFilename = ba.ba_number.replace(/\//g, '_');
    res.setHeader('Content-Disposition', `attachment; filename=BA_Export_${safeFilename}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) { next(err); }
};

// ─── Export All ───────────────────────────────────────────────────────────────
exports.exportAll = async (req, res, next) => {
  try {
    const docs = await baService.getBAList(req.query);
    
    const baIds = docs.map(d => d.ba_id);
    let items = [];
    if (baIds.length > 0) {
      const [stockItems] = await db.query(`
        SELECT 
          ri.item_code AS sku, ri.item_name, ri.quantity, 
          s.category AS disposition,
          v.vendor_name,
          mb.harga_beli AS harga_vendor,
          COALESCE(s.sale_price, ri.total_price) AS harga_final,
          ba.ba_number
        FROM inventory_stock s
        JOIN return_items ri ON s.item_id = ri.item_id
        JOIN berita_acara ba ON s.ba_id = ba.ba_id
        LEFT JOIN vendors v ON s.vendor_id = v.vendor_id
        LEFT JOIN master_barang mb ON ri.item_code COLLATE utf8mb4_unicode_ci = mb.kode_barang COLLATE utf8mb4_unicode_ci
        WHERE s.ba_id IN (?)
      `, [baIds]);
      items = stockItems;

      // Fetch BAs that didn't have stockItems (fallback)
      const foundBaNumbers = new Set(items.map(it => it.ba_number));
      const missingBAs = docs.filter(d => !foundBaNumbers.has(d.ba_number));
      if (missingBAs.length > 0) {
        const missingBaIds = missingBAs.map(d => d.ba_id);
        const [oldItems] = await db.query(`
          SELECT 
            ri.item_code AS sku, ri.item_name, ri.quantity, ri.disposition AS disposition, 
            v.vendor_name,
            mb.harga_beli AS harga_vendor,
            ri.total_price AS harga_final,
            ba.ba_number
          FROM return_items ri
          JOIN berita_acara ba ON ri.return_id = ba.return_id
          LEFT JOIN vendors v ON ri.vendor_id = v.vendor_id
          LEFT JOIN master_barang mb ON ri.item_code COLLATE utf8mb4_unicode_ci = mb.kode_barang COLLATE utf8mb4_unicode_ci
          WHERE ba.ba_id IN (?) AND (
            (ba.ba_type = 'write_off' AND ri.disposition = 'write_off') OR
            (ba.ba_type IN ('refurbish', 'rekondisi') AND ri.disposition IN ('refurbish', 'rekondisi')) OR
            (ba.ba_type = 'retur_supplier' AND ri.disposition = 'return_to_supplier' AND (ba.vendor_id IS NULL OR ri.vendor_id = ba.vendor_id)) OR
            (ba.ba_type NOT IN ('write_off', 'refurbish', 'rekondisi', 'retur_supplier'))
          )
        `, [missingBaIds]);
        items = items.concat(oldItems);
      }
    }

    const data = [];
    
    // Row 1: Merged Title A1 to I1 (9 columns)
    data.push(['BERITA ACARA RETUR FINAL - REKAPITULASI', '', '', '', '', '', '', '', '']);
    
    // Row 2: Headers
    data.push(['', '', '', '', 'BERRYMAN', '', 'Approved by:', '', '']);
    
    // Row 3: Judul
    data.push(['', '', '', '', 'Judul', 'Rekapitulasi Berita Acara', 'Manager Ops', 'Purchasing', 'FAT']);
    
    // Row 4: Periode
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const docDate = new Date();
    const docPeriod = `${months[docDate.getMonth()]} ${docDate.getFullYear()}`;
    data.push([
      '', '', '', '', 
      'Periode Dokumen', docPeriod, 
      '-', '-', '-'
    ]);
    
    // Row 5: Signature status
    data.push([
      '', '', '', '', 
      '', '', 
      '', '', ''
    ]);
    
    // Row 6: Column headers (9 columns)
    data.push(['No', 'Nomor BA', 'SKU', 'Nama Produk', 'QTY', 'Kategori Retur', 'Keterangan', 'Vendor', '']);
    
    // Rows 7+: Items list
    items.forEach((item, idx) => {
      const catMap = { rekondisi: 'Rekondisi', refurbish: 'Refurbish', write_off: 'Write off', return_to_supplier: 'Retur Supplier' };
      data.push([
        idx + 1,
        item.ba_number || '-',
        item.sku || '-',
        item.item_name || '',
        item.quantity || 0,
        catMap[item.disposition] || item.disposition || '-',
        '',
        item.vendor_name || '-',
        ''
      ]);
    });
    
    // Add empty rows up to minimum 10 item rows
    const minRows = 10;
    const emptyRowsCount = Math.max(0, minRows - items.length);
    for (let i = 0; i < emptyRowsCount; i++) {
      data.push(['', '', '', '', '', '', '', '', '']);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, // Row 1 title A-I (9 columns)
      { s: { r: 1, c: 0 }, e: { r: 4, c: 3 } }, // Row 2-5 black box A-D
      { s: { r: 1, c: 4 }, e: { r: 1, c: 5 } }, // Row 2 BERRYMAN header E-F
      { s: { r: 1, c: 6 }, e: { r: 1, c: 8 } }  // Row 2 Approved by header G-I
    ];

    ws['!cols'] = [
      { wch: 6 },   // No
      { wch: 25 },  // Nomor BA
      { wch: 15 },  // SKU
      { wch: 30 },  // Nama Produk
      { wch: 8 },   // QTY
      { wch: 18 },  // Kategori Retur
      { wch: 30 },  // Keterangan
      { wch: 20 },  // Vendor
      { wch: 5 }    // Empty column for spacing
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rekapitulasi Berita Acara');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', `attachment; filename=BA_Rekap_Data_Export_${Date.now()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) { next(err); }
};
