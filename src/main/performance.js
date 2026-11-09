'use strict';
/**
 * Leistungsmodus: Hintergrundprogramme beim Start des Konsolenmodus pausieren / schließen
 * und beim Verlassen wiederherstellen. Optional Energieplan "Höchstleistung".
 */
const { execFile } = require('child_process');
const { powershell } = require('./launcher');

const IS_WIN = process.platform === 'win32';
const HIGH_PERFORMANCE_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';

/** Empfehlungen – werden in den Einstellungen per Klick übernommen (eigene Einträge jederzeit möglich). */
const RECOMMENDED = [
  { name: 'Wallpaper Engine', process: 'wallpaper64.exe;wallpaper32.exe', action: 'pause', pauseArgs: '-control pause', resumeArgs: '-control play', restore: true, note: 'Animierter Hintergrund – wird nur pausiert' },
  { name: 'Lively Wallpaper', process: 'Lively.exe', action: 'pause', restore: true, note: 'Animierter Hintergrund' },
  { name: 'OneDrive', process: 'OneDrive.exe', action: 'close', restore: true, restartArgs: '/background', note: 'Synchronisation stoppt während des Spielens' },
  { name: 'Google Drive', process: 'GoogleDriveFS.exe', action: 'close', restore: true, note: 'Synchronisation' },
  { name: 'Dropbox', process: 'Dropbox.exe', action: 'close', restore: true, restartArgs: '/home', note: 'Synchronisation' },
  { name: 'Microsoft Teams', process: 'ms-teams.exe;Teams.exe', action: 'close', restore: true, note: 'Viel RAM im Hintergrund' },
  { name: 'Adobe Creative Cloud', process: 'Creative Cloud.exe;CCXProcess.exe;Adobe Desktop Service.exe', action: 'close', restore: true, note: 'Mehrere Hintergrundprozesse' },
  { name: 'Corsair iCUE', process: 'iCUE.exe', action: 'pause', restore: true, note: 'RGB-Software, oft hohe CPU-Last' },
  { name: 'Razer Synapse', process: 'RazerAppEngine.exe;Razer Synapse 3.exe', action: 'pause', restore: true, note: 'RGB-Software' },
  { name: 'Spotify', process: 'Spotify.exe', action: 'close', restore: false, note: 'Nur wenn du beim Spielen keine Musik hörst' },
  { name: 'Discord', process: 'Discord.exe', action: 'close', restore: true, note: 'Nur wenn du Discord beim Spielen nicht brauchst' }
];

const SUSPEND_CS = `
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class AgsProc {
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static void Set(int pid, bool suspend) {
    IntPtr h = OpenProcess(0x0800, false, pid);
    if (h == IntPtr.Zero) return;
    if (suspend) NtSuspendProcess(h); else NtResumeProcess(h);
    CloseHandle(h);
  }
}
"@
`;

function psq(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function names(entry) {
  return String(entry.process || '').split(/[;,]/).map((s) => s.trim().replace(/\.exe$/i, '')).filter(Boolean);
}

/** Laufende Prozesse eines Eintrags: [{ id, path }] */
async function findProcesses(entry) {
  const list = names(entry);
  if (!list.length) return [];
  const out = await powershell(`Get-Process -Name ${list.map(psq).join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.Path)" }`);
  return out.split(/\r?\n/).filter(Boolean).map((l) => { const [id, ...p] = l.split('|'); return { id: Number(id), path: p.join('|').trim() }; }).filter((p) => p.id > 0);
}

function startDetached(exe, args) {
  if (!exe) return Promise.resolve();
  return powershell(`Start-Process -FilePath ${psq(exe)}${args ? ' -ArgumentList ' + psq(args) : ''}`);
}

function runExe(exe, args) {
  return new Promise((resolve) => execFile(exe, require('./launcher').splitArgs(args), { windowsHide: true, timeout: 15000 }, () => resolve()));
}

class Performance {
  constructor() {
    this.applied = []; // { entry, procs, mode }
    this.previousPlan = null;
  }

  async apply(cfg) {
    const p = cfg.performance || {};
    if (!IS_WIN || !p.enabled) return [];
    const report = [];
    if (p.highPerformancePlan) await this._setPlan();
    for (const entry of p.programs || []) {
      if (entry.enabled === false) continue;
      try {
        const procs = await findProcesses(entry);
        if (!procs.length) continue;
        const exe = (procs.find((x) => x.path) || {}).path || '';
        if (entry.action === 'pause') {
          if (entry.pauseArgs && exe) await runExe(exe, entry.pauseArgs);
          else await powershell(SUSPEND_CS + procs.map((x) => `[AgsProc]::Set(${x.id}, $true)`).join('; '));
        } else {
          const ids = procs.map((x) => x.id).join(',');
          if (entry.action === 'close') {
            await powershell(`${ids} | ForEach-Object { try { (Get-Process -Id $_ -ErrorAction Stop).CloseMainWindow() | Out-Null } catch {} }; Start-Sleep -Milliseconds 2500`);
          }
          await powershell(`Stop-Process -Id ${ids} -Force -ErrorAction SilentlyContinue`);
        }
        this.applied.push({ entry, procs, exe });
        report.push(entry.name);
      } catch { /* ein Programm darf den Start nicht blockieren */ }
    }
    return report;
  }

  /** @param {boolean} onlyPlan bei Herunterfahren nur den Energieplan zurücksetzen */
  async restore(onlyPlan = false) {
    if (!IS_WIN) return;
    if (!onlyPlan) {
      for (const { entry, procs, exe } of this.applied.reverse()) {
        try {
          if (entry.action === 'pause') {
            if (entry.resumeArgs && exe) await runExe(exe, entry.resumeArgs);
            else await powershell(SUSPEND_CS + procs.map((x) => `[AgsProc]::Set(${x.id}, $false)`).join('; '));
          } else if (entry.restore !== false && exe) {
            await startDetached(exe, entry.restartArgs || '');
          }
        } catch { /* ignore */ }
      }
      this.applied = [];
    }
    if (this.previousPlan) {
      await new Promise((r) => execFile('powercfg', ['/setactive', this.previousPlan], { windowsHide: true }, () => r()));
      this.previousPlan = null;
    }
  }

  async _setPlan() {
    const out = await new Promise((r) => execFile('powercfg', ['/getactivescheme'], { windowsHide: true }, (e, so) => r(String(so || ''))));
    const m = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (!m || m[0].toLowerCase() === HIGH_PERFORMANCE_GUID) return;
    this.previousPlan = m[0];
    await new Promise((r) => execFile('powercfg', ['/setactive', HIGH_PERFORMANCE_GUID], { windowsHide: true }, () => r()));
  }
}

/** Laufende Programme mit Fenster/viel RAM – zur Auswahl in den Einstellungen */
async function listRunning() {
  if (!IS_WIN) return [];
  const out = await powershell(`Get-Process | Where-Object { $_.Path -and $_.Path -notlike "$env:SystemRoot*" } | Group-Object Name | ForEach-Object { $m = ($_.Group | Measure-Object WorkingSet64 -Sum).Sum; $f = $_.Group[0]; $d = $f.MainModule.FileVersionInfo.FileDescription; "$($_.Name)|$m|$d|$($f.Path)" }`, 20000);
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [name, mem, desc, ...p] = l.split('|');
    return { process: name + '.exe', name: (desc || name).trim() || name, memMB: Math.round(Number(mem) / 1048576), path: p.join('|') };
  }).filter((p) => !/^(AleGamestation|electron|explorer|powershell|steam|steamwebhelper|audiodg|dwm)\.exe$/i.test(p.process))
    .sort((a, b) => b.memMB - a.memMB).slice(0, 30);
}

module.exports = { Performance, RECOMMENDED, listRunning, names };
