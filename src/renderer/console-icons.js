/* Eigene, vereinfachte Umriss-Zeichnungen der Konsolen (keine Hersteller-Logos).
 * Zeichenfläche 100 x 64, Linien in der aktuellen Textfarbe. Eigene Logos: Einstellungen → Systeme → Logo-Bild. */
(function () {
  const svg = (body) => `<svg viewBox="0 0 100 64" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const dpad = (x, y, s = 5) => `<path d="M${x - s / 2} ${y - s * 1.5}h${s}v${s}h${s}v${s}h-${s}v${s}h-${s}v-${s}h-${s}v-${s}h${s}z"/>`;

  const ICONS = {
    // NES: kastenförmige Konsole mit Klappe und zwei Controller-Anschlüssen
    nes: svg(`<rect x="12" y="14" width="76" height="40" rx="3"/><path d="M12 30h76"/><rect x="24" y="19" width="52" height="7" rx="1.5"/>
      <rect x="18" y="40" width="9" height="7" rx="1"/><rect x="31" y="40" width="9" height="7" rx="1"/><rect x="60" y="41" width="9" height="5" rx="1"/><rect x="73" y="41" width="9" height="5" rx="1"/>`),
    // SNES: Controller mit Steuerkreuz und vier Tasten im Kreuz
    snes: svg(`<path d="M30 14h40a18 18 0 0 1 0 36H30a18 18 0 0 1 0-36z"/>${dpad(28, 32)}
      <circle cx="72" cy="24" r="3.6"/><circle cx="72" cy="40" r="3.6"/><circle cx="64" cy="32" r="3.6"/><circle cx="80" cy="32" r="3.6"/><path d="M44 34h5M52 34h5"/>`),
    // N64: Dreizack-Controller
    n64: svg(`<path d="M20 16c10-6 50-6 60 0c6 4 7 14 3 22l-6 12c-2 4-7 4-8 0l-4-12h-9l-2 16c-1 5-7 5-8 0l-2-16h-9l-4 12c-1 4-6 4-8 0l-6-12c-4-8-3-18 3-22z"/>
      ${dpad(28, 26, 4)}<circle cx="72" cy="22" r="2.6"/><circle cx="66" cy="28" r="2.6"/><circle cx="50" cy="36" r="4"/>`),
    // Game Boy Advance: Querformat-Handheld
    gba: svg(`<path d="M18 14h64c8 0 12 6 12 18s-4 18-12 18H18C10 50 6 44 6 32s4-18 12-18z"/><rect x="32" y="20" width="36" height="24" rx="2"/>
      ${dpad(19, 32, 4)}<circle cx="80" cy="28" r="3"/><circle cx="86" cy="35" r="3"/>`),
    // Game Boy: Hochformat
    gb: svg(`<rect x="32" y="4" width="36" height="56" rx="4"/><rect x="37" y="9" width="26" height="20" rx="1.5"/>${dpad(42, 42, 3.4)}<circle cx="58" cy="40" r="2.6"/><circle cx="63" cy="35" r="2.6"/><path d="M48 52h4M54 52h4"/>`),
    // Nintendo DS: aufgeklapptes Doppelbildschirm-Gerät
    nds: svg(`<rect x="28" y="2" width="44" height="29" rx="3"/><rect x="36" y="7" width="28" height="19" rx="1"/><rect x="26" y="33" width="48" height="29" rx="3"/>
      <rect x="38" y="38" width="24" height="18" rx="1"/>${dpad(32, 47, 2.6)}<circle cx="68" cy="44" r="1.8"/><circle cx="68" cy="51" r="1.8"/>`),
    // GameCube: Würfel mit Griff und runder Klappe
    gc: svg(`<path d="M30 20l20-10 20 10v26L50 56 30 46z"/><path d="M30 20l20 10 20-10M50 30v26"/><circle cx="60" cy="28" r="5"/><path d="M36 14c2-6 26-6 28 0"/>`),
    // Wii: schmale, hochkant stehende Konsole
    wii: svg(`<rect x="40" y="4" width="20" height="54" rx="3"/><path d="M44 12h12"/><circle cx="50" cy="50" r="2"/><path d="M34 60h32"/>`),
    // Mega Drive: Konsole mit großem rundem Element
    md: svg(`<path d="M8 22h84v28H8z"/><circle cx="66" cy="34" r="13"/><circle cx="66" cy="34" r="6"/><rect x="18" y="16" width="34" height="6" rx="1"/><path d="M16 42h18M16 46h18"/>`),
    // PlayStation: Konsole mit runder Laufwerksklappe
    ps1: svg(`<rect x="12" y="16" width="76" height="36" rx="3"/><circle cx="44" cy="32" r="12"/><circle cx="44" cy="32" r="3"/><rect x="66" y="22" width="14" height="5" rx="2"/><rect x="66" y="30" width="14" height="5" rx="2"/><path d="M18 46h12M60 46h22"/>`),
    // PlayStation 2: flache Konsole mit Lamellen und Laufwerksschacht
    ps2: svg(`<path d="M10 22h80v26H10z"/><path d="M10 30h80"/><path d="M18 40h40"/><path d="M68 36v8M74 36v8M80 36v8"/><circle cx="84" cy="26" r="1.5"/>`),
    // PSP: breiter Handheld
    psp: svg(`<path d="M18 16h64c8 0 14 7 14 16s-6 16-14 16H18C10 48 4 41 4 32s6-16 14-16z"/><rect x="28" y="20" width="44" height="24" rx="1.5"/>
      ${dpad(15, 30, 3.2)}<circle cx="84" cy="25" r="2.2"/><circle cx="84" cy="35" r="2.2"/><circle cx="79" cy="30" r="2.2"/><circle cx="89" cy="30" r="2.2"/>`),
    // Allgemein: Gamepad
    generic: svg(`<path d="M24 18h52c10 0 16 10 16 22 0 9-7 12-12 6l-7-8H27l-7 8c-5 6-12 3-12-6 0-12 6-22 16-22z"/>${dpad(28, 30, 4)}<circle cx="70" cy="26" r="2.6"/><circle cx="76" cy="32" r="2.6"/>`)
  };
  // Weitere Systeme auf vorhandene Zeichnungen abbilden
  const ALIAS = { gbc: 'gb', sms: 'md', gg: 'gb', saturn: 'ps1', dc: 'ps2', pce: 'nes', neogeo: 'nes', ps3: 'ps2', switch: 'gba', '3ds': 'nds' };

  function forSystem(id, name) {
    if (ICONS[id]) return ICONS[id];
    if (ALIAS[id]) return ICONS[ALIAS[id]];
    const n = String(name || '').toLowerCase();
    if (/portable|psp/.test(n)) return ICONS.psp;
    if (/playstation 2|ps2/.test(n)) return ICONS.ps2;
    if (/playstation|psx|ps1/.test(n)) return ICONS.ps1;
    if (/gamecube/.test(n)) return ICONS.gc;
    if (/wii/.test(n)) return ICONS.wii;
    if (/\bds\b|nintendo ds/.test(n)) return ICONS.nds;
    if (/advance/.test(n)) return ICONS.gba;
    if (/game ?boy/.test(n)) return ICONS.gb;
    if (/64/.test(n)) return ICONS.n64;
    if (/super nintendo|snes/.test(n)) return ICONS.snes;
    if (/nintendo|nes/.test(n)) return ICONS.nes;
    if (/sega|mega|genesis/.test(n)) return ICONS.md;
    return ICONS.generic;
  }

  window.ConsoleIcons = { forSystem, ICONS };
})();
