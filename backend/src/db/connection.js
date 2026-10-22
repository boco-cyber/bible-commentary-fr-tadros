const Database = require('better-sqlite3');

function openDb(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

module.exports = { openDb };
