// Utilidades compartilhadas pelos testes (Playwright + Chromium).
// Os testes abrem o HTML gerado pelo build, exercitam as funções e salvam capturas de tela em tests/out/.
// Qualquer erro de JavaScript na página faz o teste terminar com código de saída 1.
const path = require('path');
const http = require('http');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');

const pkg = require('../package.json');
const VERSION = pkg.version.replace(/\.0$/, '');
const PAGE_PATH = path.join(__dirname, '..', 'g-code-viewer-v' + VERSION + '.html');
const PAGE = pathToFileURL(PAGE_PATH).href;
const FIX = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'out');

if (!fs.existsSync(PAGE_PATH)) {
  console.error('Arquivo não encontrado: ' + PAGE_PATH + '\nRode "npm run build" antes dos testes.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const fx = p => path.join(FIX, p);   // arquivo de exemplo em tests/fixtures
const out = p => path.join(OUT, p);  // captura de tela em tests/out

function hook(page) {
  page.on('pageerror', e => { process.exitCode = 1; console.log('   ERRO NA PÁGINA:', e.message); });
}

// chromium.launch() que registra erros de página em todas as abas abertas
async function launch(opts) {
  const b = await chromium.launch(opts);
  const newPage = b.newPage.bind(b), newContext = b.newContext.bind(b);
  b.newPage = async o => { const p = await newPage(o); hook(p); return p; };
  b.newContext = async o => { const c = await newContext(o); c.on('page', hook); return c; };
  return b;
}

// servidor local (necessário para a File System Access API / OPFS, que não funciona em file://)
function serve(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(fs.readFileSync(PAGE_PATH));
    }).listen(port, '127.0.0.1', () => resolve(s));
  });
}

module.exports = { launch, devices, serve, fx, out, PAGE, PAGE_PATH, VERSION };
