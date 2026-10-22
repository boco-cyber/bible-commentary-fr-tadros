const fs = require('node:fs');
const zlib = require('node:zlib');
const readline = require('node:readline');

async function* readJsonlGz(file) {
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line);
  }
}

module.exports = { readJsonlGz };
