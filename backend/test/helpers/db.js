const path = require('node:path');
const { openDb } = require('../../src/db/connection');

function openTestDb() {
  return openDb(process.env.TEST_DB || path.join(__dirname, '..', '.tmp', 'commentary.sqlite'));
}

module.exports = { openTestDb };
