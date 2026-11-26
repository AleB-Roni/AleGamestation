@echo off
rem AleGamestation OS (USB-Stick): setzt die heruntergeladenen Teile (.part00, .part01 ...) zu einer .img.xz zusammen.
rem Die .img.xz dann mit Rufus oder balenaEtcher auf den USB-Stick schreiben.
cd /d "%~dp0"
setlocal enabledelayedexpansion
set found=0
for %%f in (*.img.xz.part00) do (
  set "name=%%~nf"
  echo Setze !name! zusammen ...
  copy /b "!name!.part*" "!name!" >nul && echo Fertig: !name!
  set found=1
)
if !found!==0 echo Keine Teile gefunden. Lege diese Datei in den Ordner mit den .part00-, .part01- ... Dateien.
pause
