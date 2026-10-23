const config = require('./config');
const { openDb } = require('./db/connection');
const { createApp } = require('./app');

const db = openDb(config.dbPath);
const app = createApp(db);
const server = app.listen(config.port, () => console.log(`commentary API listening on ${config.port}`));

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => { db.close(); process.exit(0); });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
