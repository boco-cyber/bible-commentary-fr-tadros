class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  if (status >= 500) {
    console.error(error.code || 'INTERNAL_ERROR', error.stack || error);
    return res.status(status).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  }
  res.status(status).json({
    error: { code: error.code || 'INTERNAL_ERROR', message: error.message },
  });
}

module.exports = { HttpError, notFoundHandler, errorHandler };
