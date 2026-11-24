const { launch, devices, serve, fx, out, PAGE, PAGE_PATH } = require('./common');
(async () => {
  const b = await launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  for (const compat of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    await p.goto(PAGE + (compat ? '?compat=1' : ''));
    await p.evaluate(() => loadSample('cnc')); await p.waitForTimeout(700);
    await p.click('#views button[data-v="top"]'); await p.waitForTimeout(500);
    await p.click('#btnMeasure');
    const scr = pt => p.evaluate(pt => { const B = camBasis(S.cam); const q = project(pt, B.r, B.u); const rc = vp.getBoundingClientRect(); return [q[0] + rc.left, q[1] + rc.top]; }, pt);
    const A = await scr([0, 10, -1]), B = await scr([100, 10, -1]);
    // clica 3px fora do ponto para testar o "encaixe"
    await p.mouse.move(A[0] + 3, A[1] - 2); await p.mouse.down(); await p.mouse.up();
    await p.mouse.move(B[0] - 2, B[1] + 3); await p.waitForTimeout(100);
    await p.screenshot({ path: out(`meas-rubber-${compat}.png`) });
    await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(200);
    console.log(compat ? '[compatível]' : '[WebGL2]', 'medida:', (await p.$eval('#mbox', e => e.innerText)).replace(/\n/g, ' | '));
    // ponto no meio de uma linha (encaixe na aresta) em 3D
    await p.click('#views button[data-v="iso"]'); await p.waitForTimeout(500);
    const C = await scr([50, 0, -1]), D = await scr([50, 70, -1]);
    await p.mouse.click(C[0] + 1, C[1] + 1); await p.mouse.click(D[0], D[1] - 1); await p.waitForTimeout(200);
    console.log('   3D aresta:', (await p.$eval('#mbox .big', e => e.textContent)), '| arrastar gira?', await p.evaluate(() => S.cam.yaw.toFixed(3)));
    await p.mouse.move(700, 450); await p.mouse.down(); await p.mouse.move(760, 470, { steps: 6 }); await p.mouse.up();
    console.log('   depois de arrastar: yaw', await p.evaluate(() => S.cam.yaw.toFixed(3)), '| medida mantida:', await p.$eval('#mbox .big', e => e.textContent));
    await p.screenshot({ path: out(`meas-${compat}.png`) });
    await p.keyboard.press('Escape'); console.log('   Esc 1 limpa:', await p.evaluate(() => MS.a === null && MS.on));
    await p.keyboard.press('Escape'); console.log('   Esc 2 sai:', await p.evaluate(() => !MS.on));
    // painéis recolhíveis + persistência
    await p.click('#viewPanel h3'); await p.click('#infoPanel h3');
    console.log('   recolhidos:', await p.evaluate(() => [...document.querySelectorAll('.side .panel.collapsed')].map(e => e.id).join(',')));
    await p.reload(); await p.waitForTimeout(300);
    console.log('   após recarregar:', await p.evaluate(() => [...document.querySelectorAll('.side .panel.collapsed')].map(e => e.id).join(',')));
    await p.evaluate(() => loadSample('3d')); await p.waitForTimeout(700);
    await p.screenshot({ path: out(`collapsed-${compat}.png`) });
    await p.click('#viewPanel h3'); await p.click('#infoPanel h3');
    console.log('  ', errs.join('\n') || 'sem erros');
    await p.close();
  }
  await b.close();
})();
