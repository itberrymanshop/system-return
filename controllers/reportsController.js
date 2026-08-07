'use strict';
const reportService = require('../services/reportService');
const dateHelper    = require('../utils/dateHelper');

// ─── Summary ──────────────────────────────────────────────────────────────────
exports.summary = async (req, res, next) => {
  try {
    const dateFrom = req.query.date_from || dateHelper.getJakartaMonthStartString();
    const dateTo   = req.query.date_to   || dateHelper.getJakartaDateString();

    const data = await reportService.getSummaryReport(dateFrom, dateTo);
    res.render('reports/summary', {
      title: 'Summary Report',
      ...data,
      dateFrom,
      dateTo,
      filters: { date_from: dateFrom, date_to: dateTo }
    });
  } catch (err) { next(err); }
};

// ─── Aging ────────────────────────────────────────────────────────────────────
exports.aging = async (req, res, next) => {
  try {
    const data = await reportService.getAgingReport(req.query);
    // console.log('Aging report data:', data); // Debug log
    res.render('reports/aging', {
      title: 'Aging Report',
      ...data,
      filters: req.query
    });
  } catch (err) { next(err); }
};

// ─── Value Impact ─────────────────────────────────────────────────────────────
exports.valueImpact = async (req, res, next) => {
  try {
    const dateFrom = req.query.date_from || dateHelper.getJakartaMonthStartString();
    const dateTo   = req.query.date_to   || dateHelper.getJakartaDateString();

    const data = await reportService.getValueImpactReport(dateFrom, dateTo);
    res.render('reports/value-impact', {
      title: 'Value Impact Report',
      ...data,
      dateFrom,
      dateTo
    });
  } catch (err) { next(err); }
};

// ─── Return Analysis ─────────────────────────────────────────────────────────
exports.analysis = async (req, res, next) => {
  try {
    const hasDateFilter = Object.prototype.hasOwnProperty.call(req.query, 'date_from')
      || Object.prototype.hasOwnProperty.call(req.query, 'date_to');

    let dateFrom = hasDateFilter ? (req.query.date_from || '') : dateHelper.getJakartaMonthStartString();
    let dateTo = hasDateFilter ? (req.query.date_to || '') : dateHelper.getJakartaDateString();

    if (dateFrom && dateTo && dateFrom > dateTo) {
      [dateFrom, dateTo] = [dateTo, dateFrom];
    }

    const data = await reportService.getReturnAnalysis(dateFrom, dateTo);
    res.render('reports/analysis', {
      title: 'Analisis Retur',
      ...data,
      dateFrom,
      dateTo,
      filters: { date_from: dateFrom, date_to: dateTo }
    });
  } catch (err) { next(err); }
};
