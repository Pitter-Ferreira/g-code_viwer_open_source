# G-code Viewer

**Português** · [English](README.en.md)

Visualizador e editor de G-code em **um único arquivo HTML**. Não precisa instalar nada nem ter internet: é só abrir no navegador.

Foi feito para rodar também em PCs antigos de CNC (ex.: Windows XP/7 com Mach3 e vídeo onboard sem WebGL2).

## Como usar

1. Baixe o arquivo [`g-code-viewer-v0.5.html`](g-code-viewer-v0.5.html) (botão **Download raw file** no GitHub).
2. Dê dois cliques para abrir no navegador.
3. Arraste um G-code (`.nc`, `.tap`, `.gcode`, `.ngc`…) para a janela, ou use **Abrir → arquivo / pasta**.

## Recursos

- **Desenho do percurso** em vista de topo ou 3D, com botão Enquadrar. Movimentos rápidos, de corte e arcos em cores diferentes, além de cores por camada ou por profundidade (Z).
- **Simulação** do percurso, passo a passo, sincronizada com a linha do código.
- **Árvore de arquivos** de uma pasta para organizar os G-codes: busca, ordenar por nome ou data, lista plana, nova pasta, renomear, mover (arrastar), duplicar e excluir.
- **Editar profundidades (Z), velocidades (F) e rotação (S)** agrupadas por valor, com desfazer. Ao salvar, mantém a codificação do arquivo (UTF-8 ou Windows-1252), as quebras de linha e cria um backup `.bak`.
- **Ferramenta de medida** de um ponto A até um ponto B, com encaixe nos pontos do desenho.
- **Editor de código** sobre a área do desenho, com cores por eixo (X, Y, Z…).
- Painéis recolhíveis e tema claro/escuro.

### G-code suportado

G0–G3 (arcos por I/J/K ou R, planos G17/G18/G19, hélice), G20/G21 (pol/mm), G90/G91, G90.1/G91.1, G92, G28/G30, G53, ciclos G81–G89 (G98/G99) e extrusão (E, M82/M83) de impressoras 3D.

## Compatibilidade

| Recurso | Onde funciona |
| --- | --- |
| Ver e editar G-code | Navegadores a partir de Chrome 49 / Firefox 52 (código convertido para ES5) |
| Desenho acelerado (WebGL2) | Navegadores e placas de vídeo com WebGL2. Sem ele, usa o **modo compatível** (Canvas 2D) automaticamente |
| Salvar direto na pasta / organizar arquivos | Chrome ou Edge atuais (no Windows XP/7, o [Supermium](https://github.com/win32ss/supermium)). Nos outros, a árvore fica **só leitura** e o arquivo salvo vai para Downloads |

## Desenvolvimento

O arquivo final é gerado a partir do código-fonte:

```
src/g-code-viewer.html   código-fonte (JavaScript moderno) — edite aqui
build.js                 converte o JavaScript para ES5 e gera o HTML final
g-code-viewer-v0.5.html  arquivo final (gerado pelo build)
tests/                   testes automáticos (Playwright + Chromium)
```

Gerar o HTML final (precisa do [Node.js](https://nodejs.org/)):

```bash
npm install
```

```bash
npm run build
```

A versão vem do campo `version` do `package.json` (`0.5.0` → `v0.5`) e vai para o título da página e para o nome do arquivo gerado.

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

Para rodar só um teste: `node tests/run.js medida`.

## Licença

[MIT](LICENSE). Pode usar, copiar, modificar e distribuir à vontade.
