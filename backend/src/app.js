const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
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
  const allowedOrigins = app.locals.options.corsOrigins === '*'
    ? '*'
    : app.locals.options.corsOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  const logRequests = app.locals.options.logRequests ?? process.env.NODE_ENV !== 'test';

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
      },
    },
  }));
  app.use(cors({ origin: allowedOrigins }));
  app.use(compression());
  if (logRequests) {
    app.use(morgan('combined'));
  }
  app.use(createRateLimiter(app.locals.options.rateLimitPerMin));

  app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
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
