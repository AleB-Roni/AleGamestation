'use strict';
/**
 * Echter Windows-Test (läuft im Release-Ablauf auf windows-latest):
 * startet "Spiele" über den Launcher und prüft, dass das Beenden wirklich alle Prozesse beendet.
 *  A) Spiel-Exe direkt (Beenden: alle Prozesse aus dem Spielordner)
 *  B) Launcher, der das eigentliche Spiel als neuen Prozess startet und sich selbst beendet
 *     (wie manche Emulatoren/Launcher) – die App muss das Spiel weiter verfolgen und beenden können
 *  C) Windows-Ordner sind für das Ordner-Beenden gesperrt
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { Launcher, isSafeKillDir } = require('../../src/main/launcher');

if (process.platform !== 'win32') { console.log('Nur unter Windows – übersprungen'); process.exit(0); }

const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-wintest-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const running = (image) => execFileSync('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { encoding: 'utf8' }).toLowerCase().includes(image.toLowerCase());

function makeGame(name, files) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [target, source] of Object.entries(files)) fs.copyFileSync(path.join(sys32, source), path.join(dir, target));
  return dir;
}

(async () => {
  const launcher = new Launcher(() => ({ controller: { gracefulCloseMs: 500 }, systems: [], emulators: [] }), {});
  const events = [];
  launcher.on('exited', (e) => events.push(e.game.id));

  // A) Spiel direkt
  const dirA = makeGame('GameA', { 'ags-game-a.exe': 'PING.EXE' });
  await launcher.launch({ id: 'a', type: 'pc', name: 'Spiel A', exe: path.join(dirA, 'ags-game-a.exe'), args: '-n 600 127.0.0.1', killMode: 'dir' });
  await sleep(2500);
  assert.ok(launcher.isRunning(), 'A: läuft nach dem Start');
  assert.ok(running('ags-game-a.exe'), 'A: Prozess existiert');
  const t0 = Date.now();
  assert.strictEqual(await launcher.kill(), true, 'A: kill() meldet Erfolg');
  await sleep(500);
  assert.ok(!running('ags-game-a.exe'), 'A: Prozess ist beendet');
  assert.ok(!launcher.isRunning(), 'A: Launcher meldet kein laufendes Spiel');
  console.log(`✔ A: Spiel direkt gestartet und in ${Date.now() - t0} ms beendet`);

  // B) Launcher startet das Spiel als neuen Prozess und beendet sich selbst
  const dirB = makeGame('GameB', { 'ags-launcher.exe': 'cmd.exe', 'ags-game-b.exe': 'PING.EXE' });
  await launcher.launch({ id: 'b', type: 'pc', name: 'Spiel B', exe: path.join(dirB, 'ags-launcher.exe'), args: `/c start "" "${path.join(dirB, 'ags-game-b.exe')}" -n 600 127.0.0.1`, killMode: 'dir' });
  await sleep(6000);
  assert.ok(running('ags-game-b.exe'), 'B: eigentliches Spiel läuft');
  assert.ok(!running('ags-launcher.exe'), 'B: Start-Prozess hat sich beendet');
  assert.ok(launcher.isRunning(), 'B: App verfolgt das Spiel weiter, obwohl der Start-Prozess weg ist');
  assert.strictEqual(await launcher.kill(), true, 'B: kill() meldet Erfolg');
  await sleep(500);
  assert.ok(!running('ags-game-b.exe'), 'B: eigentliches Spiel ist beendet');
  console.log('✔ B: Spiel über einen Start-Prozess gestartet, weiter verfolgt und beendet');

  // B2) Spielende von selbst wird erkannt
  await launcher.launch({ id: 'c', type: 'pc', name: 'Spiel C', exe: path.join(dirA, 'ags-game-a.exe'), args: '-n 3 127.0.0.1', killMode: 'dir' });
  for (let i = 0; i < 30 && launcher.isRunning(); i++) await sleep(500);
  assert.ok(!launcher.isRunning(), 'C: Ende des Spiels wird erkannt');
  console.log('✔ C: Ende eines Spiels von selbst wird erkannt');

  // D) Windows-Ordner sind gesperrt
  assert.strictEqual(isSafeKillDir(sys32), false);
  assert.strictEqual(isSafeKillDir(process.env.SystemRoot || 'C:\\Windows'), false);
  assert.strictEqual(isSafeKillDir(dirA), true);
  console.log('✔ D: Windows-Ordner werden nie als Spielordner beendet');

  assert.deepStrictEqual(events, ['a', 'b', 'c'], 'Spielende-Ereignisse');
  console.log('Alle Windows-Tests bestanden');
  process.exit(0);
})().catch((err) => {
  console.error('✖ Windows-Test fehlgeschlagen:', err.message);
  try { execFileSync('taskkill', ['/IM', 'ags-game-a.exe', '/F']); } catch { /* ignore */ }
  try { execFileSync('taskkill', ['/IM', 'ags-game-b.exe', '/F']); } catch { /* ignore */ }
  process.exit(1);
});
