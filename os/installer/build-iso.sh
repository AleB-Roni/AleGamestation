#!/usr/bin/bash
# Baut den AleGamestation-OS-Netz-Installer aus dem neuesten Fedora-Everything-netinst-ISO.
#   build-iso.sh <abbild> <ausgabe.iso>
#   z.B. build-iso.sh ghcr.io/aleb-roni/alegamestation-os:stable dist/AleGamestation-OS-Installer.iso
# Läuft in einem Fedora-Container (braucht mkksiso aus „lorax“, xorriso, cpio).
#
# Damit der Installer auch von Ventoy, Rufus im ISO-Modus u.ä. startet, braucht er den USB-Stick nach dem
# Booten nicht mehr:
#   - Kickstart steckt im Start-Abbild (initrd) → inst.ks=file:/alegamestation.ks
#   - der Rest des Installers (stage2) kommt aus dem Internet, von Fedora, passend zur Version des ISOs
# (Internet braucht der Netz-Installer ohnehin, um AleGamestation OS zu laden.)
set -euo pipefail
IMAGE="$1"; OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Neuestes Fedora-Release mit netinst-ISO finden
BASE=https://dl.fedoraproject.org/pub/fedora/linux/releases
ISO_URL=""; REL=""
for v in $(curl -fsSL "$BASE/" | grep -oE 'href="[0-9]+/"' | grep -oE '[0-9]+' | sort -rn); do
  name="$(curl -fsSL "$BASE/$v/Everything/x86_64/iso/" 2>/dev/null | grep -oE 'Fedora-Everything-netinst-x86_64-[0-9.-]+\.iso' | head -1 || true)"
  if [ -n "$name" ]; then ISO_URL="$BASE/$v/Everything/x86_64/iso/$name"; REL="$v"; break; fi
done
[ -n "$ISO_URL" ] || { echo "Kein Fedora-netinst-ISO gefunden" >&2; exit 1; }
STAGE2="$BASE/$REL/Everything/x86_64/os/"
curl -fsI "${STAGE2}images/install.img" >/dev/null || { echo "Installer-Abbild (stage2) nicht erreichbar: $STAGE2" >&2; exit 1; }
echo "Basis: $ISO_URL"
echo "stage2: $STAGE2"
curl -fL --retry 3 -o "$WORK/base.iso" "$ISO_URL"

# 1. Kickstart ins Start-Abbild (initrd): zusätzliches cpio-Archiv anhängen (der Kernel entpackt alle nacheinander)
sed "s|@IMAGE@|$IMAGE|g" "$HERE/alegamestation.ks" > "$WORK/alegamestation.ks"
xorriso -osirrox on -indev "$WORK/base.iso" -extract /images/pxeboot/initrd.img "$WORK/initrd.img" 2>/dev/null
mkdir -p "$WORK/ksroot"
cp "$WORK/alegamestation.ks" "$WORK/ksroot/alegamestation.ks"
(cd "$WORK/ksroot" && echo alegamestation.ks | cpio -o -H newc --quiet) > "$WORK/ks.cpio"
cat "$WORK/initrd.img" "$WORK/ks.cpio" > "$WORK/initrd-ags.img"

# 2. Startparameter: stage2 aus dem Internet, Kickstart aus dem initrd (Datenträgername spielt keine Rolle mehr)
mkksiso -r "inst.stage2 inst.ks" -c "inst.stage2=$STAGE2 inst.ks=file:/alegamestation.ks" "$WORK/base.iso" "$WORK/step.iso"
# 3. Erweitertes initrd ins ISO
mkdir -p "$(dirname "$OUT")"
xorriso -indev "$WORK/step.iso" -outdev "$OUT" -boot_image any replay \
  -map "$WORK/initrd-ags.img" /images/pxeboot/initrd.img \
  -map "$WORK/alegamestation.ks" /alegamestation.ks 2>&1 | grep -vE '^xorriso : UPDATE' || true

# Prüfen: Startparameter und Kickstart im initrd
xorriso -osirrox on -indev "$OUT" -extract /EFI/BOOT/grub.cfg "$WORK/grub.cfg" 2>/dev/null
grep -q "inst.ks=file:/alegamestation.ks" "$WORK/grub.cfg" || { echo "Startparameter fehlen in grub.cfg" >&2; exit 1; }
grep -q "inst.stage2=$STAGE2" "$WORK/grub.cfg" || { echo "stage2-Adresse fehlt in grub.cfg" >&2; exit 1; }
xorriso -osirrox on -indev "$OUT" -extract /images/pxeboot/initrd.img "$WORK/check-initrd.img" 2>/dev/null
cmp -s "$WORK/check-initrd.img" "$WORK/initrd-ags.img" || { echo "initrd wurde nicht ersetzt" >&2; exit 1; }
grep -A3 "linux" "$WORK/grub.cfg" | head -4
ls -la "$OUT"
