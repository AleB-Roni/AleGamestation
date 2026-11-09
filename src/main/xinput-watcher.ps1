# AleGamestation – globaler XInput-Watcher
# Liest alle 4 XInput-Controller (Xbox-Controller; PlayStation-/Switch-Controller über Steam Input oder DS4Windows)
# und schreibt bei jeder Änderung "index mask" auf stdout. Läuft auch, wenn ein Spiel im Vordergrund ist.
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AgsXInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct GAMEPAD { public ushort wButtons; public byte bLeftTrigger; public byte bRightTrigger; public short sThumbLX; public short sThumbLY; public short sThumbRX; public short sThumbRY; }
  [StructLayout(LayoutKind.Sequential)]
  public struct STATE { public uint dwPacketNumber; public GAMEPAD Gamepad; }

  // Ordinal 100 = XInputGetStateEx (liefert zusätzlich die Guide-/Xbox-Taste)
  [DllImport("xinput1_4.dll", EntryPoint = "#100")] static extern int GetStateEx14(int i, ref STATE s);
  [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")] static extern int GetState14(int i, ref STATE s);
  [DllImport("xinput1_3.dll", EntryPoint = "#100")] static extern int GetStateEx13(int i, ref STATE s);
  [DllImport("xinput9_1_0.dll", EntryPoint = "XInputGetState")] static extern int GetState910(int i, ref STATE s);

  static int mode = 0;
  // Letzte Stick-Werte (-32768..32767), gelesen zusammen mit Read()
  public static int LX, LY, RX, RY;
  public static int Read(int i) {
    STATE s = new STATE();
    int r = -1;
    for (int attempt = 0; attempt < 4; attempt++) {
      try {
        if (mode == 0) r = GetStateEx14(i, ref s);
        else if (mode == 1) r = GetState14(i, ref s);
        else if (mode == 2) r = GetStateEx13(i, ref s);
        else r = GetState910(i, ref s);
        break;
      } catch (Exception) { mode++; if (mode > 3) return -1; }
    }
    if (r != 0) return -1;
    LX = s.Gamepad.sThumbLX; LY = s.Gamepad.sThumbLY; RX = s.Gamepad.sThumbRX; RY = s.Gamepad.sThumbRY;
    int mask = s.Gamepad.wButtons;
    if (s.Gamepad.bLeftTrigger > 120) mask |= 0x10000;
    if (s.Gamepad.bRightTrigger > 120) mask |= 0x20000;
    return mask;
  }
}
"@

$last = @('', '', '', '')
$lastMask = @(-2, -2, -2, -2)
$tick = 0
# Sticks auf 1/32 runden, damit nur echte Bewegungen gemeldet werden
function Q([int]$v) { [Math]::Round($v / 1024) }
while ($true) {
  for ($i = 0; $i -lt 4; $i++) {
    # Nicht verbundene Controller nur selten abfragen (XInput ist bei leeren Slots langsam)
    if ($lastMask[$i] -eq -1 -and ($tick % 60) -ne 0) { continue }
    $m = [AgsXInput]::Read($i)
    $line = if ($m -lt 0) { "$i -1" } else { "$i $m $(Q ([AgsXInput]::LX)) $(Q ([AgsXInput]::LY)) $(Q ([AgsXInput]::RX)) $(Q ([AgsXInput]::RY))" }
    $lastMask[$i] = $m
    if ($line -ne $last[$i]) {
      $last[$i] = $line
      [Console]::Out.WriteLine($line)
      [Console]::Out.Flush()
    }
  }
  $tick++
  Start-Sleep -Milliseconds 12
}
