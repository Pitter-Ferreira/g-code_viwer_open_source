// Roda todos os testes em sequência: node tests/run.js [nome ...]
// Ex.: node tests/run.js            -> todos
//      node tests/run.js medida     -> só tests/medida.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const all = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.js') && f !== 'run.js' && f !== 'common.js')
  .map(f => f.replace(/\.js$/, ''))
  .sort();
const pick = process.argv.slice(2);
const list = pick.length ? pick : all;

const failed = [];
for (const name of list) {
  console.log('\n=== ' + name);
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.js')], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  if (r.status !== 0) failed.push(name);
}
console.log('\n' + (list.length - failed.length) + '/' + list.length + ' testes ok' + (failed.length ? ' — falharam: ' + failed.join(', ') : ''));
console.log('Capturas de tela em tests/out/');
process.exit(failed.length ? 1 : 0);
