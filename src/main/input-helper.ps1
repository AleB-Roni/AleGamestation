# AleGamestation – erzeugt Maus- und Tastatureingaben (Windows SendInput).
# Liest Befehle zeilenweise von stdin:
#   m <dx> <dy>      Maus relativ bewegen
#   w <delta>        Mausrad vertikal (120 = eine Raste)
#   h <delta>        Mausrad horizontal
#   b <L|R|M> <1|0>  Maustaste drücken / loslassen
#   k <vk> <1|0>     Taste drücken / loslassen (Virtual-Key-Code)
#   front <hwnd> <1|0>  Fenster in den Vordergrund holen (trotz Windows-Fokus-Sperre), 1 = ganz oben fixieren
#   top <hwnd>       Fenster ganz nach oben legen, ohne Fokus (für Einblendungen)
#   q <id> fg        Anfrage: aktuelles Vordergrundfenster -> Antwort "a <id> <hwnd>"
#   q <id> displays        Anfrage: alle angeschlossenen Bildschirme als JSON (Windows-Anzeigekonfiguration)
#   q <id> tvonly <b64>    Nur diesen Bildschirm verwenden (Kennung Base64) -> Ergebniscode (0 = ok)
#   q <id> primary <b64>   Diesen Bildschirm zum Hauptbildschirm machen, andere bleiben an -> Ergebniscode
#   q <id> save            Aktuelle Anordnung sichern -> Base64
#   q <id> restore <b64>   Gesicherte Anordnung wiederherstellen -> Ergebniscode
#   q <id> extend          Alle Bildschirme erweitern -> Ergebniscode
#   q <id> pidinfo <hwnd>  Prozess eines Fensters -> "pid name"
#   q <id> suspend <pid>   Prozess anhalten (Spiel-Pause im Overlay) -> 0 = ok
#   q <id> resume <pid>    Prozess fortsetzen -> 0 = ok
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
    if ((vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || (vk >= 0xA6 && vk <= 0xB7)) flags |= 1u; // inkl. Medien-/Lautstärketasten
    i.u.ki.dwFlags = flags;
    Send(i);
  }

  // ---------- Fenster in den Vordergrund (für Overlay über Vollbild-Spielen) ----------
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  public static long Fg() { return GetForegroundWindow().ToInt64(); }

  public static bool Front(long hwnd, bool topmost) {
    IntPtr h = new IntPtr(hwnd);
    if (!IsWindow(h)) return false;
    IntPtr fg = GetForegroundWindow();
    uint pid;
    uint fgThread = GetWindowThreadProcessId(fg, out pid);
    uint me = GetCurrentThreadId();
    // Kurzer ALT-Tastendruck: Windows erlaubt danach SetForegroundWindow (Fokus-Sperre)
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE (z.B. minimiertes Vollbild-Spiel)
    else ShowWindow(h, 5);              // SW_SHOW
    // HWND_TOPMOST = -1, HWND_TOP = 0; SWP_NOSIZE|SWP_NOMOVE|SWP_SHOWWINDOW
    SetWindowPos(h, topmost ? new IntPtr(-1) : IntPtr.Zero, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040);
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    return ok;
  }

  // ---------- Bildschirme über die Windows-Anzeigekonfiguration (wie Win + P) ----------
  // Kennt den echten Monitornamen (z.B. "LG TV SSCR2") und eine feste Geräte-ID, auch für gerade ausgeschaltete Bildschirme.
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_SOURCE { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_TARGET {
    public LUID adapterId; public uint id; public uint modeInfoIdx; public uint outputTechnology; public uint rotation; public uint scaling;
    public uint refreshNum; public uint refreshDen; public uint scanLineOrdering; public int targetAvailable; public uint statusFlags;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_INFO { public PATH_SOURCE source; public PATH_TARGET target; public uint flags; }
  [StructLayout(LayoutKind.Explicit, Size = 64)] public struct MODE_INFO {
    [FieldOffset(0)] public uint infoType; [FieldOffset(4)] public uint id; [FieldOffset(8)] public LUID adapterId;
    // Quell-Modus (infoType 1): Größe und Position auf dem Desktop
    [FieldOffset(16)] public uint width; [FieldOffset(20)] public uint height; [FieldOffset(24)] public uint pixelFormat;
    [FieldOffset(28)] public int x; [FieldOffset(32)] public int y;
  }
  [StructLayout(LayoutKind.Sequential)] public struct DI_HEADER { public uint type; public uint size; public LUID adapterId; public uint id; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SOURCE_NAME {
    public DI_HEADER header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string viewGdiDeviceName;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct TARGET_NAME {
    public DI_HEADER header; public uint flags; public uint outputTechnology; public ushort edidManufactureId; public ushort edidProductCodeId; public uint connectorInstance;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string monitorFriendlyDeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string monitorDevicePath;
  }
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPaths, out uint numModes);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint numPaths, [Out] PATH_INFO[] paths, ref uint numModes, [Out] MODE_INFO[] modes, IntPtr topology);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref SOURCE_NAME req);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref TARGET_NAME req);
  [DllImport("user32.dll")] static extern int SetDisplayConfig(uint numPaths, PATH_INFO[] paths, uint numModes, MODE_INFO[] modes, uint flags);

  const uint QDC_ALL = 1, QDC_ACTIVE = 2, PATH_ACTIVE = 1, INVALID = 0xFFFFFFFF;
  const uint SDC_APPLY = 0x80, SDC_SUPPLIED = 0x20, SDC_SAVE = 0x200, SDC_ALLOW_CHANGES = 0x400, SDC_EXTEND = 0x4;
  const uint SET_FLAGS = SDC_APPLY | SDC_SUPPLIED | SDC_SAVE | SDC_ALLOW_CHANGES;

  static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\""); }

  static bool Query(uint flags, out PATH_INFO[] paths, out MODE_INFO[] modes) {
    paths = new PATH_INFO[0]; modes = new MODE_INFO[0];
    for (int tries = 0; tries < 5; tries++) {
      uint np, nm;
      if (GetDisplayConfigBufferSizes(flags, out np, out nm) != 0) return false;
      paths = new PATH_INFO[np]; modes = new MODE_INFO[nm];
      int r = QueryDisplayConfig(flags, ref np, paths, ref nm, modes, IntPtr.Zero);
      if (r == 0) { Array.Resize(ref paths, (int)np); Array.Resize(ref modes, (int)nm); return true; }
      if (r != 122) return false; // ERROR_INSUFFICIENT_BUFFER: Konfiguration hat sich gerade geändert
    }
    return false;
  }

  static TARGET_NAME TargetName(PATH_TARGET t) {
    TARGET_NAME n = new TARGET_NAME();
    n.header.type = 2; n.header.size = (uint)Marshal.SizeOf(typeof(TARGET_NAME)); n.header.adapterId = t.adapterId; n.header.id = t.id;
    if (DisplayConfigGetDeviceInfo(ref n) != 0) { n.monitorFriendlyDeviceName = ""; n.monitorDevicePath = ""; }
    return n;
  }
  static string SourceName(PATH_SOURCE s) {
    SOURCE_NAME n = new SOURCE_NAME();
    n.header.type = 1; n.header.size = (uint)Marshal.SizeOf(typeof(SOURCE_NAME)); n.header.adapterId = s.adapterId; n.header.id = s.id;
    return DisplayConfigGetDeviceInfo(ref n) == 0 ? n.viewGdiDeviceName : "";
  }
  /** Feste Kennung eines Bildschirms (Gerätepfad des Monitors), notfalls Adapter + Anschluss */
  static string KeyOf(PATH_TARGET t) {
    string p = TargetName(t).monitorDevicePath;
    return string.IsNullOrEmpty(p) ? ("t:" + t.adapterId.Low + ":" + t.adapterId.High + ":" + t.id) : p;
  }
  static int Find(PATH_INFO[] paths, string key) {
    for (int i = 0; i < paths.Length; i++) if (string.Equals(KeyOf(paths[i].target), key, StringComparison.OrdinalIgnoreCase)) return i;
    return -1;
  }

  /** Alle angeschlossenen Bildschirme (auch ausgeschaltete) als JSON */
  public static string Displays() {
    PATH_INFO[] all, act; MODE_INFO[] allModes, modes;
    if (!Query(QDC_ACTIVE, out act, out modes)) return "[]";
    if (!Query(QDC_ALL, out all, out allModes)) all = new PATH_INFO[0];
    var keys = new System.Collections.Generic.List<string>();
    var sb = new System.Text.StringBuilder("[");
    foreach (PATH_INFO p in act) {
      string key = KeyOf(p.target);
      if (keys.Contains(key)) continue;
      keys.Add(key);
      TARGET_NAME tn = TargetName(p.target);
      int x = 0, y = 0; uint w = 0, h = 0;
      if (p.source.modeInfoIdx != INVALID && p.source.modeInfoIdx < modes.Length && modes[p.source.modeInfoIdx].infoType == 1) {
        MODE_INFO m = modes[p.source.modeInfoIdx]; x = m.x; y = m.y; w = m.width; h = m.height;
      }
      uint hz = p.target.refreshDen > 0 ? (uint)Math.Round((double)p.target.refreshNum / p.target.refreshDen) : 0;
      if (sb.Length > 1) sb.Append(",");
      sb.AppendFormat("{{\"key\":\"{0}\",\"name\":\"{1}\",\"device\":\"{2}\",\"active\":true,\"x\":{3},\"y\":{4},\"w\":{5},\"h\":{6},\"hz\":{7},\"primary\":{8},\"tech\":{9}}}",
        Esc(key), Esc(tn.monitorFriendlyDeviceName), Esc(SourceName(p.source)), x, y, w, h, hz, (x == 0 && y == 0) ? "true" : "false", p.target.outputTechnology);
    }
    foreach (PATH_INFO p in all) {
      if (p.target.targetAvailable == 0) continue;
      string key = KeyOf(p.target);
      if (keys.Contains(key)) continue;
      keys.Add(key);
      TARGET_NAME tn = TargetName(p.target);
      if (sb.Length > 1) sb.Append(",");
      sb.AppendFormat("{{\"key\":\"{0}\",\"name\":\"{1}\",\"device\":\"\",\"active\":false,\"x\":0,\"y\":0,\"w\":0,\"h\":0,\"hz\":0,\"primary\":false,\"tech\":{2}}}",
        Esc(key), Esc(tn.monitorFriendlyDeviceName), p.target.outputTechnology);
    }
    return sb.Append("]").ToString();
  }

  /** Ausgeschalteten Bildschirm zusätzlich einschalten (erweitern); Windows wählt Auflösung und Position */
  static int Activate(string key) {
    PATH_INFO[] act, all; MODE_INFO[] modes, allModes;
    if (!Query(QDC_ACTIVE, out act, out modes) || !Query(QDC_ALL, out all, out allModes)) return -102;
    if (Find(act, key) >= 0) return 0;
    for (int i = 0; i < all.Length; i++) {
      PATH_INFO p = all[i];
      if (p.target.targetAvailable == 0 || !string.Equals(KeyOf(p.target), key, StringComparison.OrdinalIgnoreCase)) continue;
      bool used = false; // jede Quelle darf nur von einem aktiven Pfad genutzt werden
      foreach (PATH_INFO a in act) if (a.source.id == p.source.id && a.source.adapterId.Low == p.source.adapterId.Low && a.source.adapterId.High == p.source.adapterId.High) used = true;
      if (used) continue;
      p.flags = PATH_ACTIVE; p.source.modeInfoIdx = INVALID; p.target.modeInfoIdx = INVALID;
      PATH_INFO[] next = new PATH_INFO[act.Length + 1];
      Array.Copy(act, next, act.Length);
      next[act.Length] = p;
      int r = SetDisplayConfig((uint)next.Length, next, (uint)modes.Length, modes, SET_FLAGS);
      if (r == 0) return 0;
    }
    return -100;
  }

  /** Nur diesen Bildschirm verwenden (alle anderen aus); er wird damit automatisch Hauptbildschirm */
  public static int TvOnly(string key) {
    PATH_INFO[] act; MODE_INFO[] modes;
    if (!Query(QDC_ACTIVE, out act, out modes)) return -102;
    int ti = Find(act, key);
    if (ti < 0) {
      int r = Activate(key);
      if (r != 0) return r;
      if (!Query(QDC_ACTIVE, out act, out modes)) return -102;
      ti = Find(act, key);
      if (ti < 0) return -100;
    }
    PATH_INFO p = act[ti];
    var list = new System.Collections.Generic.List<MODE_INFO>();
    if (p.source.modeInfoIdx != INVALID && p.source.modeInfoIdx < modes.Length) {
      MODE_INFO m = modes[p.source.modeInfoIdx]; m.x = 0; m.y = 0; list.Add(m); p.source.modeInfoIdx = 0;
    }
    if (p.target.modeInfoIdx != INVALID && p.target.modeInfoIdx < modes.Length) {
      list.Add(modes[p.target.modeInfoIdx]); p.target.modeInfoIdx = (uint)(list.Count - 1);
    }
    return SetDisplayConfig(1, new PATH_INFO[] { p }, (uint)list.Count, list.ToArray(), SET_FLAGS);
  }

  /** Bildschirm zum Hauptbildschirm machen, alle anderen bleiben an (ausgeschalteter TV wird dazugeschaltet) */
  public static int SetPrimary(string key) {
    int r = Activate(key);
    if (r != 0) return r;
    PATH_INFO[] act; MODE_INFO[] modes;
    if (!Query(QDC_ACTIVE, out act, out modes)) return -102;
    int ti = Find(act, key);
    if (ti < 0) return -100;
    uint si = act[ti].source.modeInfoIdx;
    if (si == INVALID || si >= modes.Length) return -103;
    int dx = modes[si].x, dy = modes[si].y;
    if (dx == 0 && dy == 0) return 0;
    for (int i = 0; i < modes.Length; i++) if (modes[i].infoType == 1) { modes[i].x -= dx; modes[i].y -= dy; }
    return SetDisplayConfig((uint)act.Length, act, (uint)modes.Length, modes, SET_FLAGS);
  }

  /** Alle Bildschirme erweitern (wie Win + P → Erweitern) */
  public static int Extend() { return SetDisplayConfig(0, null, 0, null, SDC_APPLY | SDC_EXTEND); }

  static byte[] ToBytes<T>(T[] arr) where T : struct {
    int sz = Marshal.SizeOf(typeof(T));
    byte[] b = new byte[sz * arr.Length];
    IntPtr ptr = Marshal.AllocHGlobal(sz);
    try { for (int i = 0; i < arr.Length; i++) { Marshal.StructureToPtr(arr[i], ptr, false); Marshal.Copy(ptr, b, i * sz, sz); } }
    finally { Marshal.FreeHGlobal(ptr); }
    return b;
  }
  static T[] FromBytes<T>(byte[] b, int offset, int count) where T : struct {
    int sz = Marshal.SizeOf(typeof(T));
    T[] arr = new T[count];
    IntPtr ptr = Marshal.AllocHGlobal(sz);
    try { for (int i = 0; i < count; i++) { Marshal.Copy(b, offset + i * sz, ptr, sz); arr[i] = (T)Marshal.PtrToStructure(ptr, typeof(T)); } }
    finally { Marshal.FreeHGlobal(ptr); }
    return arr;
  }

  /** Aktuelle Anordnung sichern (Base64), um sie beim Beenden exakt wiederherzustellen */
  public static string Save() {
    PATH_INFO[] act; MODE_INFO[] modes;
    if (!Query(QDC_ACTIVE, out act, out modes)) return "";
    byte[] p = ToBytes(act), m = ToBytes(modes);
    byte[] all = new byte[8 + p.Length + m.Length];
    BitConverter.GetBytes(act.Length).CopyTo(all, 0);
    BitConverter.GetBytes(modes.Length).CopyTo(all, 4);
    p.CopyTo(all, 8); m.CopyTo(all, 8 + p.Length);
    return Convert.ToBase64String(all);
  }
  public static int Restore(string b64) {
    byte[] all = Convert.FromBase64String(b64);
    int np = BitConverter.ToInt32(all, 0), nm = BitConverter.ToInt32(all, 4);
    PATH_INFO[] paths = FromBytes<PATH_INFO>(all, 8, np);
    MODE_INFO[] modes = FromBytes<MODE_INFO>(all, 8 + np * Marshal.SizeOf(typeof(PATH_INFO)), nm);
    return SetDisplayConfig((uint)np, paths, (uint)nm, modes, SET_FLAGS);
  }

  // ---------- Spiel anhalten, solange das Overlay offen ist ----------
  [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtResumeProcess(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  /** Prozess zu einem Fenster: "pid name" */
  public static string PidInfo(long hwnd) {
    uint pid;
    GetWindowThreadProcessId(new IntPtr(hwnd), out pid);
    if (pid == 0) return "";
    string name = "";
    try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch { }
    return pid + " " + name;
  }
  /** Prozess anhalten (resume = false) oder fortsetzen; 0 = ok */
  public static int Suspend(uint pid, bool resume) {
    IntPtr h = OpenProcess(0x0800, false, pid); // PROCESS_SUSPEND_RESUME
    if (h == IntPtr.Zero) return -1;
    int r = resume ? NtResumeProcess(h) : NtSuspendProcess(h);
    CloseHandle(h);
    return r;
  }

  public static void Top(long hwnd) {
    // ganz oben, ohne Fokus: SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE|SWP_SHOWWINDOW
    SetWindowPos(new IntPtr(hwnd), new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040);
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
      'front' { [void][AgsInput]::Front([long]$p[1], $p[2] -eq '1') }
      'top' { [AgsInput]::Top([long]$p[1]) }
      'q' {
        $v = ''
        if ($p[2] -eq 'fg') { $v = [AgsInput]::Fg() }
        elseif ($p[2] -eq 'displays') { $v = [AgsInput]::Displays() }
        elseif ($p[2] -eq 'tvonly') { $v = [AgsInput]::TvOnly([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[3]))) }
        elseif ($p[2] -eq 'primary') { $v = [AgsInput]::SetPrimary([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[3]))) }
        elseif ($p[2] -eq 'save') { $v = [AgsInput]::Save() }
        elseif ($p[2] -eq 'restore') { $v = [AgsInput]::Restore($p[3]) }
        elseif ($p[2] -eq 'extend') { $v = [AgsInput]::Extend() }
        elseif ($p[2] -eq 'pidinfo') { $v = [AgsInput]::PidInfo([long]$p[3]) }
        elseif ($p[2] -eq 'suspend') { $v = [AgsInput]::Suspend([uint32]$p[3], $false) }
        elseif ($p[2] -eq 'resume') { $v = [AgsInput]::Suspend([uint32]$p[3], $true) }
        [Console]::Out.WriteLine("a $($p[1]) $v"); [Console]::Out.Flush()
      }
    }
  } catch { }
}
