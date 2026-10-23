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
  const code = error.code || 'INTERNAL_ERROR';
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: { code, message: status >= 500 ? 'Internal server error' : error.message },
  });
}

module.exports = { HttpError, notFoundHandler, errorHandler };
