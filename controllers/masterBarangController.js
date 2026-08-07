'use strict';
const db = require('../config/database');
const XLSX = require('xlsx');

// ─── Index – Daftar Master Barang ─────────────────────────────────────────────
exports.index = async (req, res, next) => {
  try {
    const { search, kategori, status } = req.query;

    let sql  = 'SELECT * FROM master_barang WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (kode_barang LIKE ? OR nama_barang LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (kategori) {
      sql += ' AND kategori = ?';
      params.push(kategori);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY nama_barang ASC';

    const [rows]      = await db.query(sql, params);
    const [kategoriRows] = await db.query('SELECT DISTINCT kategori FROM master_barang WHERE kategori IS NOT NULL ORDER BY kategori');

    res.render('master-barang/index', {
      title      : 'Master Barang',
      items      : rows,
      kategoriList: kategoriRows.map(r => r.kategori),
      filters    : req.query
    });
  } catch (err) { next(err); }
};

// ─── Create Form ──────────────────────────────────────────────────────────────
exports.createForm = (req, res) => {
  res.render('master-barang/form', {
    title  : 'Tambah Barang',
    item   : null,
    action : '/master-barang'
  });
};

// ─── Store ────────────────────────────────────────────────────────────────────
exports.store = async (req, res, next) => {
  try {
    const { kode_barang, nama_barang, kategori, satuan, harga_beli, harga_jual, stok_minimum, deskripsi } = req.body;

    if (!kode_barang || !nama_barang) {
      req.flash('error', 'Kode barang dan nama barang wajib diisi.');
      return res.redirect('/master-barang/create');
    }

    // Check duplicate kode_barang
    const [exists] = await db.query('SELECT id FROM master_barang WHERE kode_barang = ?', [kode_barang.trim()]);
    if (exists.length > 0) {
      req.flash('error', `Kode barang "${kode_barang}" sudah terdaftar.`);
      return res.redirect('/master-barang/create');
    }

    await db.query(
      `INSERT INTO master_barang (kode_barang, nama_barang, kategori, satuan, harga_beli, harga_jual, stok_minimum, deskripsi)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        kode_barang.trim(),
        nama_barang.trim(),
        kategori || null,
        satuan || null,
        parseFloat(harga_beli) || 0,
        parseFloat(harga_jual) || 0,
        parseInt(stok_minimum) || 0,
        deskripsi || null
      ]
    );

    req.flash('success', `Barang "${nama_barang}" berhasil ditambahkan.`);
    res.redirect('/master-barang');
  } catch (err) { next(err); }
};

// ─── Edit Form ────────────────────────────────────────────────────────────────
exports.editForm = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM master_barang WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      req.flash('error', 'Barang tidak ditemukan.');
      return res.redirect('/master-barang');
    }
    res.render('master-barang/form', {
      title  : 'Edit Barang',
      item   : rows[0],
      action : `/master-barang/${rows[0].id}?_method=PUT`
    });
  } catch (err) { next(err); }
};

// ─── Update ───────────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { kode_barang, nama_barang, kategori, satuan, harga_beli, harga_jual, stok_minimum, deskripsi, status } = req.body;

    if (!kode_barang || !nama_barang) {
      req.flash('error', 'Kode barang dan nama barang wajib diisi.');
      return res.redirect(`/master-barang/${req.params.id}/edit`);
    }

    // Check duplicate kode_barang (exclude current)
    const [exists] = await db.query('SELECT id FROM master_barang WHERE kode_barang = ? AND id != ?', [kode_barang.trim(), req.params.id]);
    if (exists.length > 0) {
      req.flash('error', `Kode barang "${kode_barang}" sudah digunakan oleh barang lain.`);
      return res.redirect(`/master-barang/${req.params.id}/edit`);
    }

    await db.query(
      `UPDATE master_barang SET kode_barang=?, nama_barang=?, kategori=?, satuan=?, harga_beli=?, harga_jual=?, stok_minimum=?, deskripsi=?, status=? WHERE id=?`,
      [
        kode_barang.trim(),
        nama_barang.trim(),
        kategori || null,
        satuan || null,
        parseFloat(harga_beli) || 0,
        parseFloat(harga_jual) || 0,
        parseInt(stok_minimum) || 0,
        deskripsi || null,
        status || 'active',
        req.params.id
      ]
    );

    req.flash('success', `Barang "${nama_barang}" berhasil diperbarui.`);
    res.redirect('/master-barang');
  } catch (err) { next(err); }
};

// ─── Delete ───────────────────────────────────────────────────────────────────
exports.destroy = async (req, res, next) => {
  try {
    await db.query('DELETE FROM master_barang WHERE id = ?', [req.params.id]);
    req.flash('success', 'Barang berhasil dihapus.');
    res.redirect('/master-barang');
  } catch (err) { next(err); }
};

// Active uploads in-memory store
const activeUploads = {};

// ─── Background XLSX processor ──────────────────────────────────────────────────
async function processXLSXInBackground(taskId, records) {
  const task = activeUploads[taskId];
  if (!task) return;

  try {
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const kode = (row.kode_barang !== undefined && row.kode_barang !== null) ? row.kode_barang.toString().trim() : '';
      const nama = (row.nama_barang !== undefined && row.nama_barang !== null) ? row.nama_barang.toString().trim() : '';

      if (!kode || !nama) {
        task.skipped++;
        task.progress = i + 1;
        continue;
      }

      try {
        const [exists] = await db.query('SELECT id FROM master_barang WHERE kode_barang = ?', [kode]);

        const kategori = (row.kategori !== undefined && row.kategori !== null) ? row.kategori.toString().trim() : null;
        const satuan = (row.satuan !== undefined && row.satuan !== null) ? row.satuan.toString().trim() : null;
        const hargaBeli = row.harga_beli !== undefined ? parseFloat(row.harga_beli) || 0 : 0;
        const hargaJual = row.harga_jual !== undefined ? parseFloat(row.harga_jual) || 0 : 0;
        const stokMinimum = row.stok_minimum !== undefined ? parseInt(row.stok_minimum) || 0 : 0;
        const deskripsi = (row.deskripsi !== undefined && row.deskripsi !== null) ? row.deskripsi.toString().trim() : null;
        const status = (row.status !== undefined && row.status !== null) ? row.status.toString().trim() : 'active';

        if (exists.length > 0) {
          const updateFields = [];
          const updateParams = [];

          if (row.nama_barang !== undefined) {
            updateFields.push('nama_barang = ?');
            updateParams.push(nama);
          }
          if (row.kategori !== undefined) {
            updateFields.push('kategori = ?');
            updateParams.push(kategori);
          }
          if (row.satuan !== undefined) {
            updateFields.push('satuan = ?');
            updateParams.push(satuan);
          }
          if (row.harga_beli !== undefined) {
            updateFields.push('harga_beli = ?');
            updateParams.push(hargaBeli);
          }
          if (row.harga_jual !== undefined) {
            updateFields.push('harga_jual = ?');
            updateParams.push(hargaJual);
          }
          if (row.stok_minimum !== undefined) {
            updateFields.push('stok_minimum = ?');
            updateParams.push(stokMinimum);
          }
          if (row.deskripsi !== undefined) {
            updateFields.push('deskripsi = ?');
            updateParams.push(deskripsi);
          }
          if (row.status !== undefined) {
            updateFields.push('status = ?');
            updateParams.push(status);
          }

          if (updateFields.length > 0) {
            updateParams.push(kode);
            await db.query(
              `UPDATE master_barang SET ${updateFields.join(', ')} WHERE kode_barang = ?`,
              updateParams
            );
            task.updated++;
          } else {
            task.skipped++;
          }
        } else {
          await db.query(
            `INSERT INTO master_barang (kode_barang, nama_barang, kategori, satuan, harga_beli, harga_jual, stok_minimum, deskripsi, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [kode, nama, kategori, satuan, hargaBeli, hargaJual, stokMinimum, deskripsi, status]
          );
          task.inserted++;
        }
      } catch (err) {
        console.error('Error processing XLSX row:', err);
        task.skipped++;
      }
      task.progress = i + 1;
    }
    task.status = 'completed';
  } catch (err) {
    console.error('XLSX Import process failed:', err);
    task.status = 'failed';
    task.error = err.message || 'Error processing XLSX rows';
  }
}

// ─── Upload XLSX ──────────────────────────────────────────────────────────────
exports.uploadXLSX = async (req, res, next) => {
  try {
    const isAJAX = req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1);

    if (!req.file) {
      if (isAJAX) {
        return res.status(400).json({ error: 'Tidak ada file Excel yang diunggah.' });
      }
      req.flash('error', 'Tidak ada file Excel yang diunggah.');
      return res.redirect('/master-barang');
    }

    let records = [];
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRecords = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      // Normalize keys to support flexible case-insensitive header formats
      records = rawRecords.map(row => {
        const normalizedRow = {};
        for (const key of Object.keys(row)) {
          const normKey = key.trim().toLowerCase().replace(/\s+/g, '_');
          normalizedRow[normKey] = row[key];
        }
        return normalizedRow;
      });
    } catch (err) {
      if (isAJAX) {
        return res.status(400).json({ error: 'Gagal membaca format file Excel.' });
      }
      req.flash('error', 'Gagal membaca format file Excel.');
      return res.redirect('/master-barang');
    }

    if (records.length === 0) {
      if (isAJAX) {
        return res.status(400).json({ error: 'File Excel kosong atau format tidak valid.' });
      }
      req.flash('error', 'File Excel kosong atau format tidak valid.');
      return res.redirect('/master-barang');
    }

    // Required headers for upload: kode_barang, nama_barang, harga_jual
    const required = ['kode_barang', 'nama_barang', 'harga_jual'];
    const firstRow = records[0];
    const missing  = required.filter(k => !(k in firstRow));
    if (missing.length > 0) {
      const errMsg = `Kolom wajib tidak ditemukan di file Excel: ${missing.map(m => m.replace(/_/g, ' ')).join(', ')}. Pastikan file Excel memiliki header: Kode Barang, Nama Barang, Harga Jual.`;
      if (isAJAX) {
        return res.status(400).json({ error: errMsg });
      }
      req.flash('error', errMsg);
      return res.redirect('/master-barang');
    }

    const taskId = 'xlsx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    activeUploads[taskId] = {
      progress: 0,
      total: records.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      status: 'processing',
      error: null
    };

    // Run processing asynchronously in background
    processXLSXInBackground(taskId, records);

    if (isAJAX) {
      return res.json({ success: true, taskId, total: records.length });
    }

    req.flash('success', 'File Excel sedang diproses di latar belakang.');
    res.redirect('/master-barang');
  } catch (err) { next(err); }
};

// ─── Export XLSX ─────────────────────────────────────────────────────────────
exports.exportXLSX = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM master_barang ORDER BY nama_barang ASC');

    const data = rows.map(r => ({
      'Kode Barang': r.kode_barang || '',
      'Nama Barang': r.nama_barang || '',
      'Kategori': r.kategori || '',
      'Satuan': r.satuan || '',
      'Harga Beli': parseFloat(r.harga_beli) || 0,
      'Harga Jual': parseFloat(r.harga_jual) || 0,
      'Stok Minimum': parseInt(r.stok_minimum) || 0,
      'Deskripsi': r.deskripsi || '',
      'Status': r.status === 'active' ? 'Aktif' : 'Nonaktif'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Barang');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=master_barang_export_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (err) { next(err); }
};

// ─── Get Upload Progress ─────────────────────────────────────────────────────
exports.getUploadProgress = (req, res) => {
  const { taskId } = req.params;
  const task = activeUploads[taskId];

  if (!task) {
    return res.status(404).json({ error: 'Tugas upload tidak ditemukan.' });
  }

  res.json(task);

  // Clean up completed/failed task after 5 minutes
  if (task.status === 'completed' || task.status === 'failed') {
    setTimeout(() => {
      delete activeUploads[taskId];
    }, 5 * 60 * 1000);
  }
};

// ─── API Search (JSON) ────────────────────────────────────────────────────────
exports.apiSearch = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);

    const [rows] = await db.query(
      `SELECT kode_barang, nama_barang, satuan, harga_jual
       FROM master_barang
       WHERE status = 'active'
         AND (kode_barang LIKE ? OR nama_barang LIKE ?)
       ORDER BY nama_barang ASC
       LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
    res.json(rows);
  } catch (err) { next(err); }
};
