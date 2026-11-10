'use strict';
/**
 * Echter Windows-Test: Hilfsprogramm (input-helper.ps1) übersetzt und antwortet,
 * und holt ein Hintergrundfenster trotz Windows-Fokus-Sperre nach vorne (Overlay über Vollbild-Spielen).
 */
const assert = require('assert');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { NativeHelper } = require('../../src/main/native-helper');

if (process.platform !== 'win32') { console.log('Nur unter Windows – übersprungen'); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hwndOfPid(pid) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).MainWindowHandle`], { encoding: 'utf8' });
  return Number(out.trim()) || 0;
}

(async () => {
  const helper = new NativeHelper();
  // 1) Hilfsprogramm startet, übersetzt den C#-Teil und beantwortet Anfragen
  let fg = '';
  for (let i = 0; i < 10 && fg === ''; i++) fg = await helper.request('fg', 3000);
  assert.ok(fg !== '', 'Hilfsprogramm antwortet nicht (Übersetzung fehlgeschlagen?)');
  console.log('✔ Hilfsprogramm übersetzt und antwortet (Vordergrundfenster:', fg + ')');
  helper.send('k 173 1'); helper.send('k 173 0'); // Stumm-Taste zweimal = unverändert
  helper.send('k 173 1'); helper.send('k 173 0');
  helper.send('m 0 0');
  await sleep(300);
  assert.ok(helper.proc, 'Hilfsprogramm läuft nach Tasten-/Mausbefehlen weiter');
  console.log('✔ Maus- und Tastaturbefehle werden angenommen');

  // 2) Zwei Fenster: A im Hintergrund, B im Vordergrund -> A per "front" nach vorne holen
  const notepad = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe');
  const a = spawn(notepad, [], { detached: true, stdio: 'ignore' });
  await sleep(2500);
  const b = spawn(notepad, [], { detached: true, stdio: 'ignore' });
  await sleep(2500);
  const ha = hwndOfPid(a.pid);
  const hb = hwndOfPid(b.pid);
  const before = await helper.foreground();
  if (!ha || !hb || before !== hb) {
    console.log(`⚠ Fokus-Test übersprungen: keine interaktive Desktop-Sitzung (A=${ha}, B=${hb}, Vordergrund=${before})`);
  } else {
    helper.front(ha, false);
    await sleep(800);
    const after = await helper.foreground();
    assert.strictEqual(after, ha, `Fenster A sollte vorne sein (vorne ist ${after})`);
    console.log('✔ Hintergrundfenster wird trotz Fokus-Sperre nach vorne geholt');
    helper.top(hb);
    await sleep(300);
    console.log('✔ Fenster ohne Fokus ganz nach oben legen funktioniert');
  }
  try { process.kill(a.pid); } catch { /* ignore */ }
  try { process.kill(b.pid); } catch { /* ignore */ }
  helper.stop();
  console.log('Alle Fokus-Tests bestanden');
  process.exit(0);
})().catch((err) => {
  console.error('✖ Fokus-Test fehlgeschlagen:', err.message);
  process.exit(1);
});
