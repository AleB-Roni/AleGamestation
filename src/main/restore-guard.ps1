# AleGamestation – Wächter für plötzliches Beenden (Absturz, Task-Manager, Strom/Neustart der App)
# Läuft unabhängig von AleGamestation (eigener Prozessbaum) und wartet, bis die App weg ist.
# Hat die App den Konsolenmodus nicht sauber beendet (Wiederherstellungsdatei liegt noch da), stellt er zurück:
#   1. die ursprüngliche Bildschirmanordnung (gespeicherter Stand von vor dem Konsolenmodus)
#   2. prüft den Hauptbildschirm und setzt ihn notfalls gezielt zurück
#   3. Tonausgabe und Taskleiste
param([int]$ParentPid, [string]$StateFile, [string]$Helper)
$ErrorActionPreference = 'Continue'
$log = [IO.Path]::ChangeExtension($StateFile, '.log')
function Log($m) { try { Add-Content -LiteralPath $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $m) -Encoding UTF8 } catch {} }

try { $p = Get-Process -Id $ParentPid -ErrorAction Stop; $p.WaitForExit() } catch {}
Start-Sleep -Milliseconds 1500
if (-not (Test-Path -LiteralPath $StateFile)) { exit 0 }   # sauber beendet
try { $st = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { exit 0 }
if ([int]$st.pid -ne $ParentPid) { exit 0 }                # eine neue Instanz ist zuständig
# Datei „übernehmen“, damit ein gleichzeitiger Neustart der App nicht doppelt zurückstellt
$claim = $StateFile + '.restoring'
try { Move-Item -LiteralPath $StateFile -Destination $claim -Force -ErrorAction Stop } catch { exit 0 }
Log "AleGamestation (PID $ParentPid) wurde nicht sauber beendet - stelle zurueck"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'powershell.exe'
$psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$Helper`""
$psi.UseShellExecute = $false; $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.CreateNoWindow = $true
$h = [Diagnostics.Process]::Start($psi)
$script:seq = 0
$script:pending = $null
function Ask([string]$cmd, [int]$timeoutMs = 15000) {
  $script:seq++
  $id = $script:seq
  $h.StandardInput.WriteLine("q $id $cmd"); $h.StandardInput.Flush()
  $until = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $until) {
    # eine noch laufende Leseanfrage weiterverwenden (nach einer Zeitüberschreitung)
    if (-not $script:pending) { $script:pending = $h.StandardOutput.ReadLineAsync() }
    if (-not $script:pending.Wait([int][Math]::Max(1, ($until - (Get-Date)).TotalMilliseconds))) { return '' }
    $line = $script:pending.Result; $script:pending = $null
    if ($line -eq $null) { return '' }
    if ($line -match "^a $id ?(.*)$") { return $Matches[1] }
  }
  return ''
}
function B64([string]$s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }
function Primary() {
  try { $l = Ask 'displays' | ConvertFrom-Json; return @($l | Where-Object { $_.primary -and $_.active -ne $false })[0] } catch { return $null }
}

try {
  if ($st.saved) { Log ("Anordnung wiederherstellen: Code " + (Ask "restore $($st.saved)")); Start-Sleep -Milliseconds 1500 }
  if ($st.primary) {
    for ($i = 0; $i -lt 3; $i++) {
      $now = Primary
      if ($now -and $now.key -eq $st.primary) { Log "Hauptbildschirm ist $($st.primaryName)"; break }
      Log ("Hauptbildschirm zurueck auf $($st.primaryName): Code " + (Ask "primary $(B64 $st.primary)"))
      Start-Sleep -Milliseconds 1500
    }
  }
  if ($st.audioPrev) { Log ("Tonausgabe zurueck: Code " + (Ask "audioset $(B64 $st.audioPrev)" 10000)) }
  $h.StandardInput.WriteLine('taskbar 1'); $h.StandardInput.Flush()
  [void](Ask 'fg' 3000)
} finally {
  try { $h.StandardInput.Close(); if (-not $h.WaitForExit(3000)) { $h.Kill() } } catch {}
  Remove-Item -LiteralPath $claim -Force -ErrorAction SilentlyContinue
  Log 'Fertig'
}
