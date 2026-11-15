# AleGamestation – PlayStation-Controller (DualSense / DualShock 4) per Bluetooth koppeln.
#  1. Gekoppelte, aber NICHT verbundene PS-Controller entfernen (Windows koppelt sie sonst oft nicht neu)
#     – verbundene Controller werden nie angefasst
#  2. Nach Controllern im Kopplungsmodus suchen (PS + Create/Share gedrückt halten, bis das Licht schnell blinkt)
#  3. Gefundene koppeln (Bestätigung wird automatisch angenommen) und den Controller-Dienst (HID) einschalten
# Ausgabe: eine JSON-Zeile pro Schritt, z.B. {"t":"paired","name":"Wireless Controller"}
param([int]$Rounds = 3, [int]$Timeout = 8, [switch]$NoRemove)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

public static class AgsBt {
  [StructLayout(LayoutKind.Sequential)] public struct SYSTEMTIME { public ushort y, m, dow, d, h, mi, s, ms; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct DEVICE_INFO {
    public int dwSize; public ulong Address; public uint ulClassofDevice;
    public int fConnected; public int fRemembered; public int fAuthenticated;
    public SYSTEMTIME stLastSeen; public SYSTEMTIME stLastUsed;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
  }
  [StructLayout(LayoutKind.Sequential)] public struct SEARCH_PARAMS {
    public int dwSize; public int fReturnAuthenticated, fReturnRemembered, fReturnUnknown, fReturnConnected, fIssueInquiry;
    public byte cTimeoutMultiplier; public IntPtr hRadio;
  }
  [StructLayout(LayoutKind.Sequential)] public struct RADIO_PARAMS { public int dwSize; }

  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstRadio(ref RADIO_PARAMS p, out IntPtr hRadio);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindRadioClose(IntPtr h);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern IntPtr BluetoothFindFirstDevice(ref SEARCH_PARAMS p, ref DEVICE_INFO info);
  [DllImport("bthprops.cpl", SetLastError = true)] static extern bool BluetoothFindNextDevice(IntPtr h, ref DEVICE_INFO info);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindDeviceClose(IntPtr h);
  [DllImport("bthprops.cpl")] static extern int BluetoothRemoveDevice(ref ulong address);
  [DllImport("bthprops.cpl")] static extern int BluetoothAuthenticateDeviceEx(IntPtr hwnd, IntPtr hRadio, ref DEVICE_INFO info, IntPtr oob, int authReq);
  [DllImport("bthprops.cpl")] static extern int BluetoothSetServiceState(IntPtr hRadio, ref DEVICE_INFO info, ref Guid service, int flags);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)] public delegate bool AuthCallback(IntPtr param, IntPtr cbParams);
  [DllImport("bthprops.cpl")] static extern int BluetoothRegisterForAuthenticationEx(ref DEVICE_INFO info, out IntPtr hReg, AuthCallback cb, IntPtr param);
  [DllImport("bthprops.cpl")] static extern bool BluetoothUnregisterAuthentication(IntPtr hReg);
  [DllImport("bthprops.cpl")] static extern int BluetoothSendAuthenticationResponseEx(IntPtr hRadio, IntPtr response);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  static IntPtr radio = IntPtr.Zero;
  static Guid HID = new Guid("00001124-0000-1000-8000-00805F9B34FB");

  /** DualSense / DualSense Edge / DualShock 4 (melden sich als „Wireless Controller“) – keine Xbox-Controller */
  public static bool IsPlayStation(string name) {
    if (string.IsNullOrEmpty(name) || Regex.IsMatch(name, "xbox", RegexOptions.IgnoreCase)) return false;
    return Regex.IsMatch(name, "^(dualsense|dualshock|wireless controller)", RegexOptions.IgnoreCase) || Regex.IsMatch(name, "dualsense|dualshock", RegexOptions.IgnoreCase);
  }
  public static string Addr(ulong a) { return a.ToString("X12"); }

  public static bool OpenRadio() {
    RADIO_PARAMS rp = new RADIO_PARAMS(); rp.dwSize = Marshal.SizeOf(typeof(RADIO_PARAMS));
    IntPtr find = BluetoothFindFirstRadio(ref rp, out radio);
    if (find == IntPtr.Zero) return false;
    BluetoothFindRadioClose(find);
    return radio != IntPtr.Zero;
  }

  public static List<DEVICE_INFO> Devices(bool inquiry, byte timeout) {
    var list = new List<DEVICE_INFO>();
    SEARCH_PARAMS sp = new SEARCH_PARAMS();
    sp.dwSize = Marshal.SizeOf(typeof(SEARCH_PARAMS));
    sp.fReturnAuthenticated = 1; sp.fReturnRemembered = 1; sp.fReturnConnected = 1;
    sp.fReturnUnknown = inquiry ? 1 : 0; sp.fIssueInquiry = inquiry ? 1 : 0;
    sp.cTimeoutMultiplier = timeout; sp.hRadio = radio;
    DEVICE_INFO di = new DEVICE_INFO(); di.dwSize = Marshal.SizeOf(typeof(DEVICE_INFO));
    IntPtr h = BluetoothFindFirstDevice(ref sp, ref di);
    if (h == IntPtr.Zero) return list;
    do { list.Add(di); di = new DEVICE_INFO(); di.dwSize = Marshal.SizeOf(typeof(DEVICE_INFO)); } while (BluetoothFindNextDevice(h, ref di));
    BluetoothFindDeviceClose(h);
    return list;
  }

  public static int Remove(ulong address) { ulong a = address; return BluetoothRemoveDevice(ref a); }

  // Kopplungsanfrage automatisch bestätigen (Numerischer Vergleich / „Just Works“ / Passkey-Anzeige)
  static bool OnAuth(IntPtr param, IntPtr p) {
    // BLUETOOTH_AUTHENTICATION_CALLBACK_PARAMS: DEVICE_INFO (560 Bytes), Methode, IO-Fähigkeit, Anforderungen, Zahl
    int infoSize = Marshal.SizeOf(typeof(DEVICE_INFO));
    ulong address = (ulong)Marshal.ReadInt64(p, 8);
    int method = Marshal.ReadInt32(p, infoSize);
    int numeric = Marshal.ReadInt32(p, infoSize + 12);
    IntPtr resp = Marshal.AllocHGlobal(48);
    try {
      for (int i = 0; i < 48; i++) Marshal.WriteByte(resp, i, 0);
      Marshal.WriteInt64(resp, 0, (long)address);   // bthAddressRemote
      Marshal.WriteInt32(resp, 8, method);           // authMethod
      Marshal.WriteInt32(resp, 12, numeric);         // numericCompInfo / passkeyInfo
      Marshal.WriteByte(resp, 44, 0);                // negativeResponse = nein → annehmen
      BluetoothSendAuthenticationResponseEx(radio, resp);
    } finally { Marshal.FreeHGlobal(resp); }
    return true;
  }
  static AuthCallback cb = OnAuth; // nicht vom GC einsammeln lassen

  public static int Pair(DEVICE_INFO d) {
    IntPtr reg;
    int rr = BluetoothRegisterForAuthenticationEx(ref d, out reg, cb, IntPtr.Zero);
    int r = BluetoothAuthenticateDeviceEx(IntPtr.Zero, radio, ref d, IntPtr.Zero, 0); // MITMProtectionNotRequired
    if (rr == 0 && reg != IntPtr.Zero) BluetoothUnregisterAuthentication(reg);
    if (r != 0) return r;
    // Controller-Dienst (HID) einschalten – sonst ist er gekoppelt, aber nicht nutzbar
    int s = BluetoothSetServiceState(radio, ref d, ref HID, 1);
    return s == 0 || s == 0x2B5 /* schon aktiv */ ? 0 : s;
  }
}
"@

function Out-Step($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress)); [Console]::Out.Flush() }

if (-not [AgsBt]::OpenRadio()) { Out-Step @{ t = 'radio'; ok = $false }; exit 0 }
Out-Step @{ t = 'radio'; ok = $true }

# 1. Gekoppelte, aber nicht verbundene PS-Controller entfernen – verbundene bleiben
$removed = 0
foreach ($d in [AgsBt]::Devices($false, 1)) {
  if (-not [AgsBt]::IsPlayStation($d.szName)) { continue }
  if ($d.fConnected -ne 0) { Out-Step @{ t = 'connected'; name = $d.szName; addr = [AgsBt]::Addr($d.Address) }; continue }
  if ($NoRemove) { continue }
  $r = [AgsBt]::Remove($d.Address)
  if ($r -eq 0) { $removed++ }
  Out-Step @{ t = 'removed'; name = $d.szName; addr = [AgsBt]::Addr($d.Address); code = $r }
}

# 2./3. Suchen und koppeln
$paired = 0; $failed = 0
for ($round = 1; $round -le $Rounds; $round++) {
  Out-Step @{ t = 'searching'; round = $round; rounds = $Rounds }
  $found = @([AgsBt]::Devices($true, [byte]$Timeout) | Where-Object { [AgsBt]::IsPlayStation($_.szName) -and $_.fConnected -eq 0 -and $_.fAuthenticated -eq 0 })
  foreach ($d in $found) {
    Out-Step @{ t = 'found'; name = $d.szName; addr = [AgsBt]::Addr($d.Address) }
    $r = [AgsBt]::Pair($d)
    if ($r -eq 0) { $paired++; Out-Step @{ t = 'paired'; name = $d.szName; addr = [AgsBt]::Addr($d.Address) } }
    else { $failed++; Out-Step @{ t = 'failed'; name = $d.szName; addr = [AgsBt]::Addr($d.Address); code = $r } }
  }
  if ($paired -gt 0) { break }
}
Out-Step @{ t = 'done'; paired = $paired; removed = $removed; failed = $failed }
