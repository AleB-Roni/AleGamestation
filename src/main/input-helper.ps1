# AleGamestation – erzeugt Maus- und Tastatureingaben (Windows SendInput).
# Liest Befehle zeilenweise von stdin:
#   m <dx> <dy>      Maus relativ bewegen
#   w <delta>        Mausrad vertikal (120 = eine Raste)
#   h <delta>        Mausrad horizontal
#   b <L|R|M> <1|0>  Maustaste drücken / loslassen
#   k <vk> <1|0>     Taste drücken / loslassen (Virtual-Key-Code)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AgsInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public HARDWAREINPUT hi; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint mapType);

  static void Send(INPUT i) { SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))); }

  public static void Mouse(int dx, int dy, int data, uint flags) {
    INPUT i = new INPUT(); i.type = 0;
    i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.mouseData = data; i.u.mi.dwFlags = flags;
    Send(i);
  }
  public static void Key(ushort vk, bool down) {
    INPUT i = new INPUT(); i.type = 1;
    i.u.ki.wVk = vk;
    i.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
    uint flags = down ? 0u : 2u;
    // Pfeiltasten u.ä. sind "erweiterte" Tasten
    if ((vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B) flags |= 1u;
    i.u.ki.dwFlags = flags;
    Send(i);
  }
}
"@

$btn = @{ 'L' = @(0x2, 0x4); 'R' = @(0x8, 0x10); 'M' = @(0x20, 0x40) }
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'm' { [AgsInput]::Mouse([int]$p[1], [int]$p[2], 0, 0x1) }
      'w' { [AgsInput]::Mouse(0, 0, [int]$p[1], 0x800) }
      'h' { [AgsInput]::Mouse(0, 0, [int]$p[1], 0x1000) }
      'b' { $f = $btn[$p[1]]; if ($f) { [AgsInput]::Mouse(0, 0, 0, $(if ($p[2] -eq '1') { $f[0] } else { $f[1] })) } }
      'k' { [AgsInput]::Key([uint16]$p[1], $p[2] -eq '1') }
    }
  } catch { }
}
