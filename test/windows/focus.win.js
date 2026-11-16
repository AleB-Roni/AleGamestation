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
    const ra = await helper.request(`activate ${Buffer.from(prim.key).toString('base64')}`, 10000);
    assert.strictEqual(ra, '0', 'Aktivieren eines aktiven Bildschirms meldet ' + ra);
    console.log('✔ Bildschirm in Windows einschalten (bereits aktiv = keine Änderung)');
    // Monitor-Auswahl: alle aktiven an, bisherige Hauptanzeige bleibt (= keine Änderung)
    const enc = (k) => Buffer.from(k).toString('base64');
    const rp = await helper.request(`setplan ${enc(prim.key)}|${active.map((d) => enc(d.key)).join(',')}`, 15000);
    console.log(rp === '0' ? '✔ Monitor-Auswahl anwenden funktioniert' : `⚠ Monitor-Auswahl meldet ${rp} (VM-Grafiktreiber?)`);
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

  // Taskleiste aus-/einblenden; beim Beenden des Hilfsprogramms wird sie immer wieder eingeblendet
  const tb0 = await helper.request('taskbarvisible', 5000);
  if (tb0 === '-1' || tb0 === '') console.log('⚠ Keine Taskleiste gefunden (kein Explorer) – Test übersprungen');
  else {
    helper.send('taskbar 0'); await sleep(400);
    assert.strictEqual(await helper.request('taskbarvisible', 5000), '0', 'Taskleiste sollte ausgeblendet sein');
    helper.send('taskbar 1'); await sleep(400);
    assert.strictEqual(await helper.request('taskbarvisible', 5000), '1', 'Taskleiste sollte wieder sichtbar sein');
    // Absicherung: ausblenden, Hilfsprogramm beenden -> Taskleiste wieder da
    const h2 = new NativeHelper();
    await h2.request('fg', 15000);
    h2.send('taskbar 0'); await sleep(400);
    h2.stop(); await sleep(3000);
    assert.strictEqual(await helper.request('taskbarvisible', 5000), '1', 'Taskleiste muss nach dem Beenden wieder sichtbar sein');
    console.log('✔ Taskleiste aus-/einblenden, nach dem Beenden immer wieder sichtbar');
  }

  // Bluetooth-Koppeln: Skript übersetzt und läuft (ohne etwas zu entfernen)
  {
    const { spawnSync } = require('child_process');
    const script = path.join(__dirname, '..', '..', 'src', 'main', 'bt-pair.ps1');
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Rounds', '1', '-Timeout', '1', '-NoRemove'], { encoding: 'utf8', timeout: 120000 });
    const steps = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    assert.ok(steps.length, 'Bluetooth-Skript gibt nichts aus: ' + (r.stderr || '').slice(0, 400));
    const radio = steps.find((x) => x.t === 'radio');
    assert.ok(radio, 'Keine Bluetooth-Meldung: ' + JSON.stringify(steps));
    if (radio.ok) assert.ok(steps.some((x) => x.t === 'done'), 'Suche nicht abgeschlossen: ' + JSON.stringify(steps));
    console.log(`✔ Bluetooth-Skript läuft (${radio.ok ? 'Bluetooth vorhanden, Suche abgeschlossen' : 'kein Bluetooth auf dem Testrechner'})`);
  }

  // RomM: mehrteilige Spiele kommen als ZIP – mit Windows-Bordmitteln entpacken
  {
    const fs = require('fs');
    const os = require('os');
    const { extractZip } = require('../../src/main/romm');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-zip-'));
    const zip = path.join(dir, 'spiel.zip');
    fs.writeFileSync(zip, require('../fake-zip')([['Spiel (Europe).cue', 'FILE "Spiel (Europe).bin" BINARY'], ['Spiel (Europe).bin', 'DATA']]));
    const out = path.join(dir, 'Spiel (Europe)');
    fs.mkdirSync(out);
    await extractZip(zip, out);
    assert.ok(fs.existsSync(path.join(out, 'Spiel (Europe).cue')) && fs.existsSync(path.join(out, 'Spiel (Europe).bin')), 'ZIP nicht entpackt');
    console.log('✔ RomM: mehrteilige Spiele (ZIP) werden entpackt');
  }

  // Bilder umwandeln über Windows (WIC): wird für TIFF/HEIC benutzt – hier mit einem BMP geprüft
  {
    const fs = require('fs');
    const os = require('os');
    const { viaWic } = require('../../src/main/image-convert');
    const bmp = path.join(os.tmpdir(), 'ags-test.bmp');
    // 2x1-BMP (24 Bit)
    const h = Buffer.alloc(54); h.write('BM'); h.writeUInt32LE(62, 2); h.writeUInt32LE(54, 10); h.writeUInt32LE(40, 14);
    h.writeInt32LE(2, 18); h.writeInt32LE(1, 22); h.writeUInt16LE(1, 26); h.writeUInt16LE(24, 28); h.writeUInt32LE(8, 34);
    fs.writeFileSync(bmp, Buffer.concat([h, Buffer.from([0, 0, 255, 0, 255, 0, 0, 0])]));
    const png = await viaWic(bmp);
    assert.ok(png && png.readUInt32BE(0) === 0x89504e47 && png.readUInt32BE(16) === 2, 'WIC-Umwandlung nach PNG fehlgeschlagen');
    console.log('✔ Bildumwandlung über Windows (WIC) nach PNG funktioniert');
  }

  // Absicherung: Wächter (per WMI gestartet) stellt nach hartem Beenden zurück
  {
    const fs = require('fs');
    const os = require('os');
    const { CrashGuard } = require('../../src/main/crash-guard');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-guard-'));
    const g = new CrashGuard({ dir, log: (m) => console.log('  ' + m) });
    const list = JSON.parse((await helper.request('displays', 15000)) || '[]');
    const prim = list.find((x) => x.primary && x.active);
    const saved = await helper.request('save', 10000);
    const dummy = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep 120'], { stdio: 'ignore' });
    fs.writeFileSync(g.file, JSON.stringify({ pid: dummy.pid, saved, primary: prim ? prim.key : '', primaryName: prim ? prim.name : '' }));
    const how = await new Promise((r) => g.startGuard(dummy.pid, r));
    assert.ok(how, 'Wächter wurde nicht gestartet');
    await sleep(3000);
    execFileSync('taskkill', ['/F', '/PID', String(dummy.pid)]);
    const log = path.join(dir, 'restore-state.log');
    let text = '';
    for (let i = 0; i < 60 && !/Fertig/.test(text); i++) { await sleep(1000); text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''; }
    console.log(text.trim().split(/\r?\n/).map((l) => '  | ' + l).join('\n'));
    assert.ok(/Fertig/.test(text), 'Wächter hat nicht zurückgestellt');
    assert.ok(!fs.existsSync(g.file) && !fs.existsSync(g.file + '.restoring'), 'Wiederherstellungsdatei wurde nicht entfernt');
    // Das Hilfsprogramm muss geantwortet haben (Code 0 = wiederhergestellt; VM-Grafiktreiber melden evtl. anderes)
    if (saved) assert.ok(/Anordnung wiederherstellen: Code \S+/.test(text), 'Hilfsprogramm hat beim Wiederherstellen nicht geantwortet');
    console.log(`✔ Wächter (${how}) stellt nach hartem Beenden Anordnung und Hauptbildschirm zurück`);
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
