const express = require('express');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'bible-commentary-fr-tadros' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  return app;
}

module.exports = { createApp };
