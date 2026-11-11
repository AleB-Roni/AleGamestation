'use strict';
/**
 * Debug-Modus: schreibt alles Wichtige in ein Protokoll, um Fehler zu finden.
 *  - Fehler und Konsolenausgaben aller Fenster (Oberfläche, Overlay, Einblendungen) und des Hauptprozesses
 *  - jede IPC-Anfrage der Oberfläche mit Dauer und Fehler, Anfragen an das Windows-Hilfsprogramm
 *  - Controller-/Tastatureingaben mit aktueller Ansicht, Meldungen (Toasts)
 * Ein „Debug-Bericht“ fasst Protokoll, Systeminfos und Einstellungen (ohne Passwörter/Tokens) in einer Datei zusammen.
 */
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;
const SECRET_KEY = /token|password|passwort|secret|apikey|api_key|devpassword|ssPassword|steamgriddbKey|refresh/i;

/** Passwörter, Tokens und Schlüssel unkenntlich machen */
function redact(value, depth = 0) {
  if (depth > 8 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) && v ? (typeof v === 'string' ? `*** (${v.length} Zeichen)` : '***') : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Kurze, einzeilige Darstellung von Daten fürs Protokoll */
function brief(data, max = 600) {
  if (data === undefined) return '';
  let s;
  try { s = typeof data === 'string' ? data : JSON.stringify(redact(data)); } catch { s = String(data); }
  s = String(s).replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) + ` … (+${s.length - max})` : s;
}

class DebugLog {
  /**
   * @param {{ dir: string, isEnabled: Function, onEvent?: Function }} opts
   *   onEvent({ level, count }) wird bei Fehlern/Warnungen aufgerufen (für die Anzeige in der Oberfläche)
   */
  constructor(opts) {
    this.dir = opts.dir;
    this.file = path.join(opts.dir, 'debug.log');
    this.isEnabled = opts.isEnabled;
    this.onEvent = opts.onEvent || (() => {});
    this.errors = 0;
    this.warnings = 0;
    this.started = false;
  }

  get enabled() {
    try { return !!this.isEnabled(); } catch { return false; }
  }

  /** Eine Zeile schreiben: Zeit, Stufe, Quelle, Text, Daten */
  write(level, source, message, data) {
    if (level === 'error') this.errors++;
    if (level === 'warn') this.warnings++;
    if (!this.enabled) return;
    if (!this.started) this._start();
    const t = new Date();
    const ts = t.toLocaleTimeString('de-DE', { hour12: false }) + '.' + String(t.getMilliseconds()).padStart(3, '0');
    const line = `${ts} ${level.toUpperCase().padEnd(5)} [${source}] ${String(message).replace(/\s+/g, ' ')}${data !== undefined ? ' · ' + brief(data) : ''}\n`;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      try { if (fs.statSync(this.file).size > MAX_BYTES) fs.renameSync(this.file, this.file.replace(/\.log$/, '.old.log')); } catch { /* neu */ }
      fs.appendFileSync(this.file, line);
    } catch { /* Protokoll darf die App nie stören */ }
    if (level === 'error' || level === 'warn') this.onEvent({ level, errors: this.errors, warnings: this.warnings, text: String(message) });
  }

  info(source, message, data) { this.write('info', source, message, data); }
  warn(source, message, data) { this.write('warn', source, message, data); }
  error(source, message, data) { this.write('error', source, message, data); }

  _start() {
    this.started = true;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.file, `\n===== Debug-Sitzung ${new Date().toLocaleString('de-DE')} =====\n`);
    } catch { /* ignore */ }
  }

  /** Fehler des Hauptprozesses und console.warn/error mitschreiben */
  hookProcess() {
    process.on('uncaughtException', (err) => this.error('main', 'Unbehandelter Fehler: ' + ((err && err.stack) || err)));
    process.on('unhandledRejection', (err) => this.error('main', 'Unbehandeltes Promise: ' + ((err && err.stack) || err)));
    for (const [fn, level] of [['warn', 'warn'], ['error', 'error']]) {
      const orig = console[fn].bind(console);
      console[fn] = (...args) => {
        orig(...args);
        this.write(level, 'main', args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : brief(a))).join(' '));
      };
    }
  }

  /** Konsole, Absturz und Ladefehler eines Fensters mitschreiben */
  attach(wc, nameFn) {
    const name = () => { try { return nameFn(wc) || 'fenster'; } catch { return 'fenster'; } };
    // Electron ≥ 35: alle Angaben stecken im Ereignis-Objekt
    wc.on('console-message', (e) => {
      const level = String(e.level || 'info');
      const message = String(e.message || '');
      if (level === 'debug' || (level === 'info' && !this.enabled)) return;
      const n = name();
      // Fehler der Oberfläche protokolliert sie selbst – mit Ansicht und Auswahl
      if (n === 'oberfläche' && level === 'error' && /^Uncaught/.test(message)) return;
      const where = e.sourceId ? ` (${path.basename(String(e.sourceId))}:${e.lineNumber || 0})` : '';
      this.write(level === 'warning' ? 'warn' : level === 'error' ? 'error' : 'info', n, message + where);
    });
    wc.on('render-process-gone', (_e, d) => this.error(name(), 'Fenster abgestürzt', d));
    wc.on('unresponsive', () => this.warn(name(), 'Fenster reagiert nicht'));
    wc.on('responsive', () => this.info(name(), 'Fenster reagiert wieder'));
    wc.on('did-fail-load', (_e, code, desc, url) => this.error(name(), `Laden fehlgeschlagen: ${desc} (${code})`, url));
    wc.on('preload-error', (_e, p, err) => this.error(name(), 'Preload-Fehler: ' + ((err && err.stack) || err)));
  }

  /** ipcMain.handle so erweitern, dass jede Anfrage mit Dauer/Fehler protokolliert wird */
  wrapIpc(ipcMain, quiet = new Set()) {
    const orig = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, handler) => orig(channel, async (event, ...args) => {
      const t0 = Date.now();
      try {
        const res = await handler(event, ...args);
        if (this.enabled && !quiet.has(channel)) {
          this.info('ipc', `${channel}${args.length ? ' ' + brief(args, 200) : ''} → ok (${Date.now() - t0} ms)`, channel.startsWith('config:') ? undefined : res);
        }
        return res;
      } catch (err) {
        this.error('ipc', `${channel}${args.length ? ' ' + brief(args, 200) : ''} → FEHLER (${Date.now() - t0} ms): ${(err && err.message) || err}`, err && err.stack ? err.stack.split('\n').slice(1, 4).join(' | ') : undefined);
        throw err;
      }
    });
  }

  /** Letzte Zeilen des Protokolls */
  tail(maxLines = 4000) {
    let text = '';
    try { text = fs.readFileSync(this.file.replace(/\.log$/, '.old.log'), 'utf8'); } catch { /* keine */ }
    try { text += fs.readFileSync(this.file, 'utf8'); } catch { /* keine */ }
    const lines = text.split('\n');
    return lines.slice(-maxLines).join('\n');
  }

  /** Debug-Bericht als Textdatei schreiben; liefert den Pfad */
  writeReport(targetDir, sections) {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const file = path.join(targetDir, `AleGamestation-Debugbericht-${stamp}.txt`);
    let out = `AleGamestation Debug-Bericht · ${d.toLocaleString('de-DE')}\nFehler: ${this.errors} · Warnungen: ${this.warnings}\n`;
    for (const [title, value] of sections) {
      out += `\n===== ${title} =====\n`;
      out += typeof value === 'string' ? value : JSON.stringify(redact(value), null, 2);
      out += '\n';
    }
    out += '\n===== Protokoll (letzte Zeilen) =====\n' + this.tail();
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(file, out, 'utf8');
    return file;
  }
}

module.exports = { DebugLog, redact, brief };
