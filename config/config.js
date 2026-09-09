'use strict';

module.exports = {
  APP_NAME    : process.env.APP_NAME    || 'Return Management System',
  APP_VERSION : process.env.APP_VERSION || '1.0.0',
  APP_TIMEZONE: process.env.APP_TIMEZONE || 'Asia/Jakarta',

  RECORDS_PER_PAGE: parseInt(process.env.RECORDS_PER_PAGE) || 25,

  STATUS: {
    PENDING    : 'Pending',
    INSPECTING : 'Inspecting',
    APPROVED   : 'Approved',
    REJECTED   : 'Rejected',
    PROCESSING : 'Processing',
    COMPLETED  : 'Completed'
  },

  AGING: {
    NORMAL   : parseInt(process.env.AGING_NORMAL)   || 3,
    WARNING  : parseInt(process.env.AGING_WARNING)  || 7,
    CRITICAL : parseInt(process.env.AGING_CRITICAL) || 14
  },

  UPLOAD: {
    MAX_FILE_SIZE       : parseInt(process.env.MAX_FILE_SIZE) || 5242880,
    PATH                : process.env.UPLOAD_PATH || 'uploads/',
    ALLOWED_EXTENSIONS  : ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx']
  }
};
