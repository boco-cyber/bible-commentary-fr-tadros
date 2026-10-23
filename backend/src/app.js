const express = require('express');
const config = require('./config');
const { apiRouter } = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errors');

function createApp(db, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.locals.db = db;
  app.locals.options = { ...config, ...options };

  app.get('/health', (req, res) => {
    const body = { status: 'ok', service: 'bible-commentary-fr-tadros' };
    if (db) {
      const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((row) => [row.key, row.value]));
      body.books = Number(meta.books);
      body.sections = Number(meta.sections);
      body.build = meta.built_at;
    }
    res.json(body);
  });

  app.use('/api/v1', apiRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
