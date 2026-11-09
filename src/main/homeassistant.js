'use strict';
/**
 * Home Assistant: Fernseher beim Start einschalten und auf den richtigen HDMI-Eingang schalten,
 * beim Beenden / Herunterfahren optional ausschalten. Zusätzlich eigene Dienste (Szenen, Skripte, Licht …).
 * Zugriff über die REST-API mit einem "langlebigen Zugangstoken" (HA-Profil → Sicherheit).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HomeAssistant {
  /** @param {{ fetch: Function, getConfig: Function, log?: Function }} opts */
  constructor(opts) {
    this.fetch = opts.fetch || globalThis.fetch;
    this.getConfig = opts.getConfig;
    this.log = opts.log || (() => {});
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
    const scripts = (states || []).filter((s) => /^(script|scene|automation|switch|light|input_boolean)\./.test(s.entity_id))
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

  /** Fernseher einschalten, warten bis er an ist, dann Eingang (HDMI) wählen */
  async tvOn() {
    const c = this.cfg();
    const id = c.tvEntity;
    if (!id) return { skipped: true };
    const domain = id.split('.')[0];
    let st = await this.state(id).catch(() => null);
    const isOn = (x) => x && !['off', 'unavailable', 'unknown', 'standby'].includes(x.state);
    if (!isOn(st)) {
      await this.call(domain, 'turn_on', { entity_id: id });
      const until = Date.now() + (c.waitForTvSeconds || 20) * 1000;
      while (Date.now() < until) {
        await sleep(1000);
        st = await this.state(id).catch(() => null);
        if (isOn(st)) break;
      }
      if (!isOn(st)) this.log('Fernseher meldet sich nicht als eingeschaltet – versuche trotzdem den Eingang zu wechseln');
    }
    if (c.source && domain === 'media_player') {
      for (let attempt = 0; attempt < 4; attempt++) {
        await this.call('media_player', 'select_source', { entity_id: id, source: c.source }).catch(() => {});
        await sleep(attempt ? 2000 : 1200);
        st = await this.state(id).catch(() => null);
        if (!st || !st.attributes || st.attributes.source === undefined || st.attributes.source === c.source) break;
      }
    }
    return { on: isOn(st), source: st && st.attributes ? st.attributes.source : undefined };
  }

  async tvOff() {
    const id = this.cfg().tvEntity;
    if (!id) return;
    await this.call(id.split('.')[0], 'turn_off', { entity_id: id });
  }

  async onStart() {
    if (!this.ready()) return null;
    const c = this.cfg();
    let result = null;
    if (c.turnOnAtStart !== false) result = await this.tvOn();
    for (const e of c.startServices || []) await this.runEntry(e).catch((err) => this.log(err.message));
    return result;
  }

  async onExit({ shutdown = false } = {}) {
    if (!this.ready()) return;
    const c = this.cfg();
    for (const e of c.exitServices || []) await this.runEntry(e).catch((err) => this.log(err.message));
    if (shutdown ? c.turnOffAtShutdown : c.turnOffAtExit) await this.tvOff().catch((err) => this.log(err.message));
    else if (!shutdown && c.sourceAtExit && c.tvEntity && c.tvEntity.startsWith('media_player.')) {
      await this.call('media_player', 'select_source', { entity_id: c.tvEntity, source: c.sourceAtExit }).catch(() => {});
    }
  }
}

module.exports = { HomeAssistant };
