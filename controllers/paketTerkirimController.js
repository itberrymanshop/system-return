'use strict';
const db = require('../config/database');

const monthsList = [
  { value: 1, name: 'Januari' },
  { value: 2, name: 'Februari' },
  { value: 3, name: 'Maret' },
  { value: 4, name: 'April' },
  { value: 5, name: 'Mei' },
  { value: 6, name: 'Juni' },
  { value: 7, name: 'Juli' },
  { value: 8, name: 'Agustus' },
  { value: 9, name: 'September' },
  { value: 10, name: 'Oktober' },
  { value: 11, name: 'November' },
  { value: 12, name: 'Desember' }
];

function getYearsList() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - 5; y <= currentYear + 5; y++) {
    years.push(y);
  }
  return years;
}

// ─── Index ────────────────────────────────────────────────────────────────────
exports.index = async (req, res, next) => {
  try {
    const { search_year, search_month } = req.query;
    let sql = 'SELECT * FROM paket_terkirim WHERE is_show = 1';
    const params = [];

    if (search_year) {
      sql += ' AND tahun = ?';
      params.push(parseInt(search_year));
    }
    if (search_month) {
      sql += ' AND bulan = ?';
      params.push(parseInt(search_month));
    }

    sql += ' ORDER BY tahun DESC, bulan DESC';
    const [rows] = await db.query(sql, params);

    res.render('paket-terkirim/index', {
      title: 'Paket Terkirim',
      items: rows,
      monthsList,
      yearsList: getYearsList(),
      filters: req.query,
      getMonthName: (m) => {
        const found = monthsList.find(item => item.value === m);
        return found ? found.name : '';
      }
    });
  } catch (err) {
    next(err);
  }
};

// ─── Create Form ──────────────────────────────────────────────────────────────
exports.createForm = async (req, res, next) => {
  try {
    const today = new Date();
    const defaultMonth = today.getMonth() + 1; // 1-indexed
    const defaultYear = today.getFullYear();

    res.render('paket-terkirim/form', {
      title: 'Tambah Paket Terkirim',
      item: null,
      defaultMonth,
      defaultYear,
      monthsList,
      yearsList: getYearsList(),
      action: '/master-paket-terkirim'
    });
  } catch (err) {
    next(err);
  }
};

// ─── Store ────────────────────────────────────────────────────────────────────
exports.store = async (req, res, next) => {
  try {
    const { bulan, tahun, total_terkirim } = req.body;
    const qty = parseInt(total_terkirim);
    const m = parseInt(bulan);
    const y = parseInt(tahun);

    if (!m || !y || isNaN(qty) || qty < 0) {
      req.flash('error', 'Semua input wajib diisi dengan benar.');
      return res.redirect('/master-paket-terkirim/create');
    }

    // Check duplicate active record
    const [dup] = await db.query(
      'SELECT id FROM paket_terkirim WHERE bulan = ? AND tahun = ? AND is_show = 1',
      [m, y]
    );

    if (dup.length > 0) {
      const monthName = monthsList.find(item => item.value === m)?.name || m;
      req.flash('error', `Data paket terkirim untuk periode ${monthName} ${y} sudah ada.`);
      return res.redirect('/master-paket-terkirim/create');
    }

    await db.query(
      'INSERT INTO paket_terkirim (bulan, tahun, total_terkirim) VALUES (?, ?, ?)',
      [m, y, qty]
    );

    const monthName = monthsList.find(item => item.value === m)?.name || m;
    req.flash('success', `Data paket terkirim untuk periode ${monthName} ${y} berhasil ditambahkan.`);
    res.redirect('/master-paket-terkirim');
  } catch (err) {
    next(err);
  }
};

// ─── Edit Form ────────────────────────────────────────────────────────────────
exports.editForm = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM paket_terkirim WHERE id = ? AND is_show = 1',
      [req.params.id]
    );

    if (rows.length === 0) {
      req.flash('error', 'Data tidak ditemukan.');
      return res.redirect('/master-paket-terkirim');
    }

    res.render('paket-terkirim/form', {
      title: 'Edit Paket Terkirim',
      item: rows[0],
      defaultMonth: rows[0].bulan,
      defaultYear: rows[0].tahun,
      monthsList,
      yearsList: getYearsList(),
      action: `/master-paket-terkirim/${rows[0].id}?_method=PUT`
    });
  } catch (err) {
    next(err);
  }
};

// ─── Update ───────────────────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const { bulan, tahun, total_terkirim } = req.body;
    const qty = parseInt(total_terkirim);
    const m = parseInt(bulan);
    const y = parseInt(tahun);

    if (!m || !y || isNaN(qty) || qty < 0) {
      req.flash('error', 'Semua input wajib diisi dengan benar.');
      return res.redirect(`/master-paket-terkirim/${req.params.id}/edit`);
    }

    // Check duplicate active record other than current
    const [dup] = await db.query(
      'SELECT id FROM paket_terkirim WHERE bulan = ? AND tahun = ? AND is_show = 1 AND id != ?',
      [m, y, req.params.id]
    );

    if (dup.length > 0) {
      const monthName = monthsList.find(item => item.value === m)?.name || m;
      req.flash('error', `Data paket terkirim untuk periode ${monthName} ${y} sudah ada.`);
      return res.redirect(`/master-paket-terkirim/${req.params.id}/edit`);
    }

    await db.query(
      'UPDATE paket_terkirim SET bulan = ?, tahun = ?, total_terkirim = ? WHERE id = ?',
      [m, y, qty, req.params.id]
    );

    req.flash('success', 'Data paket terkirim berhasil diperbarui.');
    res.redirect('/master-paket-terkirim');
  } catch (err) {
    next(err);
  }
};

// ─── Delete (Soft delete) ─────────────────────────────────────────────────────
exports.destroy = async (req, res, next) => {
  try {
    await db.query(
      'UPDATE paket_terkirim SET is_show = 0 WHERE id = ?',
      [req.params.id]
    );

    req.flash('success', 'Data paket terkirim berhasil dihapus.');
    res.redirect('/master-paket-terkirim');
  } catch (err) {
    next(err);
  }
};
