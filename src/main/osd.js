'use strict';
/**
 * Kleine Einblendung oben am Bildschirm, die auch über anderen Programmen sichtbar ist
 * (z.B. "Maussteuerung aktiv", "Spiel wird beendet"). Nimmt keinen Fokus und keine Klicks an.
 */
const { BrowserWindow, screen } = require('electron');
const Icons = require('../renderer/icons.js');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif}
#b{display:flex;justify-content:center;padding-top:18px}
#t{display:inline-flex;align-items:center;gap:12px;padding:12px 22px;border-radius:999px;background:rgba(18,18,30,.92);color:#f3f3f8;
font-size:18px;border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 40px rgba(0,0,0,.5);opacity:0;transform:translateY(-10px);transition:all .25s ease}
#t.on{opacity:1;transform:none}#i{display:inline-flex;width:24px;height:24px;color:#c9b8ff}#i svg{width:24px;height:24px}small{color:#c9c9da;font-size:15px;display:inline-flex;align-items:center;gap:6px;margin-left:8px}
.k{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-size:13px;font-weight:800;margin-left:6px}
.k.xb.a{background:#3ddc84;color:#111}.k.xb.b{background:#ff5a6e;color:#111}.k.xb.y{background:#ffcc3d;color:#111}
.k.ps{background:#1d1d2b;border:1.5px solid rgba(255,255,255,.3)}.k.ps.a{color:#8fb4ff}.k.ps.b{color:#ff6f86}.k.ps.y{color:#4fe0b6}
</style></head><body><div id="b"><div id="t"><span id="i"></span><span id="m"></span></div></div>
<script>window.show=(icon,msg,sub)=>{i.innerHTML=icon||'';m.innerHTML=msg+(sub?' <small>'+sub+'</small>':'');t.classList.add('on')};window.hide=()=>t.classList.remove('on')</script>
</body></html>`;

class Osd {
  constructor() {
    this.win = null;
    this.timer = null;
    this.sticky = null;
  }

  _ensure() {
    if (this.win && !this.win.isDestroyed()) return Promise.resolve(this.win);
    this.win = new BrowserWindow({
      width: 900, height: 110, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, show: false, alwaysOnTop: true, hasShadow: false,
      webPreferences: { sandbox: true, contextIsolation: true }
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.setIgnoreMouseEvents(true);
    this.win.setVisibleOnAllWorkspaces(true);
    return this.win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML)).then(() => this.win);
  }

  _place() {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width } = d.workArea;
    this.win.setBounds({ x: Math.round(x + (width - 900) / 2), y, width: 900, height: 110 });
  }

  /** @param {number} ms 0 = bleibt stehen, bis hide() oder eine neue Meldung kommt */
  async show(icon, msg, sub = '', ms = 2500) {
    try {
      const win = await this._ensure();
      this._place();
      clearTimeout(this.timer);
      // Zeichen/Namen in das einheitliche Icon umwandeln
      const iconHtml = Icons.svg(icon) || '';
      await win.webContents.executeJavaScript(`show(${JSON.stringify(iconHtml)},${JSON.stringify(msg)},${JSON.stringify(sub)})`);
      win.showInactive();
      if (ms) this.timer = setTimeout(() => this.hide(), ms);
    } catch { /* Einblendung ist optional */ }
  }

  async hide() {
    clearTimeout(this.timer);
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.win.webContents.executeJavaScript('hide()');
      setTimeout(() => this.win && !this.win.isDestroyed() && this.win.hide(), 300);
    } catch { /* ignore */ }
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { Osd };
