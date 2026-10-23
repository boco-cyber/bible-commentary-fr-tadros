const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const { apiRouter } = require('./routes');
const { notFoundHandler, errorHandler } = require('./middleware/errors');
const { createRateLimiter } = require('./middleware/rate-limit');

const openapi = yaml.load(fs.readFileSync(path.join(__dirname, 'openapi.yaml'), 'utf8'));

function createApp(db, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('trust proxy', 1);
  app.locals.db = db;
  app.locals.options = { ...config, ...options };
  app.use(createRateLimiter(app.locals.options.rateLimitPerMin));

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

  app.get('/openapi.json', (req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  app.use('/api/v1', apiRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
