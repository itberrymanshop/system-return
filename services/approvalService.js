'use strict';
const db = require('../config/database');

// ─── Approval Matrix ──────────────────────────────────────────────────────────

async function getApprovalMatrix() {
  const [rows] = await db.query(
    'SELECT * FROM approval_matrix ORDER BY approval_level ASC, min_value ASC'
  );
  return rows;
}

async function getApprovalRule(ruleId) {
  const [rows] = await db.query(
    'SELECT * FROM approval_matrix WHERE approval_id = ?', [ruleId]
  );
  return rows[0] || null;
}

async function createApprovalRule(data) {
  const [result] = await db.query(
    `INSERT INTO approval_matrix
       (rule_name, return_category, min_value, max_value, priority, required_role, approval_level, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.rule_name,
      data.return_category || null,
      parseFloat(data.min_value) || 0,
      data.max_value ? parseFloat(data.max_value) : null,
      data.priority || null,
      data.required_role,
      parseInt(data.approval_level) || 1,
      data.is_active ? 1 : 0
    ]
  );
  return result.insertId;
}

async function updateApprovalRule(ruleId, data) {
  await db.query(
    `UPDATE approval_matrix SET
       rule_name = ?, return_category = ?, min_value = ?, max_value = ?,
       priority = ?, required_role = ?, approval_level = ?, is_active = ?
     WHERE approval_id = ?`,
    [
      data.rule_name,
      data.return_category || null,
      parseFloat(data.min_value) || 0,
      data.max_value ? parseFloat(data.max_value) : null,
      data.priority || null,
      data.required_role,
      parseInt(data.approval_level) || 1,
      data.is_active ? 1 : 0,
      ruleId
    ]
  );
}

async function deleteApprovalRule(ruleId) {
  await db.query('DELETE FROM approval_matrix WHERE approval_id = ?', [ruleId]);
}

async function getApprovalRequirement(returnCategory, totalValue) {
  const [rows] = await db.query(
    `SELECT required_role, approval_level FROM approval_matrix
     WHERE is_active = 1
       AND (return_category = ? OR return_category IS NULL)
       AND min_value <= ?
       AND (max_value >= ? OR max_value IS NULL)
     ORDER BY approval_level DESC LIMIT 1`,
    [returnCategory, totalValue, totalValue]
  );
  return rows[0] || { required_role: 'inspector', approval_level: 1 };
}

// ─── Decision Tree ────────────────────────────────────────────────────────────

async function getDecisionTree() {
  const [rows] = await db.query(
    'SELECT * FROM decision_tree ORDER BY priority_order ASC'
  );
  return rows;
}

async function getDecisionRule(decisionId) {
  const [rows] = await db.query(
    'SELECT * FROM decision_tree WHERE decision_id = ?', [decisionId]
  );
  return rows[0] || null;
}

async function createDecisionRule(data) {
  const [result] = await db.query(
    `INSERT INTO decision_tree
       (rule_name, condition_type, condition_field, condition_operator,
        condition_value, action_type, action_value, priority_order, is_active, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.rule_name,
      data.condition_type || 'value',
      data.condition_field || '',
      data.condition_operator || '=',
      data.condition_value || '',
      data.action_type || '',
      data.action_value || '',
      parseInt(data.priority_order) || 0,
      data.is_active ? 1 : 0,
      data.description || null
    ]
  );
  return result.insertId;
}

async function updateDecisionRule(decisionId, data) {
  await db.query(
    `UPDATE decision_tree SET
       rule_name = ?, condition_type = ?, condition_field = ?,
       condition_operator = ?, condition_value = ?, action_type = ?,
       action_value = ?, priority_order = ?, is_active = ?, description = ?
     WHERE decision_id = ?`,
    [
      data.rule_name,
      data.condition_type || 'value',
      data.condition_field || '',
      data.condition_operator || '=',
      data.condition_value || '',
      data.action_type || '',
      data.action_value || '',
      parseInt(data.priority_order) || 0,
      data.is_active ? 1 : 0,
      data.description || null,
      decisionId
    ]
  );
}

async function deleteDecisionRule(decisionId) {
  await db.query('DELETE FROM decision_tree WHERE decision_id = ?', [decisionId]);
}

/**
 * Evaluate active decision-tree rules against a return payload.
 * Returns an array of matched actions.
 */
async function processDecisionTree(returnData) {
  const [rules] = await db.query(
    'SELECT * FROM decision_tree WHERE is_active = 1 ORDER BY priority_order ASC'
  );

  const actions = [];

  for (const rule of rules) {
    const { condition_field, condition_operator, condition_value, action_type, action_value } = rule;
    const fieldValue = returnData[condition_field];
    if (fieldValue === undefined) continue;

    let match = false;
    const numVal = parseFloat(condition_value);
    const numField = parseFloat(fieldValue);

    switch (condition_operator) {
      case '=':  match = fieldValue == condition_value; break;
      case '!=': match = fieldValue != condition_value; break;
      case '>':  match = numField > numVal; break;
      case '<':  match = numField < numVal; break;
      case '>=': match = numField >= numVal; break;
      case '<=': match = numField <= numVal; break;
      case 'IN': match = condition_value.split(',').map(v => v.trim()).includes(String(fieldValue)); break;
      case 'LIKE': match = String(fieldValue).toLowerCase().includes(condition_value.toLowerCase()); break;
    }

    if (match) {
      actions.push({ type: action_type, value: action_value, rule: rule.rule_name });
    }
  }

  return actions;
}

// ─── Pending Approvals ────────────────────────────────────────────────────────

async function getPendingApprovals(userRole) {
  let roleCondition = '';
  if (userRole === 'inspector') {
    roleCondition = `AND EXISTS (
      SELECT 1 FROM approval_matrix
      WHERE is_active = 1 AND required_role = 'inspector'
        AND (return_category = r.return_category OR return_category IS NULL)
        AND min_value <= r.total_value
        AND (max_value >= r.total_value OR max_value IS NULL))`;
  } else if (userRole === 'manager') {
    roleCondition = `AND EXISTS (
      SELECT 1 FROM approval_matrix
      WHERE is_active = 1 AND required_role IN ('inspector','manager')
        AND (return_category = r.return_category OR return_category IS NULL)
        AND min_value <= r.total_value
        AND (max_value >= r.total_value OR max_value IS NULL))`;
  }

  const [rows] = await db.query(`
    SELECT r.*,
           u.full_name AS pic_name,
           DATEDIFF(NOW(), r.return_date) AS aging_days
    FROM returns r
    LEFT JOIN users u ON r.pic_user_id = u.user_id
    WHERE r.current_status IN ('Pending','Inspecting')
      AND r.approver_user_id IS NULL
      ${roleCondition}
    ORDER BY r.return_date ASC
  `);
  return rows;
}

/**
 * Approve or reject a return.
 */
async function processApproval(returnId, action, userId, comments) {
  const newStatus = action === 'approve' ? 'Approved' : 'Rejected';

  const [cur] = await db.query(
    'SELECT current_status FROM returns WHERE return_id = ?', [returnId]
  );
  const fromStatus = cur[0]?.current_status || null;

  await db.query(
    `UPDATE returns SET
       current_status = ?, approver_user_id = ?, approved_date = NOW()
     WHERE return_id = ?`,
    [newStatus, userId, returnId]
  );

  await db.query(
    `INSERT INTO return_status_history
       (return_id, from_status, to_status, changed_by, change_reason, comments)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [returnId, fromStatus, newStatus, userId, `${action === 'approve' ? 'Approved' : 'Rejected'} by user`, comments || null]
  );

  return newStatus;
}

module.exports = {
  getApprovalMatrix,
  getApprovalRule,
  createApprovalRule,
  updateApprovalRule,
  deleteApprovalRule,
  getApprovalRequirement,
  getDecisionTree,
  getDecisionRule,
  createDecisionRule,
  updateDecisionRule,
  deleteDecisionRule,
  processDecisionTree,
  getPendingApprovals,
  processApproval
};
