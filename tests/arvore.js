const { launch, devices, serve, fx, out, PAGE, PAGE_PATH } = require('./common');
const fs = require('fs');
const files = {
  'Placas/teste.nc': fs.readFileSync(fx('pasta/Placas/teste.nc'), 'latin1'),
  'Clientes/latin1.nc': fs.readFileSync(fx('pasta/Clientes/latin1.nc'), 'latin1'),
  'Clientes/Joao/peca1.tap': fs.readFileSync(fx('pasta/Clientes/Joao/peca1.tap'), 'latin1'),
  'leia-me.doc': 'nota\n'
};
(async () => {
  const b = await launch();
  const srv = await serve(8765);
  for (const noMove of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    const answers = [];
    p.on('dialog', d => { const a = answers.length ? answers.shift() : (d.type()==='prompt' ? d.defaultValue() : undefined); console.log('   [' + d.type() + ']', d.message().split('\n')[0], '->', a); d.accept(a); });
    await p.goto('http://127.0.0.1:8765/visualizador-gcode.html');
    // monta uma pasta de teste no OPFS (mesma API de pasta real) e faz o seletor devolvê-la
    await p.evaluate(async ({ files, noMove }) => {
      const root = await navigator.storage.getDirectory();
      for await (const k of root.keys()) await root.removeEntry(k, { recursive: true });
      const top = await root.getDirectoryHandle('MeusGcodes', { create: true });
      for (const path in files) {
        const parts = path.split('/'); let d = top;
        for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i], { create: true });
        const h = await d.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await h.createWritable();
        const bytes = Uint8Array.from(files[path], c => c.charCodeAt(0));
        await w.write(bytes); await w.close();
      }
      if (noMove) { delete FileSystemHandle.prototype.move; FileSystemFileHandle.prototype.move = undefined; FileSystemDirectoryHandle.prototype.move = undefined; }
      window.showDirectoryPicker = async () => top;
      window.showSaveFilePicker = undefined;
    }, { files, noMove });
    const label = noMove ? '[sem move(): copiar+apagar]' : '[com move()]';
    await p.click('#btnOpen'); await p.click('#menuOpen button[data-o="folder"]'); await p.waitForTimeout(500);
    const tree = () => p.$$eval('#tree .tr', rs => rs.map(r => r.textContent.replace(/[▸▾]/g, '').trim()).join(' | '));
    console.log(label, 'raiz:', await p.$eval('#froot', e => e.textContent), '| árvore:', await tree());
    await p.click('#tree .tr.dir >> text=Clientes'); await p.click('#tree .tr.dir >> text=Placas'); await p.waitForTimeout(200);
    console.log('   expandida:', await tree());
    // abrir arquivo latin1, editar, salvar por cima (com backup)
    await p.click('#tree .tr.file >> text=latin1.nc'); await p.waitForTimeout(700);
    console.log('   aberto:', await p.$eval('#fileName', e => e.textContent), '| enc:', await p.evaluate(() => S.file.enc), '| comentário:', await p.evaluate(() => S.text.split('\n')[1]));
    await p.fill('#tabZ input[data-k="-1.0000"]', '-1.5'); await p.click('#btnApply'); await p.waitForTimeout(600);
    await p.click('#btnSave'); await p.waitForTimeout(800);
    const disk = await p.evaluate(async () => {
      const top = await (await navigator.storage.getDirectory()).getDirectoryHandle('MeusGcodes');
      const d = await top.getDirectoryHandle('Clientes');
      const rd = async n => { try { const f = await (await d.getFileHandle(n)).getFile(); const u = new Uint8Array(await f.arrayBuffer()); return Array.from(u).map(c => String.fromCharCode(c)).join(''); } catch (e) { return null; } };
      return { main: await rd('latin1.nc'), bak: await rd('latin1.nc.bak') };
    });
    console.log('   salvo no disco: Z-1.5?', disk.main.includes('Z-1.5'), '| ç em latin1 (byte E7)?', disk.main.includes('\xe7'), '| .bak tem original?', !!disk.bak && disk.bak.includes('Z-1 F300'), '| sujo:', await p.evaluate(() => isDirty()));
    // renomear o arquivo aberto (F2)
    answers.push('peca-final.nc');
    await p.click('#tree .tr.file >> text=latin1.nc', { button: 'right' }); await p.click('#ctx button[data-a="rename"]'); await p.waitForTimeout(900);
    console.log('   renomeado:', await tree(), '| arquivo aberto agora:', await p.evaluate(() => S.file.path));
    // criar pasta e mover arquivo para ela arrastando
    answers.push('Prontos');
    await p.click('#btnMkdir'); await p.waitForTimeout(800);
    await p.dragAndDrop('#tree .tr.file >> text=teste.nc', '#tree .tr.dir >> text=Prontos'); await p.waitForTimeout(900);
    await p.click('#tree .tr.dir >> text=Prontos'); await p.waitForTimeout(200);
    console.log('   após criar pasta e mover:', await p.evaluate(() => T.nodes.filter(n => /teste|Prontos|Placas/.test(n.name)).map(n => n.path).join(' , ')));
    // duplicar e excluir
    await p.click('#tree .tr.file >> text=peca1.tap', { button: 'right' }).catch(async () => { await p.click('#tree .tr.dir >> text=Joao'); await p.click('#tree .tr.file >> text=peca1.tap', { button: 'right' }); });
    await p.click('#ctx button[data-a="dup"]'); await p.waitForTimeout(900);
    console.log('   duplicado:', (await tree()).match(/peca1[^|]*/g));
    await p.click('#tree .tr.file >> text=peca1 (cópia).tap', { button: 'right' }); await p.click('#ctx button[data-a="del"]'); await p.waitForTimeout(900);
    console.log('   após excluir cópia:', (await tree()).match(/peca1[^|]*/g));
    // renomear pasta
    answers.push('Cliente Joao');
    await p.click('#tree .tr.dir >> text=Joao', { button: 'right' }); await p.click('#ctx button[data-a="rename"]'); await p.waitForTimeout(900);
    console.log('   renomear pasta:', await p.evaluate(() => T.nodes.filter(n => /Joao|peca1/.test(n.path)).map(n => n.path).join(' , ')), '| aviso:', await p.$eval('#toast', e => e.textContent));
    // mover pasta arrastando para dentro de Prontos
    await p.dragAndDrop('#tree .tr.dir >> text=Cliente Joao', '#tree .tr.dir >> text=Prontos'); await p.waitForTimeout(900);
    console.log('   mover pasta:', await p.evaluate(() => T.nodes.filter(n => /Joao|peca1/.test(n.path)).map(n => n.path).join(' , ')));
    // busca
    await p.fill('#treeQ', 'peca'); await p.waitForTimeout(200);
    console.log('   busca "peca":', await tree());
    await p.fill('#treeQ', '');
    await p.screenshot({ path: out(noMove ? 'tree-nomove.png' : 'tree.png') });
    console.log('  ', errs.join('\n') || 'sem erros');
    await p.close();
  }
  srv.close();
  await b.close();
})();
