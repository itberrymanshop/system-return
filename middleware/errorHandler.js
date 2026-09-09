'use strict';

/**
 * 404 handler – must be placed after all routes.
 */
function notFoundHandler(req, res) {
  res.status(404).render('errors/404', {
    title: 'Page Not Found',
    layout: 'layouts/main'
  });
}

/**
 * Central error handler.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err.stack || err.message);

  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : err.message;

  if (req.accepts('html')) {
    return res.status(status).render('errors/500', {
      title: 'Server Error',
      message,
      layout: 'layouts/main'
    });
  }

  res.status(status).json({ error: message });
}

module.exports = { notFoundHandler, errorHandler };
