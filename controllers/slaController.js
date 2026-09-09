'use strict';
const db = require('../config/database');
const slaService = require('../services/slaService');

/**
 * GET /sla - Display all SLA configs
 */
exports.index = async (req, res, next) => {
  try {
    const slaType = req.query.type || 'STANDARD'; // Filter by SLA type
    
    const [rows] = await db.query(
      `SELECT 
        sla_id, sla_name, code_name, code_trigger, code_trigger_2, 
        sla_type, sla_hours, sla_days, description, is_active, priority
       FROM sla_configs 
       WHERE is_active = 1 AND sla_type = ?
       ORDER BY priority ASC, sla_name ASC`,
      [slaType]
    );

    // Get available SLA types for filter dropdown
    const [slaTypes] = await db.query(
      `SELECT DISTINCT sla_type FROM sla_configs ORDER BY sla_type`
    );

    res.render('sla/index', {
      title: 'SLA Configurations',
      items: rows,
      slaTypes: slaTypes,
      currentType: slaType
    });
  } catch (err) { next(err); }
};

/**
 * GET /sla/:id/edit - Show edit form for SLA config
 */
exports.editForm = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT 
        sla_id, sla_name, code_name, code_trigger, code_trigger_2, 
        sla_type, sla_hours, sla_days, description, is_active 
       FROM sla_configs 
       WHERE sla_id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      req.flash('error', 'SLA config tidak ditemukan.');
      return res.redirect('/sla');
    }

    res.render('sla/form', {
      title: 'Edit SLA Config',
      item: rows[0],
      action: `/sla/${rows[0].sla_id}?_method=PUT`,
      isEdit: true
    });
  } catch (err) { next(err); }
};

/**
 * GET /sla/create - Show create form for new SLA config
 */
exports.createForm = async (req, res, next) => {
  try {
    res.render('sla/form', {
      title: 'Create New SLA Config',
      item: {},
      action: '/sla',
      isEdit: false
    });
  } catch (err) { next(err); }
};

/**
 * POST /sla - Create new SLA config
 */
exports.create = async (req, res, next) => {
  try {
    const { sla_name, code_name, code_trigger, code_trigger_2, sla_type, sla_hours, description, is_active } = req.body;
    
    if (!sla_name || !code_name || !sla_type || !sla_hours) {
      req.flash('error', 'Semua field wajib diisi.');
      return res.redirect('/sla/create');
    }

    const slaHours = parseInt(sla_hours) || 24;
    const slaDays = Math.ceil(slaHours / 24);
    const active = is_active === 'on' ? 1 : 0;

    await db.query(
      `INSERT INTO sla_configs 
        (sla_name, code_name, code_trigger, code_trigger_2, sla_type, sla_hours, sla_days, description, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sla_name,
        code_name,
        code_trigger || null,
        code_trigger_2 || null,
        sla_type,
        slaHours,
        slaDays,
        description || null,
        active
      ]
    );

    req.flash('success', 'SLA config berhasil dibuat.');
    res.redirect('/sla');
  } catch (err) { next(err); }
};

/**
 * PUT /sla/:id - Update existing SLA config
 */
exports.update = async (req, res, next) => {
  try {
    const { sla_name, code_name, code_trigger, code_trigger_2, sla_type, sla_hours, description, is_active } = req.body;
    
    if (!sla_name || !code_name || !sla_type || !sla_hours) {
      req.flash('error', 'Semua field wajib diisi.');
      return res.redirect(`/sla/${req.params.id}/edit`);
    }

    const slaHours = parseInt(sla_hours) || 24;
    const slaDays = Math.ceil(slaHours / 24);
    const active = is_active === 'on' ? 1 : 0;

    await db.query(
      `UPDATE sla_configs 
       SET sla_name = ?, code_name = ?, code_trigger = ?, code_trigger_2 = ?, 
           sla_type = ?, sla_hours = ?, sla_days = ?, description = ?, is_active = ?
       WHERE sla_id = ?`,
      [
        sla_name,
        code_name,
        code_trigger || null,
        code_trigger_2 || null,
        sla_type,
        slaHours,
        slaDays,
        description || null,
        active,
        req.params.id
      ]
    );

    req.flash('success', 'SLA config berhasil diperbarui.');
    res.redirect('/sla');
  } catch (err) { next(err); }
};

/**
 * DELETE /sla/:id - Delete SLA config (soft delete via is_active flag)
 */
exports.delete = async (req, res, next) => {
  try {
    await db.query(
      'UPDATE sla_configs SET is_active = 0 WHERE sla_id = ?',
      [req.params.id]
    );

    req.flash('success', 'SLA config berhasil dihapus.');
    res.redirect('/sla');
  } catch (err) { next(err); }
};

/**
 * GET /sla/report/breaches - View SLA breaches report
 */
exports.breachesReport = async (req, res, next) => {
  try {
    const [breaches] = await db.query(
      `SELECT 
        st.tracking_id, st.return_id, st.stage, st.started_at, 
        st.expected_completion, st.completed_at, st.is_breached, 
        st.breach_hours, sc.sla_name, sc.code_name, r.return_number
       FROM sla_tracking st
       JOIN sla_configs sc ON st.sla_id = sc.sla_id
       JOIN returns r ON st.return_id = r.return_id
       WHERE st.is_breached = 1
       ORDER BY st.expected_completion ASC`
    );

    res.render('sla/breaches', {
      title: 'SLA Breaches Report',
      breaches: breaches
    });
  } catch (err) { next(err); }
};

/**
 * GET /sla/report/summary - View SLA summary statistics
 */
exports.summaryReport = async (req, res, next) => {
  try {
    const [summary] = await db.query(
      `SELECT 
        sc.code_name,
        sc.sla_name,
        COUNT(st.tracking_id) as total_sla_configs,
        SUM(CASE WHEN st.is_breached = 1 THEN 1 ELSE 0 END) as breached_count,
        ROUND(
          SUM(CASE WHEN st.is_breached = 1 THEN 1 ELSE 0 END) / COUNT(st.tracking_id) * 100, 
          2
        ) as breach_percentage,
        AVG(st.breach_hours) as avg_breach_hours
       FROM sla_configs sc
       LEFT JOIN sla_tracking st ON sc.sla_id = st.sla_id
       WHERE sc.is_active = 1
       GROUP BY sc.sla_id, sc.code_name, sc.sla_name
       ORDER BY breach_percentage DESC`
    );

    res.render('sla/summary', {
      title: 'SLA Summary Report',
      summary: summary
    });
  } catch (err) { next(err); }
};
