'use strict';

const config = require('../config/config');

// Asia/Jakarta offset is UTC+7 hours
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Formats a Date object or string/number into YYYY-MM-DD HH:mm:ss in Asia/Jakarta timezone.
 */
function getJakartaDateTimeString(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (!d || isNaN(d.getTime())) return null;
  const localDate = new Date(d.getTime() + JAKARTA_OFFSET_MS);
  return localDate.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Formats a Date object or string/number into YYYY-MM-DD in Asia/Jakarta timezone.
 */
function getJakartaDateString(date = new Date()) {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (!d || isNaN(d.getTime())) return null;
  const localDate = new Date(d.getTime() + JAKARTA_OFFSET_MS);
  return localDate.toISOString().slice(0, 10);
}

/**
 * Returns the YYYY-MM-DD string for the first day of the current month in Asia/Jakarta.
 */
function getJakartaMonthStartString() {
  const localDate = new Date(Date.now() + JAKARTA_OFFSET_MS);
  const year = localDate.getUTCFullYear();
  const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Format date for display (e.g., 04 Jul 2026) using Asia/Jakarta timezone.
 */
function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: config.APP_TIMEZONE || 'Asia/Jakarta'
  });
}

/**
 * Format date and time for display (e.g., 04 Jul 2026, 11:01) using Asia/Jakarta timezone.
 */
function formatDateTime(dt) {
  if (!dt) return 'N/A';
  return new Date(dt).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: config.APP_TIMEZONE || 'Asia/Jakarta'
  });
}

/**
 * Formats a Date object or string/number into YYYY-MM-DD for use as input type="date" value.
 */
function formatDateInput(date) {
  if (!date) return '';
  return getJakartaDateString(date);
}

module.exports = {
  getJakartaDateTimeString,
  getJakartaDateString,
  getJakartaMonthStartString,
  formatDate,
  formatDateTime,
  formatDateInput
};
