# AleGamestation 🎮

Verwandelt deinen Windows-PC in eine **Konsole für den Fernseher** – ähnlich wie Steam Big Picture oder EmulationStation:
Alle Spiele (Steam, Epic, GOG, eigene) und Emulator-Spiele in einer modernen Oberfläche, komplett mit dem Controller bedienbar.

![Startseite](docs/start.png)

## Funktionen

**Bibliothek**
- **Automatische Erkennung** von Steam-, Epic- und GOG-Spielen (inkl. Steam-Coverbildern)
- **Emulatoren-Ansicht**: oben die Emulatoren/Systeme (mit Status *gefunden / nicht gefunden*), darunter deren Spiele
- Auf jeder Spielkachel und in den Details siehst du, **mit welchem Emulator** das Spiel startet – und kannst es **pro Spiel ändern**
- **Eigene Spiele/Programme hinzufügen** (z. B. Kodi, Spiele ohne Launcher) direkt in der Oberfläche
- ROM-Ordner werden durchsucht (inkl. Unterordner), Covers werden automatisch erkannt (`Spielname.png` im Ordner, in `covers/` oder `media/covers/`)
- **Konsolen-Sounds**: sanfte, glockenartige Menüklänge mit Hall (Thema „Modern“), alternativ „Retro (8-Bit)“, Lautstärke einstellbar, Start-Klang
- **Automatische Updates** direkt von GitHub
- **Home Assistant**: Fernseher beim Start einschalten und auf den richtigen HDMI-Eingang schalten
- **Maus & Tastatur per Controller** – nie wieder zur Tastatur greifen
- **DualSense-Touchpad als Maus** außerhalb von Spielen
- **Cover-Download** für ROMs (libretro-thumbnails ohne Konto, optional ScreenScraper) inkl. Screenshots als Hintergrund
- Startseite mit Regalen: *Zuletzt gespielt*, *Favoriten*, je Store/System eine Reihe
- Favoriten, **Spielzeit-Statistik**, „zuletzt gespielt“, eigene Cover, Spiele ausblenden
- „Alle Spiele“ mit Buchstaben-Sprung (LT/RT)
- Kachel „Steam Big Picture öffnen“

**Konsolenmodus**
- **Leistungsmodus**: Hintergrundprogramme beim Start pausieren oder beenden und beim Verlassen wiederherstellen – z. B. Wallpaper Engine (voreingestellt), OneDrive, Teams, iCUE … Empfehlungen per Klick, oder aus den laufenden Programmen wählen. Optional Energieplan „Höchstleistung“
- Beim Start **Bildschirm umschalten** (nur TV / nur PC-Monitor / duplizieren / erweitern – wie Win + P), beim Beenden wiederherstellen
- Eigene Befehle beim Start/Beenden (z. B. Tonausgabe auf den TV umstellen)
- **Herunterfahren, Neustart, Energiesparen, zurück zum Desktop** direkt per Controller
- Autostart mit Windows, Vollbild auf wählbarem Bildschirm, Mauszeiger wird ausgeblendet

**Controller**
- **PlayStation-Controller werden erkannt** (DualSense, DualSense Edge, DualShock 4): Oberfläche zeigt ✕ ○ □ △, L1/R1, Options, PS. Xbox- und Nintendo-Symbole ebenfalls – automatisch oder fest einstellbar
- PlayStation-Controller werden per USB/Bluetooth **direkt ausgelesen** – die Beenden-Kombination (*Create + Options*) funktioniert ohne Steam Input oder DS4Windows
- **Boot-Animation** und **Spielstart-Animation**
- **Konsolen-Overlay** (PS-Taste halten): Spiel beenden, Spiel wechseln, Spotify, Lautstärke
- **PS-Taste im Spiel öffnet ein Schnellmenü** über dem Spiel: ✕ Spiel beenden (mit Rückfrage), △ zur Oberfläche, ○ weiterspielen
- **Tastenkombination zum Beenden von Spielen/Emulatoren** (Standard: `BACK + START` 0,8 s halten) – funktioniert **auch, während das Spiel im Vordergrund ist**
- Zweite Kombination, um die Oberfläche hervorzuholen, ohne das Spiel zu beenden (Standard: `BACK + LB + RB`)
- Kombinationen frei wählbar oder **direkt am Controller aufnehmen**
- Sanftes Beenden (Emulatoren können noch speichern), danach hartes Beenden inkl. aller Unterprozesse
- Nintendo-Layout (A/B tauschen), Analog-Stick-Navigation

| Emulatoren | Spiel-Details | Einstellungen |
|---|---|---|
| ![](docs/emulatoren.png) | ![](docs/details.png) | ![](docs/einstellungen.png) |

## Installation

1. Unter **[Releases](https://github.com/AleB-Roni/AleGamestation/releases/latest)** die Datei `AleGamestation-Setup-x.y.z.exe` herunterladen
2. Installer starten. Da die App nicht kostenpflichtig signiert ist, zeigt Windows evtl. „Der Computer wurde durch Windows geschützt“ → **Weitere Informationen → Trotzdem ausführen**
3. AleGamestation über das Desktop-Symbol starten – am besten in den Einstellungen **„Mit Windows starten“** aktivieren

### Updates

**Menü (☰ / Options) → „Nach Updates suchen“** fragt GitHub nach der neuesten Version und zeigt installierte und neue Version sowie die **Liste der Änderungen**. Von dort: **Herunterladen & installieren** (mit Fortschrittsbalken), später installieren oder die Release-Seite öffnen.

- Beim Start und alle 6 Stunden wird automatisch gesucht; ein verfügbares Update erscheint oben als **„⬆ Update“**-Hinweis
- Updates werden im Hintergrund geladen (abschaltbar: dann wird erst nachgefragt) und erst installiert, wenn du es bestätigst oder die App beendest
- Einstellungen unter **Einstellungen → Info & Updates**

### Selbst bauen / entwickeln

Voraussetzung: [Node.js](https://nodejs.org) (LTS).

```bash
npm install
npm start          # Konsolenmodus starten
npm run dev        # Fenster-Modus zum Testen (ohne Bildschirmumschaltung)
npm run dist       # Installer lokal erstellen (Ordner dist/)
```

### Neue Version veröffentlichen

Die Änderungsliste im Update-Fenster wird automatisch aus den Commit-Nachrichten seit der letzten Version erzeugt.


1. Version in `package.json` erhöhen (z. B. `1.0.1`) und committen
2. Auf GitHub **Actions → Release → „Run workflow“** klicken (oder Tag pushen: `git tag v1.0.1 && git push origin v1.0.1`)
3. GitHub Actions baut den Windows-Installer und veröffentlicht das Release – alle installierten Apps aktualisieren sich dann selbst

## Bedienung

| Taste | Bibliothek | Einstellungen |
|---|---|---|
| Steuerkreuz / Stick | Navigieren | Navigieren |
| **A** | Spiel starten | Ändern / Auswählen |
| **B** | Zurück | Zurück |
| **X** | Favorit an/aus | Vorheriger Bereich |
| **Y** | Details (Emulator wählen, Cover, ausblenden …) | Nächster Bereich |
| **LB / RB** | Kategorie wechseln | Kategorie wechseln |
| **LT / RT** | Buchstaben-Sprung | |
| **☰ Start** | Menü (Herunterfahren, Bildschirm, …) | |
| **⧉ Back** | Einstellungen | Zurück |
| **BACK + START halten** | Laufendes Spiel beenden | |
| **PS- / Xbox-Taste** (im Spiel) | Schnellmenü: ✕ Spiel beenden · △ Zur Oberfläche · ○ Weiterspielen | |

**Tastatur** (komplett bedienbar, Symbole wechseln automatisch zwischen Tastatur und Controller):

| Taste | Funktion |
|---|---|
| WASD / Pfeiltasten | Navigieren |
| Leertaste / Enter | Auswählen / Starten |
| Esc / Rücktaste | Zurück |
| Q / E | Kategorie wechseln |
| F | Favorit |
| R / Tab | Details |
| Z / C | Buchstaben-Sprung |
| M | Menü |
| O | Einstellungen |

## Konsolen-Overlay (PS-/Xbox-Taste gedrückt halten)

Während eines Spiels die **PS-Taste** (Xbox: Guide-Taste) **gedrückt halten** öffnet ein Menü über dem Spiel:

- **Zurück zum Spiel**, **Zur Oberfläche**, **Spiel beenden** (mit Rückfrage)
- **Schnellstart**: zuletzt gespielte Spiele – das laufende Spiel wird beendet und das gewählte gestartet
- **Musik**: aktueller Spotify-Titel, ⏮ ⏯ ⏭ (über die Windows-Medientasten – funktioniert auch mit anderen Playern)
- **System**: Lautstärke leiser/lauter/stumm, Maussteuerung

**Kurz drücken** öffnet das kleine Schnellmenü (✕ beenden · △ Oberfläche · ○ weiterspielen). Beides unter **Einstellungen → Controller** anpassbar.
Hinweis: Läuft Steam, kann die PS-Taste zusätzlich Steam öffnen – in Steam unter *Einstellungen → Controller → Guide-Tasten-Verknüpfungen* abschalten.

## Home Assistant – Fernseher automatisch einschalten

Beim Start schaltet AleGamestation den Fernseher über Home Assistant ein, wartet bis er an ist und wechselt auf den gewählten **HDMI-Eingang** – erst danach wird das Bild auf den TV umgeschaltet.

1. In Home Assistant: **Profil → Sicherheit → Langlebiges Zugangstoken erstellen**
2. In AleGamestation: **Einstellungen → Home Assistant** → Adresse (z. B. `http://homeassistant.local:8123`) und Token eintragen → **„Verbindung testen & Geräte laden“**
3. Fernseher und HDMI-Eingang auswählen (die Eingangsliste kommt direkt vom Fernseher)

Optional: Fernseher beim Herunterfahren / Zurückkehren zum Desktop ausschalten oder auf einen anderen Eingang schalten, und eigene Aktionen beim Start/Beenden (z. B. `scene.gaming`, `script.licht_dimmen`, `light.turn_off:light.decke`).
Funktioniert mit allen Fernsehern, die Home Assistant als Mediaplayer kennt (LG webOS, Samsung, Sony Bravia, Android TV, Philips …). Ob ein ausgeschalteter Fernseher eingeschaltet werden kann, hängt von der jeweiligen Integration ab (bei LG z. B. per Wake-on-LAN-Automation).

## Maus & Tastatur per Controller

Für Launcher-Fenster, Logins oder den Browser: **Create + △** (Xbox: View + Y) kurz halten schaltet die Maussteuerung ein bzw. aus – überall in Windows, auch über anderen Programmen. Eine Einblendung oben zeigt den Status.

| Controller | Funktion |
|---|---|
| Linker Stick | Maus bewegen (R2/RT halten = langsam & präzise) |
| Rechter Stick | Scrollen |
| ✕ / A | Linksklick (halten = ziehen) |
| ○ / B | Rechtsklick |
| □ / X | Bildschirmtastatur ein/aus |
| △ / Y | Enter |
| Steuerkreuz | Pfeiltasten |
| L1 / LB | Alt+Tab (Fenster wechseln) |
| R1 / RB | Tab |
| L2 / LT | Rücktaste |
| Options / Start | Esc |
| L3 | Mittelklick |

Kombination und Mausgeschwindigkeit sind unter **Einstellungen → Controller** einstellbar.

### Touchpad als Maus (DualSense / DualShock 4)

Außerhalb von Spielen funktioniert das Touchpad wie am Laptop – ganz ohne Umschalten:

| Touchpad | Funktion |
|---|---|
| 1 Finger bewegen | Maus bewegen |
| Drücken | Linksklick (gedrückt halten = ziehen) |
| Mit 2 Fingern drücken | Rechtsklick |
| Kurz antippen (1 / 2 Finger) | Links- / Rechtsklick |
| 2 Finger bewegen | Scrollen |

Sobald ein Spiel läuft, gehört das Touchpad wieder dem Spiel. Einstellbar unter **Einstellungen → Controller** (immer außerhalb von Spielen / nur in der Maussteuerung / aus, Geschwindigkeit, Antippen).

## Cover herunterladen

ROMs bekommen automatisch **Box-Art und Screenshots** (Screenshots erscheinen als Hintergrund hinter dem ausgewählten Spiel):

- **libretro-thumbnails** – kostenlos, ohne Konto, sofort aktiv. Funktioniert am besten mit ROMs im üblichen No-Intro/Redump-Namensformat (z. B. `Super Mario World (USA).sfc`), erkennt aber auch unsaubere Namen wie `super_mario_world.sfc`
- **ScreenScraper.fr** – optional, größte Datenbank, erkennt ROMs zusätzlich über Dateigröße und Prüfsumme. Benötigt ein kostenloses Konto **und** einen Entwickler-Zugang (devid/devpassword, im ScreenScraper-Forum zu beantragen). Eintragen unter **Einstellungen → Cover**

Fehlende Cover werden beim Start automatisch im Hintergrund geladen. Manuell: **Menü → „Fehlende Cover herunterladen“**, pro System (Emulatoren-Tab → Y) oder pro Spiel (Details → „Cover herunterladen“). Der offizielle Spielname wird dabei gleich mit übernommen.
Bilder liegen in `%APPDATA%\AleGamestation\media` (Speicherort änderbar). Eigene Bilder neben der ROM (`Spielname.png` oder `covers\Spielname.png`) haben Vorrang.

### Bilder für PC-Spiele (Steam, Epic, GOG, eigene)

- **Steam-Spiele** bekommen Cover und Hintergrund direkt von Steams Bilderserver – auch wenn Steam sie lokal noch nicht geladen hat
- **Epic-, GOG- und eigene Spiele** werden im Steam-Shop gesucht und übernehmen dessen Bilder (funktioniert für alle Spiele, die es auch auf Steam gibt)
- **Optional SteamGridDB**: Für Spiele ohne Steam-Version (z. B. Fortnite) einen kostenlosen API-Schlüssel von steamgriddb.com (Profil → Einstellungen → API) unter **Einstellungen → Cover** eintragen
- Neu hinzugefügte Spiele bekommen ihr Cover sofort; eigene Bilder gehen immer über Details → „Cover-Bild ändern“

## Einrichtung der Emulatoren

1. **Einstellungen → Emulatoren → „Installierte Emulatoren automatisch suchen“** (findet RetroArch, Dolphin, PCSX2, DuckStation, PPSSPP, melonDS an typischen Orten)
2. Sonst Pfad zur `.exe` manuell eintragen. Start-Argumente nutzen Platzhalter: `{rom}`, `{romName}`, `{romDir}`, `{emuDir}`
3. **Einstellungen → Systeme & ROMs**: ROM-Ordner, Dateiendungen und Standard-Emulator je System festlegen
4. Einzelnes Spiel mit anderem Emulator starten: Spiel auswählen → **Y** → „Starten mit“

Vorbelegte Beispiele (anpassbar):

| System | Emulator | Argumente |
|---|---|---|
| NES / SNES / N64 / GBA / Mega Drive | RetroArch + Core | `-f -L cores\snes9x_libretro.dll "{rom}"` |
| GameCube / Wii | Dolphin | `-b -e "{rom}"` |
| PS1 | DuckStation | `-batch -fullscreen -- "{rom}"` |
| PS2 | PCSX2 | `-batch -fullscreen -- "{rom}"` |
| PSP | PPSSPP | `--fullscreen "{rom}"` |
| NDS | melonDS | `-f "{rom}"` |

## Gut zu wissen

- **Controller**: Die globale Beenden-Kombination funktioniert mit Xbox-Controllern (XInput) und PlayStation-Controllern (direkt per HID). Switch-Controller brauchen dafür Steam Input. In der Oberfläche selbst funktionieren alle gängigen Controller.
- **Bildschirm „nur TV“** setzt voraus, dass Windows den TV als zweiten Bildschirm erkennt. Klappt es nicht, im Menü → „Bildschirm umschalten“ testen und die Wartezeit in Einstellungen → Anzeige erhöhen.
- **Ton auf den TV**: z. B. mit [NirCmd](https://www.nirsoft.net/utils/nircmd.html): Einstellungen → Anzeige → Befehle beim Start: `nircmd setdefaultsounddevice "LG TV"`.
- Spiel lässt sich nicht per Controller beenden? Bei eigenen Spielen „Beenden per Controller“ auf *Alle Prozesse aus dem Spielordner* oder *Nach Prozessname* stellen.
- Alle Einstellungen liegen in `%APPDATA%\AleGamestation\config.json` (Menü → Einstellungen → Allgemein → „Konfigurationsdatei öffnen“).

## Projektstruktur

```
src/main/        Electron-Hauptprozess
  main.js          Fenster, Konsolenmodus, IPC
  library.js       Steam/Epic/GOG/ROM-Erkennung, Emulator-Autoerkennung
  launcher.js      Spiele starten, überwachen, beenden
  gamepad-watcher.js + xinput-watcher.ps1   globale Controller-Kombinationen
  system.js        Bildschirm umschalten, Herunterfahren
  config.js        Konfiguration mit Standardwerten
src/renderer/    Oberfläche (HTML/CSS/JS, Controller-Navigation)
test/            Tests (npm test)
```
