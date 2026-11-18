#!/usr/bin/bash
# Beim Bauen des Abbilds: KWin-Einstellungen für AleGamestation ergänzen (bestehende Bazzite-Einstellungen bleiben)
#  - Fenster-Regel: AleGamestation darf sich ohne Fokus-Sperre nach vorne holen
#  - X11-Apps (AleGamestation läuft über XWayland) bekommen Tastenkombinationen auch, wenn ein anderes Fenster aktiv ist
set -euo pipefail
DIR="${1:-/etc/xdg}"
K=kwriteconfig6; R=kreadconfig6
"$K" --file "$DIR/kwinrc" --group Xwayland --key XwaylandEavesdrops Combinations
"$K" --file "$DIR/kwinrulesrc" --group alegamestation --key Description "AleGamestation: nach vorne holen erlauben"
"$K" --file "$DIR/kwinrulesrc" --group alegamestation --key wmclass "alegamestation"
"$K" --file "$DIR/kwinrulesrc" --group alegamestation --key wmclassmatch 1
"$K" --file "$DIR/kwinrulesrc" --group alegamestation --key fsplevel 0
"$K" --file "$DIR/kwinrulesrc" --group alegamestation --key fsplevelrule 2
rules="$("$R" --file "$DIR/kwinrulesrc" --group General --key rules)"
case ",$rules," in *,alegamestation,*) ;; *) rules="${rules:+$rules,}alegamestation" ;; esac
"$K" --file "$DIR/kwinrulesrc" --group General --key rules "$rules"
"$K" --file "$DIR/kwinrulesrc" --group General --key count "$(echo "$rules" | tr ',' '\n' | grep -c .)"
