'use strict';
const db = require('../config/database');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate next sequential kode_expedisi, e.g. EXP-001 */
async function generateKode() {
  const [rows] = await db.query(
    "SELECT kode_expedisi FROM master_expedisi WHERE kode_expedisi REGEXP '^EXP-[0-9]+$' ORDER BY CAST(SUBSTRING(kode_expedisi, 5) AS UNSIGNED) DESC LIMIT 1"
  );
  if (rows.length === 0) return 'EXP-001';
  const last = parseInt(rows[0].kode_expedisi.replace('EXP-', ''), 10);
  return 'EXP-' + String(last + 1).padStart(3, '0');
}

/** Parse a raw CSV string into an array of objects. */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows  = lines.map(line => {
    const fields = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  }).filter(r => r.some(f => f !== ''));

  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

// ─── Index ────────────────────────────────────────────────────────────────────
exports.index = async (req, res, next) => {
  try {
    const { search, status } = req.query;

    let sql    = 'SELECT * FROM master_expedisi WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (kode_expedisi LIKE ? OR nama_expedisi LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY kode_expedisi ASC';

    const [rows] = await db.query(sql, params);

    res.render('master-expedisi/index', {
      title  : 'Master Expedisi',
      items  : rows,
      filters: req.query
    });
  } catch (err) { next(err); }
};

// ─── Create Form ──────────────────────────────────────────────────────────────
exports.createForm = async (req, res, next) => {
  try {
    const kode = await generateKode();
    res.render('master-expedisi/form', {
      title      : 'Tambah Expedisi',
      item       : null,
      kodeGenerated: kode,
      action     : '/master-expedisi'
    });
  } catch (err) { next(err); }
};

// ─── Store ────────────────────────────────────────────────────────────────────
exports.store = async (req, res, next) => {
  try {
    const { nama_expedisi } = req.body;

    if (!nama_expedisi || !nama_expedisi.trim()) {
      req.flash('error', 'Nama expedisi wajib diisi.');
      return res.redirect('/master-expedisi/create');
    }

    const kode_expedisi = await generateKode();

    await db.query(
      'INSERT INTO master_expedisi (kode_expedisi, nama_expedisi) VALUES (?, ?)',
      [kode_expedisi, nama_expedisi.trim()]
    );

    req.flash('success', `Expedisi "${nama_expedisi.trim()}" berhasil ditambahkan dengan kode ${kode_expedisi}.`);
    res.redirect('/master-expedisi');
  } catch (err) { next(err); }
};

// ─── Edit Form ────────────────────────────────────────────────────────────────
exports.editForm = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM master_expedisi WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      req.flash('error', 'Expedisi tidak ditemukan.');
      return res.redirect('/master-expedisi');
    }
    res.render('master-expedisi/form', {
      title        : 'Edit Expedisi',
      item         : rows[0],
      kodeGenerated: rows[0].kode_expedisi,
      action       : `/master-expedisi/${rows[0].id}?_method=PUT`
    });
  } catch (err) { next(err); }
};

// ─── Update ───────────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { nama_expedisi, status } = req.body;

    if (!nama_expedisi || !nama_expedisi.trim()) {
      req.flash('error', 'Nama expedisi wajib diisi.');
      return res.redirect(`/master-expedisi/${req.params.id}/edit`);
    }

    await db.query(
      'UPDATE master_expedisi SET nama_expedisi = ?, status = ? WHERE id = ?',
      [nama_expedisi.trim(), status || 'active', req.params.id]
    );

    req.flash('success', `Expedisi "${nama_expedisi.trim()}" berhasil diperbarui.`);
    res.redirect('/master-expedisi');
  } catch (err) { next(err); }
};

// ─── Delete ───────────────────────────────────────────────────────────────────
exports.destroy = async (req, res, next) => {
  try {
    await db.query('DELETE FROM master_expedisi WHERE id = ?', [req.params.id]);
    req.flash('success', 'Expedisi berhasil dihapus.');
    res.redirect('/master-expedisi');
  } catch (err) { next(err); }
};

// ─── Upload CSV ───────────────────────────────────────────────────────────────
exports.uploadCSV = async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'Tidak ada file CSV yang diunggah.');
      return res.redirect('/master-expedisi');
    }

    const text    = req.file.buffer.toString('utf-8');
    const records = parseCSV(text);

    if (records.length === 0) {
      req.flash('error', 'File CSV kosong atau format tidak valid.');
      return res.redirect('/master-expedisi');
    }

    const firstRow = records[0];
    if (!('nama_expedisi' in firstRow)) {
      req.flash('error', 'Kolom wajib tidak ditemukan: nama_expedisi. Pastikan header CSV menggunakan kolom nama_expedisi (dan opsional kode_expedisi).');
      return res.redirect('/master-expedisi');
    }

    let inserted = 0, updated = 0, skipped = 0;

    for (const row of records) {
      const nama = (row.nama_expedisi || '').trim();
      if (!nama) { skipped++; continue; }

      // If CSV provides kode, use it; otherwise auto-generate
      let kode = (row.kode_expedisi || '').trim();

      if (kode) {
        // Upsert by kode
        const [exists] = await db.query('SELECT id FROM master_expedisi WHERE kode_expedisi = ?', [kode]);
        if (exists.length > 0) {
          await db.query('UPDATE master_expedisi SET nama_expedisi = ? WHERE kode_expedisi = ?', [nama, kode]);
          updated++;
        } else {
          await db.query('INSERT INTO master_expedisi (kode_expedisi, nama_expedisi) VALUES (?, ?)', [kode, nama]);
          inserted++;
        }
      } else {
        // Check duplicate by nama before inserting
        const [dupName] = await db.query('SELECT id FROM master_expedisi WHERE nama_expedisi = ?', [nama]);
        if (dupName.length > 0) { skipped++; continue; }
        kode = await generateKode();
        await db.query('INSERT INTO master_expedisi (kode_expedisi, nama_expedisi) VALUES (?, ?)', [kode, nama]);
        inserted++;
      }
    }

    req.flash('success', `Import CSV selesai: ${inserted} ditambahkan, ${updated} diperbarui, ${skipped} dilewati.`);
    res.redirect('/master-expedisi');
  } catch (err) { next(err); }
};
