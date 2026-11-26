# G-code Viewer

[Português](README.md) · **English**

A G-code viewer, editor and generator in **a single HTML file**. Nothing to install and no internet needed: just open it in a browser.

It is built to run on old CNC PCs too (e.g. Windows XP/7 with Mach3 and onboard graphics without WebGL2).

> The interface is in Portuguese (Brazil).

## How to use

1. Download [`g-code-viewer-v0.6.html`](g-code-viewer-v0.6.html) (the **Download raw file** button on GitHub) or get it from the [Releases](../../releases) page.
2. Double-click it to open it in your browser.
3. Drag a G-code file (`.nc`, `.tap`, `.gcode`, `.ngc`…) into the window, or use **Abrir (Open)**.
4. To generate G-code from drawings, use the **Gerar G-code (Generate G-code)** tab and open one or more `.dxf` / `.svg` files.

## Viewer tab

- **Toolpath drawing** in top or 3D view, with a Fit button. Rapid moves, cutting moves and arcs in different colors, plus coloring by layer or by depth (Z).
- **Simulation** of the toolpath, step by step, synced with the current line of code.
- **File tree** of a folder to organize your G-codes and drawings: search, sort by name or date, flat list, new folder, rename, move (drag and drop), duplicate and delete.
- **Edit depths (Z), feed rates (F) and spindle speed (S)** grouped by value, with undo. Saving keeps the file's encoding (UTF-8 or Windows-1252) and line endings, and creates a `.bak` backup.
- **Measure tool** from point A to point B, snapping to points of the drawing.
- **Code editor** over the drawing area, with colors per axis (X, Y, Z…).
- Collapsible panels and light/dark theme.

## Generate G-code tab (since v0.55, nesting in v0.6)

Turns **DXF** or **SVG** drawings into G-code for a CNC mill/router (Mach3):

- **Parts list** in the left sidebar: open several drawings at once (or click them in the folder tree). Each part is shown with a thumbnail, its size and a **quantity**. **Keep the drawing together** nests the whole drawing as a single part (signs, lettering).
- **Automatic sheet nesting**: parts are nested by their true shape (not just their bounding box), with the spacing you choose, rotating 90°/180°/270° when it helps (or only 180°, or no rotation for grained material). Whatever doesn't fit goes to **Sheet 2, 3…**, each with its own G-code. **Improve nesting** tries other orders for a few seconds and keeps the best. It uses the same method as [SVGnest](https://github.com/Jack000/SVGnest) and [Deepnest](https://github.com/deepnest-next/deepnest) (no-fit polygon via Clipper's Minkowski sum).
- **Operations per layer** (or per color, in SVG): outside profile, inside profile, pocket, drilling, engrave on the line or ignore. In **Automatic** mode, the outer contour of each part is cut on the outside, holes on the inside, open lines are engraved and points are drilled. Layers named like `FURO` (drill), `REBAIXO` (pocket) or `GRAVAR` (engrave) get the right operation automatically.
- **Change a single line**: click it in the drawing and pick another operation (applies to every copy of the part). A frame around the drawing set to **Ignore** doesn't get in the way: the parts inside it are still cut on the outside.
- **Tool library**: diameter, spindle speed (S), feed (F), plunge feed, depth per pass and pocket stepover. Saved in the browser, with export/import.
- **Cutter compensation**: the tool center runs one radius away from the drawing (outside or inside), so parts come out to size.
- **Multiple passes** down to the final depth, cutting slightly below the sheet (adjustable).
- **Tabs** so parts don't come loose when the sheet is held by clamps or screws.
- **Safe cut order**: holes, engravings and pockets first, then inside profiles and finally outside profiles. Operations are grouped to change tools as little as possible.
- **Sheet and machine**: sheet size and thickness, margin, Z zero on top of the sheet or on the table, safe height, climb/conventional cutting and tool change with `M6` or an `M0` pause.
- The G-code opens straight in the Viewer tab for checking and can be saved in the same folder as the drawing (**Save all sheets** writes one file per sheet).

> **DWG**: it is a closed format. Save it as **DXF** in your CAD program (AutoCAD, QCAD, LibreCAD…) or convert it with the free ODA File Converter.

### G-code read by the Viewer

G0–G3 (arcs by I/J/K or R, G17/G18/G19 planes, helix), G20/G21 (in/mm), G90/G91, G90.1/G91.1, G92, G28/G30, G53, G81–G89 canned cycles (G98/G99) and 3D printer extrusion (E, M82/M83).

## Compatibility

| Feature | Where it works |
| --- | --- |
| View, edit and generate G-code | Browsers from Chrome 49 / Firefox 52 (code compiled to ES5) |
| Accelerated drawing (WebGL2) | Browsers and graphics cards with WebGL2. Without it, the **compatible mode** (Canvas 2D) is used automatically |
| Save directly to the folder / organize files | Current Chrome or Edge (on Windows XP/7, [Supermium](https://github.com/win32ss/supermium)). In other browsers the tree is **read-only** and saved files go to Downloads |

## Development

The final file is generated from the source code:

```
src/g-code-viewer.html   viewer (HTML, CSS and main script)
src/cam-core.js          Generate G-code core: DXF/SVG, parts and holes, toolpaths, G-code
src/cam-nest.js          sheet nesting
src/cam.js               Generate G-code tab user interface
build.js                 compiles to ES5, embeds the libraries and generates the final HTML
g-code-viewer-v0.6.html   final file (generated by the build)
tests/                   automated tests (Playwright + Chromium)
licenses/                licenses of the embedded libraries
```

Generate the final HTML (requires [Node.js](https://nodejs.org/)):

```bash
npm install
```

```bash
npm run build
```

The version comes from the `version` field in `package.json` (`0.6.0` → `v0.6`) and goes into the page title and the name of the generated file.

Run the tests (builds first; screenshots are saved in `tests/out/`):

```bash
npm install --no-save playwright
```

```bash
npx playwright install chromium
```

```bash
npm test
```

To run a single test: `node tests/run.js cam`.

## License

[MIT](LICENSE). Free to use, copy, modify and distribute.

The final file embeds two open-source libraries, under their own licenses: [Clipper](http://www.angusj.com) (Boost Software License, cutter compensation) and [dxf-parser](https://github.com/gdsestimating/dxf-parser) (MIT, DXF reading). See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
