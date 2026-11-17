#!/usr/bin/bash
# Baut den AleGamestation-OS-Netz-Installer: neuestes Fedora-Everything-netinst-ISO + Kickstart (mkksiso).
#   build-iso.sh <abbild> <ausgabe.iso>
#   z.B. build-iso.sh ghcr.io/aleb-roni/alegamestation-os:stable dist/AleGamestation-OS-Installer.iso
# Läuft in einem Fedora-Container (braucht mkksiso aus „lorax“).
set -euo pipefail
IMAGE="$1"; OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Neuestes Fedora-Release mit netinst-ISO finden
BASE=https://dl.fedoraproject.org/pub/fedora/linux/releases
ISO_URL=""
for v in $(curl -fsSL "$BASE/" | grep -oE 'href="[0-9]+/"' | grep -oE '[0-9]+' | sort -rn); do
  name="$(curl -fsSL "$BASE/$v/Everything/x86_64/iso/" 2>/dev/null | grep -oE 'Fedora-Everything-netinst-x86_64-[0-9.-]+\.iso' | head -1 || true)"
  if [ -n "$name" ]; then ISO_URL="$BASE/$v/Everything/x86_64/iso/$name"; break; fi
done
[ -n "$ISO_URL" ] || { echo "Kein Fedora-netinst-ISO gefunden" >&2; exit 1; }
echo "Basis: $ISO_URL"
curl -fL --retry 3 -o "$WORK/base.iso" "$ISO_URL"

sed "s|@IMAGE@|$IMAGE|g" "$HERE/alegamestation.ks" > "$WORK/alegamestation.ks"
mkdir -p "$(dirname "$OUT")"
# -V: Datenträgername (max. 32 Zeichen) – Kickstart wird automatisch eingebunden (inst.ks)
mkksiso --ks "$WORK/alegamestation.ks" -V "AleGamestation-OS" "$WORK/base.iso" "$OUT"
ls -la "$OUT"
