import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("active games use a real reloadable /games route and preserve link focus styling", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("./script.js", import.meta.url), "utf8");
  const css = await readFile(new URL("./style.css", import.meta.url), "utf8");

  assert.match(html, /id="active-games-link" href="\/games"/);
  assert.match(html, /id="active-games-page"[^>]*hidden/);
  assert.match(html, /id="active-games-empty"[^>]*hidden/);
  assert.match(html, /id="active-games-loading"[^>]*aria-hidden="true"(?![^>]*hidden)/);
  assert.match(html, /id="active-games-table-region"[^>]*hidden/);
  assert.match(html, /href="\/"[^>]*data-i18n="menu\.back"/);
  assert.match(script, /window\.location\.pathname === "\/games"/);
  assert.doesNotMatch(script, /activeGamesLink\.addEventListener|history\.pushState\(\{\}, "", "\/games"\)/);
  assert.match(css, /active-games-link, \.active-games-link:visited, \.active-games-link:hover, \.active-games-link:focus, \.active-games-link:active\s*\{\s*text-decoration:\s*none/);
  assert.match(html, /id="active-room-tooltip"[^>]*role="tooltip"/);
  assert.match(script, /buildActiveRoomView\(room, t\)/);
  assert.match(script, /fetch\("\/api\/rooms"/);
  assert.match(script, /mainMenuScreen\.hidden = show/);
  assert.match(script, /function showActiveGamesPage\(show\)[\s\S]*?syncMenuAmbient\(\);/);
  assert.match(script, /function syncMenuAmbient\(\)[\s\S]*?if \(menuAnimationFrame !== null\) return;/);
  assert.match(script, /function drawDuelScene\(time = 0\)[\s\S]*?if \(width <= 0 \|\| height <= 0\)\s*\{[\s\S]*?return;/);
  assert.match(script, /function resizeMenuAmbient\(\)[\s\S]*?if \(!menuCanvasContext \|\| mainMenuScreen\.hidden\) return;/);
  assert.match(script, /document\.addEventListener\("visibilitychange",[\s\S]*?if \(!document\.hidden\) syncMenuAmbient\(\)/);
  assert.match(css, /\.active-room-tooltip\[hidden\]/);
  assert.match(css, /\.active-games-row:hover > td/);
  assert.match(css, /\.active-games-row:focus-visible/);
});
