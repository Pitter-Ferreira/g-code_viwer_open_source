# G-code Viewer

**Português** · [English](README.en.md)

Visualizador, editor e gerador de G-code em **um único arquivo HTML**. Não precisa instalar nada nem ter internet: é só abrir no navegador.

Foi feito para rodar também em PCs antigos de CNC (ex.: Windows XP/7 com Mach3 e vídeo onboard sem WebGL2).

## Como usar

1. Baixe o arquivo [`g-code-viewer-v0.55.html`](g-code-viewer-v0.55.html) (botão **Download raw file** no GitHub) ou pegue na página de [Releases](../../releases).
2. Dê dois cliques para abrir no navegador.
3. Arraste um G-code (`.nc`, `.tap`, `.gcode`, `.ngc`…) para a janela, ou use **Abrir**.
4. Para gerar G-code a partir de um desenho, use a aba **Gerar G-code** e abra um `.dxf` ou `.svg`.

## Aba Visualizar

- **Desenho do percurso** em vista de topo ou 3D, com botão Enquadrar. Movimentos rápidos, de corte e arcos em cores diferentes, além de cores por camada ou por profundidade (Z).
- **Simulação** do percurso, passo a passo, sincronizada com a linha do código.
- **Árvore de arquivos** de uma pasta para organizar os G-codes e desenhos: busca, ordenar por nome ou data, lista plana, nova pasta, renomear, mover (arrastar), duplicar e excluir.
- **Editar profundidades (Z), velocidades (F) e rotação (S)** agrupadas por valor, com desfazer. Ao salvar, mantém a codificação do arquivo (UTF-8 ou Windows-1252), as quebras de linha e cria um backup `.bak`.
- **Ferramenta de medida** de um ponto A até um ponto B, com encaixe nos pontos do desenho.
- **Editor de código** sobre a área do desenho, com cores por eixo (X, Y, Z…).
- Painéis recolhíveis e tema claro/escuro.

## Aba Gerar G-code (novo na v0.55)

Transforma um desenho **DXF** ou **SVG** em G-code para fresadora/router CNC (Mach3):

- **Operações por camada** (ou por cor, no SVG): recorte por fora, recorte por dentro, rebaixo, furação, gravar na linha ou ignorar. No modo **Automático**, o contorno externo da peça é recortado por fora, os furos por dentro, linhas abertas são gravadas e pontos são furados. Camadas com nomes como `FURO`, `REBAIXO` ou `GRAVAR` já recebem a operação certa.
- **Mudar só uma linha**: clique nela no desenho e escolha outra operação.
- **Biblioteca de fresas**: diâmetro, rotação (S), avanço (F), mergulho, profundidade por passada e passo lateral do rebaixo. Fica salva no navegador e pode ser exportada/importada.
- **Compensação da fresa**: o centro da fresa anda a um raio do desenho (por fora ou por dentro), então a peça sai na medida.
- **Várias passadas** até a profundidade, atravessando a chapa um pouco (ajustável).
- **Pontes** (tabs) para a peça não soltar quando a chapa está presa com grampos ou parafusos.
- **Ordem de corte segura**: furos, gravações e rebaixos primeiro, depois os recortes internos e por último os contornos externos. As operações são agrupadas para trocar de fresa o menos possível.
- **Chapa e máquina**: tamanho e espessura da chapa, margem, Z zero no topo da chapa ou na mesa, altura segura, sentido de corte (concordante/convencional) e troca de fresa com `M6` ou pausa `M0`.
- O G-code abre direto na aba Visualizar para conferir e pode ser salvo na mesma pasta do desenho.

> **DWG**: é um formato fechado. Salve como **DXF** no seu programa de desenho (AutoCAD, QCAD, LibreCAD…) ou converta com o ODA File Converter (gratuito).
>
> **Próxima versão**: aproveitamento automático da chapa (nesting).

### G-code lido pelo Visualizador

G0–G3 (arcos por I/J/K ou R, planos G17/G18/G19, hélice), G20/G21 (pol/mm), G90/G91, G90.1/G91.1, G92, G28/G30, G53, ciclos G81–G89 (G98/G99) e extrusão (E, M82/M83) de impressoras 3D.

## Compatibilidade

| Recurso | Onde funciona |
| --- | --- |
| Ver, editar e gerar G-code | Navegadores a partir de Chrome 49 / Firefox 52 (código convertido para ES5) |
| Desenho acelerado (WebGL2) | Navegadores e placas de vídeo com WebGL2. Sem ele, usa o **modo compatível** (Canvas 2D) automaticamente |
| Salvar direto na pasta / organizar arquivos | Chrome ou Edge atuais (no Windows XP/7, o [Supermium](https://github.com/win32ss/supermium)). Nos outros, a árvore fica **só leitura** e o arquivo salvo vai para Downloads |

## Desenvolvimento

O arquivo final é gerado a partir do código-fonte:

```
src/g-code-viewer.html   visualizador (HTML, CSS e script principal)
src/cam-core.js          núcleo da aba Gerar G-code: DXF/SVG, peças e furos, caminhos da fresa, G-code
src/cam.js               tela da aba Gerar G-code
build.js                 converte para ES5, embute as bibliotecas e gera o HTML final
g-code-viewer-v0.55.html  arquivo final (gerado pelo build)
tests/                   testes automáticos (Playwright + Chromium)
licenses/                licenças das bibliotecas embutidas
```

Gerar o HTML final (precisa do [Node.js](https://nodejs.org/)):

```bash
npm install
```

```bash
npm run build
```

A versão vem do campo `version` do `package.json` (`0.55.0` → `v0.55`) e vai para o título da página e para o nome do arquivo gerado.

Rodar os testes (gera o build antes; as capturas de tela ficam em `tests/out/`):

```bash
npm install --no-save playwright
```

```bash
npx playwright install chromium
```

```bash
npm test
```

Para rodar só um teste: `node tests/run.js cam`.

## Licença

[MIT](LICENSE). Pode usar, copiar, modificar e distribuir à vontade.

O arquivo final inclui duas bibliotecas abertas, com as licenças delas: [Clipper](http://www.angusj.com) (Boost Software License, compensação da fresa) e [dxf-parser](https://github.com/gdsestimating/dxf-parser) (MIT, leitura de DXF). Veja [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
