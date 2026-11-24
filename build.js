// Gera o arquivo final g-code-viewer-v<versão>.html a partir de src/g-code-viewer.html.
// O JavaScript é convertido para ES5 (Babel) para rodar em navegadores antigos
// (Chrome 49 / Firefox 52 / IE11, ex.: PCs com Windows XP/7 usados em CNC com Mach3).
// Uso: npm run build            -> g-code-viewer-v<versão>.html na raiz
//      node build.js saida.html -> grava no caminho indicado
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const acorn = require('acorn');

const pkg = require('./package.json');
const version = pkg.version.replace(/\.0$/, ''); // 0.5.0 -> 0.5
const outFile = process.argv[2] || path.join(__dirname, 'g-code-viewer-v' + version + '.html');

const src = fs.readFileSync(path.join(__dirname, 'src', 'g-code-viewer.html'), 'utf8').replace(/__VERSION__/g, version);
const re = /<script id="main">([\s\S]*?)<\/script>/;
const m = src.match(re);
if (!m) throw new Error('script principal (<script id="main">) não encontrado');

const out = babel.transformSync(m[1], {
  babelrc: false, configFile: false, sourceType: 'script', comments: true, retainLines: false,
  presets: [['@babel/preset-env', { targets: { ie: '11', chrome: '49', firefox: '52' }, modules: false }]],
  assumptions: {
    iterableIsArray: true, noDocumentAll: true, setSpreadProperties: true, noNewArrows: true,
    mutableTemplateObject: true, ignoreToPrimitiveHint: true, skipForOfIteratorClosing: true,
    objectRestNoSymbols: true, pureGetters: true, setClassMethods: true, setComputedProperties: true,
    setPublicClassFields: true, superIsCallableConstructor: true, privateFieldsAsProperties: true,
    constantSuper: true, enumerableModuleMeta: true, noClassCalls: true,
    noIncompleteNsImportDetection: true, noUninitializedPrivateFieldAccess: true
  }
});

const html = src.replace(re, () => '<script id="main">\n' + out.code + '\n</script>');

// valida: todo JavaScript da página precisa ser ES5 puro
const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
scripts.forEach(s => acorn.parse(s.replace(/^<script[^>]*>|<\/script>$/g, ''), { ecmaVersion: 5 }));

// procura APIs que não existem em navegadores antigos
const bad = ['Symbol', 'regeneratorRuntime', 'new Map', 'new Set', 'Math.hypot', 'Math.log10', 'Array.from',
  '.padStart', '.includes(', '.closest(', '?.', 'async ', 'await ', '.dataset', 'Object.assign('];
bad.forEach(b => { if (out.code.indexOf(b) >= 0) console.log('AVISO: encontrado', JSON.stringify(b)); });

fs.writeFileSync(outFile, html);
console.log('ok:', path.relative(process.cwd(), outFile) || outFile, '-', scripts.length, 'scripts ES5 válidos,', html.length, 'bytes');
