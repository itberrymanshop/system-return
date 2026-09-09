'use strict';
const db = require('../config/database');
const dateHelper = require('../utils/dateHelper');

// ═══════════════════════════════════════════════════════════════════════════
// NEW SLA SERVICE - Enhanced to support new SLA structure
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get SLA config by code_name and filters
 */
async function getSLAByCode(codeName, filter1 = null, filter2 = null) {
  try {
    const baseQuery = 'SELECT * FROM sla_configs WHERE is_active = 1 AND code_name = ?';
    const params = [codeName];

    function buildQuery(extraClauses, extraParams) {
      const query = `${baseQuery} ${extraClauses} ORDER BY priority ASC, sla_id ASC LIMIT 1`;
      return db.query(query, [...params, ...extraParams]);
    }

    // Try exact match first
    if (filter1 !== null && filter2 !== null) {
      const [exactRows] = await buildQuery('AND code_trigger = ? AND code_trigger_2 = ?', [filter1, filter2]);
      if (exactRows.length > 0) return exactRows[0];
    }

    if (filter1 !== null && filter2 === null) {
      const [rows] = await buildQuery('AND (code_trigger = ? OR code_trigger = ? OR code_trigger IS NULL)', [filter1, '[No Code]']);
      if (rows.length > 0) return rows[0];
    }

    if (filter2 !== null && filter1 === null) {
      const [rows] = await buildQuery('AND code_trigger_2 = ?', [filter2]);
      if (rows.length > 0) return rows[0];
    }

    if (filter1 !== null && filter2 !== null) {
      const [fallbackRows] = await buildQuery('AND code_trigger_2 = ? AND (code_trigger = ? OR code_trigger = ? OR code_trigger IS NULL)', [filter2, filter1, '[No Code]']);
      if (fallbackRows.length > 0) return fallbackRows[0];
    }

    // Fallback to default config for this code_name
    const [defaultRows] = await buildQuery('AND (code_trigger = ? OR code_trigger IS NULL) AND code_trigger_2 IS NULL', ['[No Code]']);
    return defaultRows.length > 0 ? defaultRows[0] : null;
  } catch (err) {
    console.error('Error fetching SLA by code:', err);
    throw err;
  }
}

/**
 * Get all active SLAs by type
 */
async function getSLAsByType(slaType) {
  try {
    const [rows] = await db.query(
      `SELECT * FROM sla_configs 
       WHERE is_active = 1 AND sla_type = ?
       ORDER BY priority ASC, sla_name ASC`,
      [slaType]
    );
    return rows;
  } catch (err) {
    console.error('Error fetching SLAs by type:', err);
    throw err;
  }
}

/**
 * Create SLA tracking record for monitoring compliance
 */
async function createSLATracking(returnId, slaId, stage, startedAt = null) {
  try {
    // Fetch SLA config
    const [slaConfigs] = await db.query(
      'SELECT sla_hours, sla_days FROM sla_configs WHERE sla_id = ?',
      [slaId]
    );

    if (slaConfigs.length === 0) {
      throw new Error('SLA config not found');
    }

    const slaHours = slaConfigs[0].sla_hours;
    const startTime = startedAt ? new Date(startedAt) : new Date();
    const expectedCompletion = new Date(startTime.getTime() + slaHours * 60 * 60 * 1000);

    const [result] = await db.query(
      `INSERT INTO sla_tracking 
       (return_id, sla_id, stage, started_at, expected_completion) 
       VALUES (?, ?, ?, ?, ?)`,
      [returnId, slaId, stage, startTime, expectedCompletion]
    );

    await db.query(
      'UPDATE returns SET sla_days = ?, sla_deadline = ? WHERE return_id = ?',
      [slaConfigs[0].sla_days, expectedCompletion, returnId]
    );

    return result.insertId;
  } catch (err) {
    console.error('Error creating SLA tracking:', err);
    throw err;
  }
}

/**
 * Mark SLA tracking as completed and check if breached
 */
async function completeSLATracking(trackingId, completedAt = null) {
  try {
    const completeTime = completedAt ? new Date(completedAt) : new Date();

    // Get tracking record
    const [tracking] = await db.query(
      'SELECT expected_completion FROM sla_tracking WHERE tracking_id = ?',
      [trackingId]
    );

    if (tracking.length === 0) {
      throw new Error('Tracking record not found');
    }

    const isBreached = completeTime > tracking[0].expected_completion ? 1 : 0;
    const breachHours = isBreached 
      ? Math.ceil((completeTime - tracking[0].expected_completion) / (1000 * 60 * 60))
      : 0;

    const [result] = await db.query(
      `UPDATE sla_tracking 
       SET completed_at = ?, is_breached = ?, breach_hours = ?
       WHERE tracking_id = ?`,
      [completeTime, isBreached, breachHours, trackingId]
    );

    return {
      isBreached: isBreached === 1,
      breachHours: breachHours
    };
  } catch (err) {
    console.error('Error completing SLA tracking:', err);
    throw err;
  }
}

/**
 * Get active SLA tracking for a return
 */
async function getActiveSLATracking(returnId, stage = null) {
  try {
    let query = `SELECT st.* FROM sla_tracking st
       WHERE st.return_id = ? AND st.completed_at IS NULL`;
    const params = [returnId];

    if (stage !== null) {
      query += ' AND st.stage = ?';
      params.push(stage);
    }

    query += ' ORDER BY st.created_at DESC';
    const [rows] = await db.query(query, params);
    return rows;
  } catch (err) {
    console.error('Error fetching active SLA tracking:', err);
    throw err;
  }
}

/**
 * Complete the active SLA tracking for a given return and optional stage.
 */
async function completeActiveSLATracking(returnId, stage = null) {
  try {
    const activeTrackings = await getActiveSLATracking(returnId, stage);
    if (!activeTrackings || activeTrackings.length === 0) {
      return null;
    }
    return await completeSLATracking(activeTrackings[0].tracking_id);
  } catch (err) {
    console.error('Error completing active SLA tracking:', err);
    throw err;
  }
}

/**
 * Get SLA breaches for return
 */
async function getSLABreaches(returnId) {
  try {
    const [rows] = await db.query(
      `SELECT st.*, sc.sla_name, sc.code_name FROM sla_tracking st
       JOIN sla_configs sc ON st.sla_id = sc.sla_id
       WHERE st.return_id = ? AND st.is_breached = 1
       ORDER BY st.expected_completion ASC`,
      [returnId]
    );
    return rows;
  } catch (err) {
    console.error('Error fetching SLA breaches:', err);
    throw err;
  }
}

/**
 * Get SLA compliance metrics
 */
async function getSLAMetrics(filters = {}) {
  try {
    let query = `
      SELECT 
        sc.code_name,
        sc.sla_name,
        COUNT(st.tracking_id) as total_tracked,
        SUM(CASE WHEN st.is_breached = 1 THEN 1 ELSE 0 END) as breached_count,
        SUM(CASE WHEN st.is_breached = 0 THEN 1 ELSE 0 END) as compliant_count,
        ROUND(
          SUM(CASE WHEN st.is_breached = 0 THEN 1 ELSE 0 END) / COUNT(st.tracking_id) * 100,
          2
        ) as compliance_percentage
      FROM sla_configs sc
      LEFT JOIN sla_tracking st ON sc.sla_id = st.sla_id
      WHERE sc.is_active = 1
    `;

    const params = [];

    if (filters.slaType) {
      query += ' AND sc.sla_type = ?';
      params.push(filters.slaType);
    }

    if (filters.stage) {
      query += ' AND st.stage = ?';
      params.push(filters.stage);
    }

    query += ` GROUP BY sc.sla_id, sc.code_name, sc.sla_name
               ORDER BY compliance_percentage ASC`;

    const [rows] = await db.query(query, params);
    return rows;
  } catch (err) {
    console.error('Error fetching SLA metrics:', err);
    throw err;
  }
}

/**
 * Check if SLA is breaching soon (within 2 hours)
 */
async function getUpcomingBreaches() {
  try {
    const [rows] = await db.query(
      `SELECT st.*, sc.sla_name, sc.code_name, r.return_number
       FROM sla_tracking st
       JOIN sla_configs sc ON st.sla_id = sc.sla_id
       JOIN returns r ON st.return_id = r.return_id
       WHERE st.completed_at IS NULL 
       AND st.is_breached = 0
       AND st.expected_completion <= DATE_ADD(NOW(), INTERVAL 2 HOUR)
       AND st.expected_completion > NOW()
       ORDER BY st.expected_completion ASC`
    );
    return rows;
  } catch (err) {
    console.error('Error fetching upcoming breaches:', err);
    throw err;
  }
}

/**
 * Apply SLA to specific process stages
 * This is called when a return moves through stages
 */
async function applySLAToStage(returnId, stage, filter1 = null, filter2 = null, startedAt = null) {
  try {
    // Determine code_name based on stage
    const codeNameMap = {
      'sorting': 'SLA Sorting',
      'pricing': 'SLA Pricing',
      'process_rekondisi': 'SLA Proses',
      'process_refurbish': 'SLA Proses',
      'process_write_off': 'SLA Proses',
      'recovery': 'SLA Recover'
    };

    const codeName = codeNameMap[stage] || null;
    if (!codeName) {
      console.log(`No SLA mapping for stage: ${stage}`);
      return null;
    }

    // Get matching SLA config
    const slaConfig = await getSLAByCode(codeName, filter1, filter2);
    if (!slaConfig) {
      console.log(`No SLA config found for: ${codeName} / ${filter1} / ${filter2}`);
      return null;
    }

    // Check if there is already an active SLA tracking record for this stage
    const activeTrackings = await getActiveSLATracking(returnId, stage);
    if (activeTrackings && activeTrackings.length > 0) {
      const tracking = activeTrackings[0];
      const startTime = startedAt ? new Date(startedAt) : new Date();
      const expectedCompletion = new Date(startTime.getTime() + slaConfig.sla_hours * 60 * 60 * 1000);

      await db.query(
        `UPDATE sla_tracking 
         SET started_at = ?, expected_completion = ?, updated_at = NOW(), is_breached = 0, breach_hours = 0
         WHERE tracking_id = ?`,
        [startTime, expectedCompletion, tracking.tracking_id]
      );

      await db.query(
        'UPDATE returns SET sla_days = ?, sla_deadline = ? WHERE return_id = ?',
        [slaConfig.sla_days, expectedCompletion, returnId]
      );

      return {
        trackingId: tracking.tracking_id,
        slaId: slaConfig.sla_id,
        slaName: slaConfig.sla_name,
        slaHours: slaConfig.sla_hours,
        slaDays: slaConfig.sla_days
      };
    }

    // Create tracking record
    const trackingId = await createSLATracking(returnId, slaConfig.sla_id, stage, startedAt);
    return {
      trackingId: trackingId,
      slaId: slaConfig.sla_id,
      slaName: slaConfig.sla_name,
      slaHours: slaConfig.sla_hours,
      slaDays: slaConfig.sla_days
    };
  } catch (err) {
    console.error('Error applying SLA to stage:', err);
    throw err;
  }
}

/**
 * Get SLA alerts - Returns at or near breach
 */
async function getSLAAlerts() {
  try {
    const [rows] = await db.query(`
      SELECT 
        st.tracking_id, st.return_id, st.stage, st.expected_completion, 
        st.is_breached, sc.sla_name, sc.code_name,
        r.return_number, r.customer_name, r.current_status, r.pic_user_id,
        u.full_name AS pic_name,
        TIMESTAMPDIFF(HOUR, NOW(), st.expected_completion) AS hours_left
      FROM sla_tracking st
      JOIN sla_configs sc ON st.sla_id = sc.sla_id
      JOIN returns r ON st.return_id = r.return_id
      LEFT JOIN users u ON r.pic_user_id = u.user_id
      WHERE st.completed_at IS NULL
        AND r.current_status NOT IN ('Completed', 'Rejected', 'Cancelled')
        AND st.expected_completion <= DATE_ADD(NOW(), INTERVAL 2 HOUR)
      ORDER BY st.expected_completion ASC
      LIMIT 50
    `);
    return rows;
  } catch (err) {
    console.error('Error fetching SLA alerts:', err);
    throw err;
  }
}

/**
 * Get SLA alerts grouped by SKU - Returns at or near breach
 */
async function getSLAAlertsBySKU() {
  try {
    const [rows] = await db.query(`
      SELECT 
        st.tracking_id, st.return_id, st.stage, st.expected_completion, 
        st.is_breached, sc.sla_name, sc.code_name,
        r.return_number, r.customer_name, r.current_status, r.pic_user_id,
        r.sla_deadline,
        DATEDIFF(r.sla_deadline, NOW()) AS days_left,
        u.full_name AS pic_name,
        TIMESTAMPDIFF(HOUR, NOW(), st.expected_completion) AS hours_left,
        ri.item_code, ri.item_name, ri.quantity
      FROM sla_tracking st
      JOIN sla_configs sc ON st.sla_id = sc.sla_id
      JOIN returns r ON st.return_id = r.return_id
      LEFT JOIN users u ON r.pic_user_id = u.user_id
      LEFT JOIN return_items ri ON r.return_id = ri.return_id
      WHERE st.completed_at IS NULL
        AND r.current_status NOT IN ('Completed', 'Rejected', 'Cancelled')
        AND st.expected_completion <= DATE_ADD(NOW(), INTERVAL 2 HOUR)
      ORDER BY st.expected_completion ASC
      LIMIT 50
    `);
    return rows;
  } catch (err) {
    console.error('Error fetching SLA alerts by SKU:', err);
    throw err;
  }
}


/**
 * Classify a return's SLA health
 * Returns { status, label, color, hoursLeft }
 */
function getSLAStatus(expectedCompletion) {
  if (!expectedCompletion) {
    return { status: 'no_sla', label: '-', color: 'secondary', hoursLeft: null };
  }

  const now = new Date();
  const deadline = new Date(expectedCompletion);
  const hoursLeft = Math.round((deadline - now) / (1000 * 60 * 60));

  if (hoursLeft < 0) 
    return { status: 'overdue', label: `Terlambat ${Math.abs(hoursLeft)}j`, color: 'danger', hoursLeft };
  if (hoursLeft === 0) 
    return { status: 'due_today', label: 'Jatuh Tempo Sekarang', color: 'danger', hoursLeft };
  if (hoursLeft <= 2) 
    return { status: 'critical', label: `${hoursLeft}j lagi`, color: 'danger', hoursLeft };
  if (hoursLeft <= 12) 
    return { status: 'warning', label: `${hoursLeft}j lagi`, color: 'warning', hoursLeft };
  return { status: 'ok', label: `${hoursLeft}j lagi`, color: 'success', hoursLeft };
}

// Legacy function for backward compatibility
async function getSLADays(stage, priority) {
  // Map old stages to new code names
  const stageMap = {
    'Sorting': 'SLA Sorting',
    'Rekondisi': 'SLA Proses',
    'Refurbish': 'SLA Proses',
    'Write_Off': 'SLA Proses'
  };

  const codeName = stageMap[stage];
  if (!codeName) return 7; // Default fallback

  try {
    const sla = await getSLAByCode(codeName, null, null);
    return sla ? sla.sla_days : 7;
  } catch (err) {
    console.error('Error in getSLADays:', err);
    return 7;
  }
}

// Legacy function for backward compatibility
async function calcSLA(status, priority, fromDate) {
  const days = await getSLADays(status, priority);
  const d = new Date(fromDate || new Date());
  d.setDate(d.getDate() + days);
  const deadline = dateHelper.getJakartaDateString(d);
  return { sla_days: days, sla_deadline: deadline };
}

module.exports = {
  // New functions
  getSLAByCode,
  getSLAsByType,
  createSLATracking,
  completeSLATracking,
  completeActiveSLATracking,
  getActiveSLATracking,
  getSLABreaches,
  getSLAMetrics,
  getUpcomingBreaches,
  applySLAToStage,
  getSLAStatus,
  
  // Legacy functions (for backward compatibility)
  getSLADays,
  calcSLA,
  getSLAAlerts,
  getSLAAlertsBySKU
};
