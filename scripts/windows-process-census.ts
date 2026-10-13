// Documented Toolhelp snapshot layout; executable-name bytes are never decoded or retained.
export const windowsProcessCensus = `
$ErrorActionPreference='Stop';
[Console]::Error.WriteLine('oc-census:started');
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Runtime.InteropServices;
namespace OpenCareers {
  public class ProcessRecord {
    public uint pid;
    public uint ppid;
    public string start;
    public ulong rss;
  }
  public static class ProcessCensus {
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint low; public uint high; }
    [StructLayout(LayoutKind.Sequential)] struct Memory {
      public uint cb, faults;
      public UIntPtr peakWorkingSet, workingSet, peakPaged, paged, peakNonPaged, nonPaged, pagefile, peakPagefile;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool Process32FirstW(IntPtr snapshot, IntPtr entry);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool Process32NextW(IntPtr snapshot, IntPtr entry);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FileTime created, out FileTime exited, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool K32GetProcessMemoryInfo(IntPtr process, ref Memory counters, uint size);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static ProcessRecord[] Read() {
      long snapshotAt = DateTime.UtcNow.Ticks;
      IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
      if (snapshot == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      Console.Error.WriteLine("oc-census:snapshot_created");
      int size = IntPtr.Size == 8 ? 568 : 556;
      int parentOffset = IntPtr.Size == 8 ? 32 : 24;
      IntPtr entry = IntPtr.Zero;
      try {
        entry = Marshal.AllocHGlobal(size);
        Marshal.WriteInt32(entry, size);
        var records = new List<ProcessRecord>();
        if (!Process32FirstW(snapshot, entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
        int count = 0;
        do {
          if (++count > 20000) throw new InvalidOperationException("Process census exceeded its bound.");
          uint pid = unchecked((uint)Marshal.ReadInt32(entry, 8));
          uint parent = unchecked((uint)Marshal.ReadInt32(entry, parentOffset));
          if (pid == 0) continue;
          // Query-only rights: no memory reads, debug privilege or path/command-line inspection.
          IntPtr process = OpenProcess(0x1000, false, pid);
          if (process == IntPtr.Zero) continue;
          try {
            FileTime born, exited, kernel, user;
            var memory = new Memory();
            memory.cb = (uint)Marshal.SizeOf(typeof(Memory));
            if (!GetProcessTimes(process, out born, out exited, out kernel, out user) ||
                !K32GetProcessMemoryInfo(process, ref memory, memory.cb)) continue;
            long ticks = DateTime.FromFileTimeUtc(((long)born.high << 32) | born.low).Ticks;
            // A reused PID born after the snapshot cannot inherit its previous entry's parent.
            if (ticks > snapshotAt) continue;
            records.Add(new ProcessRecord {pid=pid, ppid=parent, start=ticks.ToString(CultureInfo.InvariantCulture), rss=memory.workingSet.ToUInt64()});
          } finally { CloseHandle(process); }
        } while (Process32NextW(snapshot, entry));
        int error = Marshal.GetLastWin32Error();
        if (error != 18) throw new Win32Exception(error);
        Console.Error.WriteLine("oc-census:enumerated");
        return records.ToArray();
      } finally {
        if (entry != IntPtr.Zero) Marshal.FreeHGlobal(entry);
        CloseHandle(snapshot);
      }
    }
  }
}
'@;
[Console]::Error.WriteLine('oc-census:compiled');
$records=@([OpenCareers.ProcessCensus]::Read()); ConvertTo-Json -InputObject $records -Depth 3 -Compress;
[Console]::Error.WriteLine('oc-census:serialized');
`;
