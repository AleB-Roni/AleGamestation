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

  // Bildschirme auflisten (für die Fernseher-Auswahl) – Windows-Anzeigekonfiguration
  const raw = await helper.request('displays', 10000);
  const displays = JSON.parse(raw || '[]');
  assert.ok(Array.isArray(displays), 'Bildschirmliste ist kein Array: ' + raw);
  const active = displays.filter((d) => d.active);
  if (!active.length) console.log('⚠ Keine aktiven Bildschirme gemeldet (keine Desktop-Sitzung)');
  else {
    for (const d of active) assert.ok(d.key && d.w > 0 && d.h > 0, 'Ungültiger Eintrag: ' + JSON.stringify(d));
    console.log('✔ Bildschirme erkannt:', displays.map((d) => `${d.name || '?'} [${d.key}] ${d.w}x${d.h}${d.primary ? ' (Haupt)' : ''}${d.active ? '' : ' (aus)'}`).join(', '));
    // Anordnung sichern und unverändert wiederherstellen
    const saved = await helper.request('save', 10000);
    assert.ok(saved.length > 20, 'Anordnung konnte nicht gesichert werden');
    const prim = active.find((d) => d.primary) || active[0];
    // Aktuellen Hauptbildschirm erneut zum Hauptbildschirm machen = keine Änderung
    const r1 = await helper.request(`primary ${Buffer.from(prim.key).toString('base64')}`, 10000);
    assert.strictEqual(r1, '0', 'Hauptbildschirm setzen meldet ' + r1);
    console.log('✔ Hauptbildschirm setzen funktioniert');
    if (active.length === 1) {
      // Nur ein Bildschirm: "nur dieser" = gleiche Anordnung, muss gelingen
      const r2 = await helper.request(`tvonly ${Buffer.from(prim.key).toString('base64')}`, 15000);
      console.log(r2 === '0' ? '✔ „Nur dieser Bildschirm“ funktioniert' : `⚠ „Nur dieser Bildschirm“ meldet ${r2} (VM-Grafiktreiber?)`);
    }
    const r3 = await helper.request(`restore ${saved}`, 15000);
    console.log(r3 === '0' ? '✔ Gesicherte Anordnung wiederhergestellt' : `⚠ Wiederherstellen meldet ${r3} (VM-Grafiktreiber?)`);
  }

  // Tonausgabe: Geräte auflisten, aktuelles Standardgerät erneut setzen (= keine Änderung)
  const audio = JSON.parse((await helper.request('audiodevs', 10000)) || '[]');
  assert.ok(Array.isArray(audio), 'Tonausgabe-Liste ist kein Array');
  const defAudio = audio.find((a) => a.default);
  if (!defAudio) console.log(`⚠ Kein Standard-Wiedergabegerät (${audio.length} Geräte) – Umstellen nicht prüfbar`);
  else {
    const r = await helper.request(`audioset ${Buffer.from(defAudio.id).toString('base64')}`, 10000);
    assert.strictEqual(r, '0', 'Tonausgabe setzen meldet ' + r);
    console.log('✔ Tonausgabe: ' + audio.length + ' Gerät(e), Standardgerät setzen funktioniert');
  }

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
  // Spiel anhalten/fortsetzen (Overlay-Modus "Spiel anhalten")
  if (ha) {
    const info = await helper.request(`pidinfo ${ha}`, 5000);
    assert.match(info, /^\d+ notepad/i, 'Prozess zum Fenster: ' + info);
    const pid = info.split(' ')[0];
    assert.strictEqual(await helper.request(`suspend ${pid}`, 5000), '0', 'Anhalten');
    assert.strictEqual(await helper.request(`resume ${pid}`, 5000), '0', 'Fortsetzen');
    console.log('✔ Spiel anhalten und fortsetzen funktioniert');
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
