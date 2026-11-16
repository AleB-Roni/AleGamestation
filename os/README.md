# AleGamestation OS

Ein Linux-Betriebssystem, das direkt in **AleGamestation** startet und sich wie eine Konsole verhält.
Gebaut auf [Bazzite](https://bazzite.gg) (Fedora Atomic): Treiber für AMD, Intel und NVIDIA, Gamescope,
Steam/Proton und Controller-Unterstützung sind schon dabei. Updates kommen wie bei einer Konsole als
komplettes System-Abbild. Geht etwas schief, startest du einfach die vorige Version aus dem Boot-Menü.

## Für welche Hardware?

| Rechner | Abbild |
|---|---|
| AMD Ryzen mit integrierter Grafik (z. B. 5600G), AMD-Grafikkarten, Intel-CPUs/-Grafik | `ghcr.io/aleb-roni/alegamestation-os:stable` |
| NVIDIA-Grafikkarte | `ghcr.io/aleb-roni/alegamestation-os-nvidia:stable` |

## Installation

1. **Bazzite (Deck-Edition) installieren:** Auf [bazzite.gg](https://bazzite.gg) „Bazzite Deck“ für deine
   Grafik wählen (AMD/Intel bzw. NVIDIA), das ISO auf einen USB-Stick schreiben (z. B. mit Fedora Media Writer
   oder balenaEtcher), davon starten und installieren.
2. **Auf AleGamestation OS umstellen:** Nach dem ersten Start zum Desktop wechseln (im Steam-Spielmodus:
   Ein/Aus → „Zum Desktop wechseln“), ein Terminal (Konsole) öffnen und eingeben:
   ```bash
   sudo bootc switch ghcr.io/aleb-roni/alegamestation-os:stable
   ```
   (NVIDIA: `alegamestation-os-nvidia:stable`), danach neu starten.
3. Fertig. Der Rechner startet jetzt direkt in AleGamestation. Beim ersten Start richtet das System im
   Hintergrund die Emulatoren (Flatpak), die RetroArch-Cores und die ROM-Ordner unter `~/ROMs` ein.
   Das dauert je nach Internet ein paar Minuten. Den Fortschritt siehst du unten rechts.

> Hinweis: Das Abbild liegt in der GitHub Container Registry. Falls `bootc switch` „unauthorized“ meldet,
> unter GitHub → Profil → Packages → `alegamestation-os` → Package settings die Sichtbarkeit auf **Public** stellen.

## Bedienung

- **Spielmodus** (Standard): AleGamestation im Vollbild über Gamescope. Spiele und Emulatoren laufen darin.
- **Zum Linux-Desktop:** ☰-Menü → „Zum Linux-Desktop wechseln“, oder **Strg+Alt+D**.
- **Zurück zu AleGamestation:** Desktop-Symbol „Zurück zu AleGamestation“ (auch im Startmenü unter Spiele).
- **System aktualisieren:** ☰-Menü → „System aktualisieren“. Das lädt das neueste Abbild samt neuester App.
  Aktiv wird es nach dem Neustart. Neue App-Versionen landen automatisch im Abbild, sobald ein Release
  erstellt wird.
- **Emulatoren ergänzen/reparieren:** ☰-Menü → „Emulatoren einrichten / ergänzen“.
- **ROMs:** in `~/ROMs/<konsole>` kopieren, z. B. über den Desktop, per Netzwerkfreigabe oder über RomM.

## Was ist drin?

- AleGamestation (die gleiche App wie unter Windows, inkl. RomM, Home Assistant, Spotify, Bildschirmtastatur …)
- Gamescope-Sitzung `gamescope-session-alegamestation` (Spielmodus) und KDE Plasma (Desktop)
- Emulatoren als Flatpak: RetroArch (Snes9x, Mesen, mGBA, Mupen64Plus-Next, Genesis Plus GX), melonDS, Dolphin,
  DuckStation, PCSX2, PPSSPP
- Steam mit Proton (aus Bazzite) – PC-Spiele erscheinen wie unter Windows im Steam-Tab

## Aufbau (für Entwickler)

```
os/
  Containerfile                     Abbild = Bazzite-Deck + App (dist/linux-unpacked) + system_files
  system_files/
    usr/bin/alegamestation           startet die App (ALEGAMESTATION_OS=1)
    usr/bin/alegamestation-session   Wechsel Spielmodus ↔ Desktop (als Benutzer)
    usr/libexec/alegamestation-session-select   (root, per pkexec) SDDM-Autologin-Sitzung setzen
    usr/libexec/alegamestation-firstboot        Emulatoren, Cores, ROM-Ordner (pro Benutzer)
    usr/libexec/alegamestation-os-update        bootc upgrade
    usr/share/gamescope-session-plus/sessions.d/alegamestation   Gamescope-Sitzung
    usr/share/wayland-sessions/gamescope-session-alegamestation.desktop
    etc/sddm.conf.d/zz-zz-alegamestation.conf   Autologin in den Spielmodus
```

Gebaut wird automatisch im Release-Workflow (`build-linux` → `build-os`), für beide Varianten.
