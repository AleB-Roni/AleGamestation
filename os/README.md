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

### Mit dem AleGamestation-OS-Installer (empfohlen)

1. Aus dem neuesten [Release](https://github.com/AleB-Roni/AleGamestation/releases/latest) herunterladen:
   - `AleGamestation-OS-Installer-<version>.iso` für AMD/Intel (z. B. Ryzen 5600G mit integrierter Grafik)
   - `AleGamestation-OS-NVIDIA-Installer-<version>.iso` für NVIDIA-Grafikkarten
2. Das ISO auf einen USB-Stick schreiben (z. B. mit [Fedora Media Writer](https://fedoraproject.org/workstation/download),
   [balenaEtcher](https://etcher.balena.io) oder [Rufus](https://rufus.ie) im „DD-Modus“).
3. Den Rechner per **LAN-Kabel** ans Internet anschließen (WLAN geht im Installer auch, Kabel ist einfacher) und vom Stick starten.
4. Im Installer (Deutsch ist voreingestellt):
   - **Installationsziel:** Festplatte wählen (Achtung: Inhalte werden überschrieben, wenn du „automatisch“ wählst)
   - **Benutzer erstellen:** Name und Passwort, Haken bei „Diesen Benutzer zum Administrator machen“. Dieser Benutzer wird
     automatisch angemeldet. Legst du keinen an, erstellt der Installer `spieler` mit dem Passwort `alegamestation`
   - „Installation beginnen“. AleGamestation OS wird jetzt aus dem Internet geladen (ca. 8 GB, dauert etwas)
5. Neu starten und den Stick abziehen. Der Rechner startet direkt in AleGamestation. Beim ersten Start werden
   im Hintergrund die Emulatoren eingerichtet.

**Secure Boot:** Ist Secure Boot im BIOS an, erscheint nach der Installation einmalig ein blauer Bildschirm
„MOK management“: **Enroll MOK → Continue → Yes**, Passwort **`universalblue`**, dann **Reboot**. Alternativ
Secure Boot im BIOS ausschalten.

### Alternativ: bestehendes Bazzite umstellen

Bazzite (Deck-Edition) von [bazzite.gg](https://bazzite.gg) installieren, im Desktop ein Terminal öffnen und
```bash
sudo bootc switch ghcr.io/aleb-roni/alegamestation-os:stable
```
(NVIDIA: `alegamestation-os-nvidia:stable`) ausführen, dann neu starten.

> Hinweis: Installer und Updates laden das System aus der GitHub Container Registry. Die Pakete
> `alegamestation-os` und `alegamestation-os-nvidia` müssen dafür auf GitHub **öffentlich** sein
> (Profil → Packages → Paket → Package settings → Change visibility → Public).

## Bedienung

- **Spielmodus** (Standard): AleGamestation im Vollbild über Gamescope. Spiele und Emulatoren laufen darin.
- **Zum Linux-Desktop:** ☰-Menü → „Zum Linux-Desktop wechseln“, oder **Strg+Alt+D**.
- **Zurück zu AleGamestation:** Desktop-Symbol „Zurück zu AleGamestation“ (auch im Startmenü unter Spiele).
- **System aktualisieren:** ☰-Menü → „System aktualisieren“. Das lädt das neueste Abbild samt neuester App.
  Aktiv wird es nach dem Neustart. Neue App-Versionen landen automatisch im Abbild, sobald ein Release
  erstellt wird.
- **Emulatoren ergänzen/reparieren:** ☰-Menü → „Emulatoren einrichten / ergänzen“.
- **Emulatoren laden & aktualisieren:** ☰-Menü → „Emulatoren laden & aktualisieren“ (oder Einstellungen → Emulatoren laden):
  Eden (Switch), RetroArch, Dolphin, DuckStation, PCSX2, PPSSPP, melonDS, Cemu, Azahar, RPCS3 per Knopfdruck, eigene
  GitHub-/Forgejo-Quellen, tägliche automatische Updates.
- **Fernzugriff (Tailscale):** Einstellungen → Fernzugriff → „Verbinden“ → QR-Code mit dem Handy scannen. Danach ist der
  Rechner in deinem Tailnet erreichbar, und RomM kann über seine Tailscale-Adresse auch unterwegs genutzt werden.
- **ROMs:** in `~/ROMs/<konsole>` kopieren, z. B. über den Desktop, per Netzwerkfreigabe oder über RomM.

**Ohne passende Grafik** (z. B. in Hyper-V oder einer VM ohne 3D-Beschleunigung) kann der Gamescope-Spielmodus
nicht laufen. AleGamestation OS erkennt das und startet dann den Desktop mit AleGamestation als normalem Fenster
statt eines schwarzen Bildschirms. In Hyper-V vor der Installation **Secure Boot ausschalten**
(VM-Einstellungen → Sicherheit), mindestens 8 GB RAM und 64 GB Festplatte.

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
  installer/
    alegamestation.ks                 Kickstart: installiert das Abbild aus der Registry (ostreecontainer)
    build-iso.sh                      Fedora-netinst-ISO + Kickstart → Installer-ISO (mkksiso)
```

Gebaut wird automatisch im Release-Workflow (`build-linux` → `build-os` → `build-iso`), für beide Varianten.
