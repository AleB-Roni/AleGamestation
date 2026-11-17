# AleGamestation OS – Netz-Installer (Fedora-Installer „Anaconda“)
# Festplatte und Benutzer wählst du im Installer selbst; das System wird direkt aus der
# GitHub Container Registry installiert (Internet nötig) und aktualisiert sich später von dort.
# @IMAGE@ wird beim Bauen ersetzt (alegamestation-os bzw. alegamestation-os-nvidia).

lang de_DE.UTF-8
keyboard --vckeymap=de --xlayouts='de'
timezone Europe/Berlin --utc
network --bootproto=dhcp --device=link --activate

# Das eigentliche System: AleGamestation OS (bootc-Abbild)
ostreecontainer --url=@IMAGE@ --transport=registry --no-signature-verification

# Hauptbenutzer in „wheel“: automatische Anmeldung im Spielmodus, Desktop-Wechsel und Updates ohne Passwort
%post --log=/root/alegamestation-install.log
set -x
# Kein Benutzer im Installer angelegt? Dann Standardbenutzer „spieler“ (Passwort: alegamestation) –
# sonst gibt es niemanden, der automatisch angemeldet werden kann
if ! awk -F: '$3>=1000 && $3<60000 {f=1} END {exit !f}' /etc/passwd; then
  useradd -m -u 1000 -G wheel -c "Spieler" spieler
  echo 'spieler:alegamestation' | chpasswd
fi
for u in $(awk -F: '$3>=1000 && $3<60000 {print $1}' /etc/passwd); do
  usermod -aG wheel "$u" || true
done
echo "@IMAGE@" > /etc/alegamestation-image
%end

# Secure Boot: Schlüssel des Bazzite-Kernels zur Registrierung vormerken
# (beim nächsten Start blauer Bildschirm „MOK management“ → Enroll MOK → Passwort: universalblue)
%post --nochroot --log=/mnt/sysroot/root/alegamestation-secureboot.log
set -x
[ -d /sys/firmware/efi ] || exit 0
command -v mokutil >/dev/null || exit 0
mokutil --sb-state 2>/dev/null | grep -qi enabled || exit 0
KEY="$(find /mnt/sysroot/ostree/deploy -path '*/usr/share/ublue-os/sb_pubkey.der' 2>/dev/null | head -1)"
[ -n "$KEY" ] || exit 0
mokutil --timeout -1 || true
printf 'universalblue\nuniversalblue\n' | mokutil --import "$KEY" || true
%end
