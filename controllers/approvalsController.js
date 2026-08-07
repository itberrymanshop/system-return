'use strict';
const approvalService = require('../services/approvalService');
const reportService   = require('../services/reportService');

// ─── Pending Approvals ────────────────────────────────────────────────────────
exports.pending = async (req, res, next) => {
  try {
    const returns = await approvalService.getPendingApprovals(req.session.userRole);
    res.render('approvals/pending', { title: 'Pending Approvals', returns });
  } catch (err) { next(err); }
};

exports.processApproval = async (req, res, next) => {
  try {
    const returnId = parseInt(req.params.id);
    const { action, comments } = req.body;
    const newStatus = await approvalService.processApproval(
      returnId, action, req.session.userId, comments
    );
    await reportService.logActivity(
      req.session.userId, 'approval',
      `Return #${returnId} ${newStatus} by ${req.session.fullName}`,
      req.ip, req.headers['user-agent']
    );
    req.flash('success', `Return ${newStatus.toLowerCase()} successfully.`);
    res.redirect('/approvals/pending');
  } catch (err) { next(err); }
};

// ─── Approval Matrix ──────────────────────────────────────────────────────────
exports.matrix = async (req, res, next) => {
  try {
    const rules = await approvalService.getApprovalMatrix();
    res.render('approvals/matrix', { title: 'Approval Matrix', rules });
  } catch (err) { next(err); }
};

exports.createRule = async (req, res, next) => {
  try {
    await approvalService.createApprovalRule(req.body);
    req.flash('success', 'Approval rule created.');
    res.redirect('/approvals/matrix');
  } catch (err) { next(err); }
};

exports.updateRule = async (req, res, next) => {
  try {
    await approvalService.updateApprovalRule(parseInt(req.params.id), req.body);
    req.flash('success', 'Approval rule updated.');
    res.redirect('/approvals/matrix');
  } catch (err) { next(err); }
};

exports.deleteRule = async (req, res, next) => {
  try {
    await approvalService.deleteApprovalRule(parseInt(req.params.id));
    req.flash('success', 'Approval rule deleted.');
    res.redirect('/approvals/matrix');
  } catch (err) { next(err); }
};

// ─── Decision Tree ────────────────────────────────────────────────────────────
exports.decisionTree = async (req, res, next) => {
  try {
    const rules = await approvalService.getDecisionTree();
    res.render('approvals/decision-tree', { title: 'Decision Tree', rules });
  } catch (err) { next(err); }
};

exports.createDecisionRule = async (req, res, next) => {
  try {
    await approvalService.createDecisionRule(req.body);
    req.flash('success', 'Decision rule created.');
    res.redirect('/approvals/decision-tree');
  } catch (err) { next(err); }
};

exports.updateDecisionRule = async (req, res, next) => {
  try {
    await approvalService.updateDecisionRule(parseInt(req.params.id), req.body);
    req.flash('success', 'Decision rule updated.');
    res.redirect('/approvals/decision-tree');
  } catch (err) { next(err); }
};

exports.deleteDecisionRule = async (req, res, next) => {
  try {
    await approvalService.deleteDecisionRule(parseInt(req.params.id));
    req.flash('success', 'Decision rule deleted.');
    res.redirect('/approvals/decision-tree');
  } catch (err) { next(err); }
};
