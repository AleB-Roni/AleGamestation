'use strict';
/**
 * Home Assistant: Fernseher beim Start einschalten und auf den richtigen HDMI-Eingang schalten,
 * beim Beenden / Herunterfahren optional ausschalten. Zusätzlich eigene Dienste (Szenen, Skripte, Licht …).
 * Zugriff über die REST-API mit einem "langlebigen Zugangstoken" (HA-Profil → Sicherheit).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HomeAssistant {
  /** @param {{ fetch: Function, getConfig: Function, log?: Function, trace?: Function }} opts
   *  log = Hinweis für den Nutzer, trace = Debug-Protokoll */
  constructor(opts) {
    this.fetch = opts.fetch || globalThis.fetch;
    this.getConfig = opts.getConfig;
    this.log = opts.log || (() => {});
    this.trace = opts.trace || (() => {});
  }

  cfg() {
    return this.getConfig().homeassistant || {};
  }

  ready() {
    const c = this.cfg();
    return !!(c.enabled && c.url && c.token);
  }

  async _req(method, apiPath, body) {
    const c = this.cfg();
    const base = String(c.url || '').replace(/\/+$/, '');
    if (!base || !c.token) throw new Error('Home Assistant: Adresse oder Token fehlt');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await this.fetch(base + apiPath, {
        method,
        headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (err) {
      throw new Error(`Home Assistant nicht erreichbar (${base}): ${err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) throw new Error('Home Assistant: Token ungültig');
    if (!res.ok) throw new Error(`Home Assistant: Fehler ${res.status} bei ${apiPath}`);
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }

  /** Verbindung prüfen + Mediaplayer auflisten */
  async test() {
    const info = await this._req('GET', '/api/');
    const states = await this._req('GET', '/api/states');
    const players = (states || []).filter((s) => s.entity_id.startsWith('media_player.') || s.entity_id.startsWith('remote.'))
      .map((s) => ({ id: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || s.entity_id, state: s.state, sources: (s.attributes && s.attributes.source_list) || [] }));
    const scripts = (states || []).filter((s) => /^(script|scene|automation|switch|light|input_boolean|button)\./.test(s.entity_id))
      .map((s) => ({ id: s.entity_id, name: (s.attributes && s.attributes.friendly_name) || s.entity_id }));
    return { message: (info && info.message) || 'OK', players, scripts };
  }

  state(entityId) {
    return this._req('GET', '/api/states/' + encodeURIComponent(entityId));
  }

  call(domain, service, data = {}) {
    return this._req('POST', `/api/services/${domain}/${service}`, data);
  }

  /** "script.gaming" -> script.turn_on, "scene.x" -> scene.turn_on, "light.x" -> light.turn_on; "domain.service:entity" für beliebige Dienste */
  async runEntry(entry) {
    const s = String(entry || '').trim();
    if (!s) return;
    const m = s.match(/^([a-z_]+)\.([a-z0-9_]+):(.+)$/i);
    if (m) return this.call(m[1], m[2], { entity_id: m[3].trim() });
    const domain = s.split('.')[0];
    return this.call(domain, 'turn_on', { entity_id: s });
  }

  /** Gerät einschalten – passend zum Typ (Skript/Szene starten, Automation auslösen, Taste drücken, sonst turn_on) */
  powerOn(entityId) {
    const domain = entityId.split('.')[0];
    if (domain === 'automation') return this.call('automation', 'trigger', { entity_id: entityId });
    if (domain === 'button' || domain === 'input_button') return this.call(domain, 'press', { entity_id: entityId });
    return this.call(domain, 'turn_on', { entity_id: entityId });
  }

  powerOff(entityId) {
    const domain = entityId.split('.')[0];
    if (['automation', 'button', 'input_button', 'scene'].includes(domain)) return this.powerOn(entityId); // auslösen = ausschalten
    return this.call(domain, 'turn_off', { entity_id: entityId });
  }

  /**
   * Fernseher einschalten, warten bis er an ist, dann Eingang (HDMI) wählen.
   * Einschalten optional über ein anderes Gerät (z.B. Chromecast weckt den TV per HDMI-CEC) –
   * der Eingang wird danach am Fernseher selbst gewählt und geprüft, ob er dort bleibt.
   */
  async tvOn() {
    const c = this.cfg();
    const id = c.tvEntity;
    if (!id) return { skipped: true };
    const domain = id.split('.')[0];
    const via = String(c.powerOnEntity || '').trim();
    let st = await this.state(id).catch(() => null);
    const isOn = (x) => x && !['off', 'unavailable', 'unknown', 'standby'].includes(x.state);
    let poweredNow = false;
    this.trace(`Fernseher ${id}: Zustand ${st ? st.state : 'unbekannt'}, Eingang ${(st && st.attributes && st.attributes.source) || '–'}`);
    if (!isOn(st)) {
      poweredNow = true;
      this.trace(`Einschalten über ${via || id}`);
      await this.powerOn(via || id);
      const until = Date.now() + (c.waitForTvSeconds || 20) * 1000;
      while (Date.now() < until) {
        await sleep(1000);
        st = await this.state(id).catch(() => null);
        if (isOn(st)) break;
      }
      this.trace(`Fernseher nach dem Einschalten: ${st ? st.state : 'unbekannt'}`);
      if (!isOn(st)) this.log('Fernseher meldet sich nicht als eingeschaltet – versuche trotzdem den Eingang zu wechseln');
    }
    if (c.source && domain === 'media_player') {
      // Nach dem Einschalten braucht der TV einen Moment; ein Chromecast schaltet per CEC erst auf seinen eigenen Eingang
      const delay = c.sourceDelaySeconds != null ? Number(c.sourceDelaySeconds) : 3;
      if (poweredNow && delay > 0) await sleep(delay * 1000);
      const until = Date.now() + Math.max(8, c.sourceRetrySeconds || 20) * 1000;
      let ok = false;
      for (let attempt = 1; Date.now() < until; attempt++) {
        await this.call('media_player', 'select_source', { entity_id: id, source: c.source })
          .catch((err) => this.trace(`Eingang wählen fehlgeschlagen: ${err.message}`));
        await sleep(1500);
        st = await this.state(id).catch(() => null);
        const cur = st && st.attributes ? st.attributes.source : undefined;
        this.trace(`Eingang-Versuch ${attempt}: jetzt ${cur === undefined ? 'unbekannt' : cur}`);
        if (cur === undefined) { ok = true; break; } // TV meldet keinen Eingang – nicht prüfbar
        if (cur === c.source) {
          // Kurz warten und prüfen, ob der Eingang bleibt (CEC vom einschaltenden Gerät kann zurückschalten)
          await sleep(2500);
          st = await this.state(id).catch(() => null);
          if (!st || !st.attributes || st.attributes.source === c.source) { ok = true; break; }
          this.trace(`Eingang wurde zurückgeschaltet auf ${st.attributes.source}`);
        }
      }
      if (!ok) this.log(`Eingang „${c.source}“ konnte nicht sicher gewählt werden`);
    }
    return { on: isOn(st), source: st && st.attributes ? st.attributes.source : undefined, via: via || '' };
  }

  async tvOff() {
    const c = this.cfg();
    const id = c.powerOffEntity || c.tvEntity;
    if (!id) return;
    this.trace(`Ausschalten über ${id}`);
    await this.powerOff(id);
  }

  async onStart() {
    if (!this.ready()) return null;
    const c = this.cfg();
    let result = null;
    if (c.turnOnAtStart !== false) result = await this.tvOn();
    for (const e of c.startServices || []) await this.runEntry(e).catch((err) => this.log(err.message));
    return result;
  }

  /** @param {{ shutdown?: boolean, tvOff?: boolean }} opts  tvOff: Antwort auf die Frage beim Beenden (überschreibt die Einstellung) */
  async onExit({ shutdown = false, tvOff } = {}) {
    if (!this.ready()) return;
    const c = this.cfg();
    for (const e of c.exitServices || []) await this.runEntry(e).catch((err) => this.log(err.message));
    const off = typeof tvOff === 'boolean' ? tvOff : (shutdown ? c.turnOffAtShutdown : c.turnOffAtExit);
    if (off) await this.tvOff().catch((err) => this.log(err.message));
    else if (!shutdown && c.sourceAtExit && c.tvEntity && c.tvEntity.startsWith('media_player.')) {
      await this.call('media_player', 'select_source', { entity_id: c.tvEntity, source: c.sourceAtExit }).catch(() => {});
    }
  }
}

module.exports = { HomeAssistant };
