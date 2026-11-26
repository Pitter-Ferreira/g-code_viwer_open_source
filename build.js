// Gera o arquivo final g-code-viewer-v<versão>.html a partir de src/.
// - <script id="main">           : código do visualizador (src/g-code-viewer.html), convertido para ES5
// - <script data-src="x.js">     : arquivo src/x.js, convertido para ES5 e embutido
// - <script data-vendor="pacote"> : biblioteca de terceiros (node_modules), convertida para ES5,
//                                   compactada e embutida com o texto da licença
// O resultado é um único HTML que roda sem internet e em navegadores antigos
// (Chrome 49 / Firefox 52, ex.: PCs com Windows XP/7 usados em CNC com Mach3).
// Uso: npm run build            -> g-code-viewer-v<versão>.html na raiz
//      node build.js saida.html -> grava no caminho indicado
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const acorn = require('acorn');

const pkg = require('./package.json');
const version = pkg.version.replace(/\.0$/, ''); // 0.55.0 -> 0.55
const outFile = process.argv[2] || path.join(__dirname, 'g-code-viewer-v' + version + '.html');

// bibliotecas de terceiros embutidas no HTML (arquivo em node_modules + licenças em licenses/)
const VENDOR = {
  'clipper-lib/clipper.js': { name: 'Clipper 6.4.2 (JavaScript)', licenses: ['clipper-BSL-1.0.txt'] },
  'dxf-parser/dist/dxf-parser.js': { name: 'dxf-parser 1.1.2 (inclui loglevel)', licenses: ['dxf-parser-MIT.txt', 'loglevel-MIT.txt'] }
};

const PRESET = [['@babel/preset-env', { targets: { ie: '11', chrome: '49', firefox: '52' }, modules: false }]];
const ASSUMPTIONS = {
  iterableIsArray: true, noDocumentAll: true, setSpreadProperties: true, noNewArrows: true,
  mutableTemplateObject: true, ignoreToPrimitiveHint: true, skipForOfIteratorClosing: true,
  objectRestNoSymbols: true, pureGetters: true, setClassMethods: true, setComputedProperties: true,
  setPublicClassFields: true, superIsCallableConstructor: true, privateFieldsAsProperties: true,
  constantSuper: true, enumerableModuleMeta: true, noClassCalls: true,
  noIncompleteNsImportDetection: true, noUninitializedPrivateFieldAccess: true
};
// APIs que não existem em navegadores antigos (verificado no nosso código, não nas bibliotecas)
const BAD = ['Symbol', 'regeneratorRuntime', 'new Map', 'new Set', 'Math.hypot', 'Math.log10', 'Math.sign', 'Math.trunc',
  'Array.from', '.padStart', '.includes(', '.startsWith(', '.endsWith(', '.find(', '.findIndex(', '.closest(',
  '?.', 'async ', 'await ', '.dataset', 'Object.assign(', 'Number.isFinite', 'Number.isNaN', '.repeat('];

function toES5(code, compact) {
  return babel.transformSync(code, {
    babelrc: false, configFile: false, sourceType: 'script', comments: !compact, compact: !!compact, retainLines: false,
    presets: PRESET, assumptions: ASSUMPTIONS
  }).code;
}
function checkOwn(code, label) {
  // o auxiliar _typeof do Babel só usa Symbol se ele existir: não conta
  code = code.replace(/function _typeof\(o\) \{[\s\S]*?_typeof\(o\);\s*\}/, '');
  BAD.forEach(b => { if (code.indexOf(b) >= 0) console.log('AVISO (' + label + '): encontrado', JSON.stringify(b)); });
}
const safeScript = code => code.replace(/<\/script/gi, '<\\/script');

let src = fs.readFileSync(path.join(__dirname, 'src', 'g-code-viewer.html'), 'utf8').replace(/__VERSION__/g, version);

// 1) script principal
const reMain = /<script id="main">([\s\S]*?)<\/script>/;
const m = src.match(reMain);
if (!m) throw new Error('script principal (<script id="main">) não encontrado');
const mainCode = toES5(m[1], false);
checkOwn(mainCode, 'main');
src = src.replace(reMain, () => '<script id="main">\n' + mainCode + '\n</script>');

// 2) arquivos próprios em src/
src = src.replace(/<script data-src="([^"]+)"><\/script>/g, (all, file) => {
  const code = toES5(fs.readFileSync(path.join(__dirname, 'src', file), 'utf8').replace(/__VERSION__/g, version), false);
  checkOwn(code, file);
  return '<script id="' + file.replace(/\.js$/, '') + '">\n' + code + '\n</script>';
});

// 3) bibliotecas de terceiros
src = src.replace(/<script data-vendor="([^"]+)"><\/script>/g, (all, file) => {
  const v = VENDOR[file];
  if (!v) throw new Error('biblioteca sem licença registrada no build.js: ' + file);
  const code = toES5(fs.readFileSync(require.resolve(file), 'utf8'), true);
  const lic = v.licenses.map(l => fs.readFileSync(path.join(__dirname, 'licenses', l), 'utf8').trim()).join('\n\n---\n\n');
  return '<script>\n/*! ' + v.name + ' — incluída no G-code Viewer.\n\n' + lic.replace(/\*\//g, '* /') + '\n*/\n' + safeScript(code) + '\n</script>';
});

// valida: todo JavaScript da página precisa ser ES5 puro
const scripts = src.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
scripts.forEach(s => acorn.parse(s.replace(/^<script[^>]*>|<\/script>$/g, ''), { ecmaVersion: 5 }));

fs.writeFileSync(outFile, src);
console.log('ok:', path.relative(process.cwd(), outFile) || outFile, '-', scripts.length, 'scripts ES5 válidos,', Buffer.byteLength(src), 'bytes');
