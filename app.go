package main

import (
	"context"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/load"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

type App struct {
	ctx         context.Context
	lastNet     map[string]net.IOCountersStat
	lastNetTime time.Time
	lastDisk    map[string]disk.IOCountersStat
	lastDiskTime time.Time
}

func NewApp() *App {
	return &App{
		lastNet:  make(map[string]net.IOCountersStat),
		lastDisk: make(map[string]disk.IOCountersStat),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

type CPUInfo struct {
	Total     float64   `json:"total"`
	PerCore   []float64 `json:"perCore"`
	Model     string    `json:"model"`
	Cores     int       `json:"cores"`
	Threads   int       `json:"threads"`
	Frequency float64   `json:"frequency"`
	LoadAvg   []float64 `json:"loadAvg"`
	Temp      float64   `json:"temp"`
}

type MemInfo struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	UsedPercent float64 `json:"usedPercent"`
	Cached      uint64  `json:"cached"`
	SwapTotal   uint64  `json:"swapTotal"`
	SwapUsed    uint64  `json:"swapUsed"`
}

type DiskInfo struct {
	MountPoint  string  `json:"mountPoint"`
	Device      string  `json:"device"`
	Fstype      string  `json:"fstype"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"usedPercent"`
	ReadRate    uint64  `json:"readRate"`
	WriteRate   uint64  `json:"writeRate"`
}

type NetInfo struct {
	Name         string `json:"name"`
	BytesSent    uint64 `json:"bytesSent"`
	BytesRecv    uint64 `json:"bytesRecv"`
	UploadRate   uint64 `json:"uploadRate"`
	DownloadRate uint64 `json:"downloadRate"`
}

type SysInfo struct {
	Hostname string `json:"hostname"`
	Platform string `json:"platform"`
	Kernel   string `json:"kernel"`
	Arch     string `json:"arch"`
	Uptime   uint64 `json:"uptime"`
}

type BatteryInfo struct {
	Present    bool    `json:"present"`
	Percent    float64 `json:"percent"`
	Charging   bool    `json:"charging"`
	TimeLeft   string  `json:"timeLeft"`
}

type Metrics struct {
	CPU     CPUInfo     `json:"cpu"`
	Memory  MemInfo     `json:"memory"`
	Disks   []DiskInfo  `json:"disks"`
	Networks []NetInfo  `json:"networks"`
	System  SysInfo     `json:"system"`
	Battery BatteryInfo `json:"battery"`
}

type ProcessInfo struct {
	PID       int32   `json:"pid"`
	Name      string  `json:"name"`
	CPU       float64 `json:"cpu"`
	Memory    float32 `json:"memory"`
	MemoryRss uint64  `json:"memoryRss"`
	Status    string  `json:"status"`
	User      string  `json:"user"`
}

func (a *App) GetMetrics() Metrics {
	m := Metrics{}

	// CPU
	if pcts, err := cpu.Percent(0, false); err == nil && len(pcts) > 0 {
		m.CPU.Total = pcts[0]
	}
	if pcts, err := cpu.Percent(0, true); err == nil {
		m.CPU.PerCore = pcts
	}
	if info, err := cpu.Info(); err == nil && len(info) > 0 {
		m.CPU.Model = info[0].ModelName
		m.CPU.Frequency = info[0].Mhz
	}
	m.CPU.Cores, _ = cpu.Counts(false)
	m.CPU.Threads, _ = cpu.Counts(true)
	if l, err := load.Avg(); err == nil {
		m.CPU.LoadAvg = []float64{l.Load1, l.Load5, l.Load15}
	}
	m.CPU.Temp = getCPUTemp()

	// Memory
	if v, err := mem.VirtualMemory(); err == nil {
		m.Memory.Total = v.Total
		m.Memory.Used = v.Used
		m.Memory.Available = v.Available
		m.Memory.UsedPercent = v.UsedPercent
		m.Memory.Cached = v.Cached
	}
	if s, err := mem.SwapMemory(); err == nil {
		m.Memory.SwapTotal = s.Total
		m.Memory.SwapUsed = s.Used
	}

	// Disks
	now := time.Now()
	diskIO, _ := disk.IOCounters()
	diskElapsed := now.Sub(a.lastDiskTime).Seconds()
	
	if parts, err := disk.Partitions(false); err == nil {
		for _, p := range parts {
			if strings.HasPrefix(p.Device, "/dev/loop") {
				continue
			}
			if u, err := disk.Usage(p.Mountpoint); err == nil {
				d := DiskInfo{
					MountPoint:  p.Mountpoint,
					Device:      p.Device,
					Fstype:      p.Fstype,
					Total:       u.Total,
					Used:        u.Used,
					Free:        u.Free,
					UsedPercent: u.UsedPercent,
				}
				
				devName := strings.TrimPrefix(p.Device, "/dev/")
				if io, ok := diskIO[devName]; ok && diskElapsed > 0 {
					if last, ok := a.lastDisk[devName]; ok {
						d.ReadRate = uint64(float64(io.ReadBytes-last.ReadBytes) / diskElapsed)
						d.WriteRate = uint64(float64(io.WriteBytes-last.WriteBytes) / diskElapsed)
					}
				}
				m.Disks = append(m.Disks, d)
			}
		}
	}
	a.lastDisk = diskIO
	a.lastDiskTime = now

	// Network
	netElapsed := now.Sub(a.lastNetTime).Seconds()
	if counters, err := net.IOCounters(true); err == nil {
		for _, c := range counters {
			if c.Name == "lo" || strings.HasPrefix(c.Name, "veth") || strings.HasPrefix(c.Name, "docker") || strings.HasPrefix(c.Name, "br-") {
				continue
			}
			n := NetInfo{Name: c.Name, BytesSent: c.BytesSent, BytesRecv: c.BytesRecv}
			if netElapsed > 0 {
				if last, ok := a.lastNet[c.Name]; ok {
					n.UploadRate = uint64(float64(c.BytesSent-last.BytesSent) / netElapsed)
					n.DownloadRate = uint64(float64(c.BytesRecv-last.BytesRecv) / netElapsed)
				}
			}
			a.lastNet[c.Name] = c
			m.Networks = append(m.Networks, n)
		}
	}
	a.lastNetTime = now

	// System
	if h, err := host.Info(); err == nil {
		m.System.Hostname = h.Hostname
		m.System.Platform = h.Platform + " " + h.PlatformVersion
		m.System.Kernel = h.KernelVersion
		m.System.Arch = h.KernelArch
		m.System.Uptime = h.Uptime
	}

	// Battery
	m.Battery = getBatteryInfo()

	return m
}

func getCPUTemp() float64 {
	if runtime.GOOS == "linux" {
		// Try hwmon first (more reliable)
		hwmonPaths := []string{
			"/sys/class/hwmon/hwmon0/temp1_input",
			"/sys/class/hwmon/hwmon1/temp1_input",
			"/sys/class/hwmon/hwmon2/temp1_input",
			"/sys/class/hwmon/hwmon3/temp1_input",
			"/sys/class/hwmon/hwmon4/temp1_input",
		}
		for _, p := range hwmonPaths {
			if data, err := os.ReadFile(p); err == nil {
				s := strings.TrimSpace(string(data))
				var temp int
				for _, c := range s {
					if c >= '0' && c <= '9' {
						temp = temp*10 + int(c-'0')
					}
				}
				if temp > 0 {
					return float64(temp) / 1000.0
				}
			}
		}
		// Try thermal_zone
		for i := 0; i < 10; i++ {
			p := "/sys/class/thermal/thermal_zone" + string(rune('0'+i)) + "/temp"
			if data, err := os.ReadFile(p); err == nil {
				s := strings.TrimSpace(string(data))
				var temp int
				for _, c := range s {
					if c >= '0' && c <= '9' {
						temp = temp*10 + int(c-'0')
					}
				}
				if temp > 0 {
					return float64(temp) / 1000.0
				}
			}
		}
	}
	return 0
}

func getBatteryInfo() BatteryInfo {
	info := BatteryInfo{}
	if runtime.GOOS == "linux" {
		base := "/sys/class/power_supply/BAT0"
		if _, err := os.Stat(base); err != nil {
			base = "/sys/class/power_supply/BAT1"
		}
		if _, err := os.Stat(base); err == nil {
			info.Present = true
			if data, err := os.ReadFile(base + "/capacity"); err == nil {
				for _, c := range strings.TrimSpace(string(data)) {
					if c >= '0' && c <= '9' {
						info.Percent = info.Percent*10 + float64(c-'0')
					}
				}
			}
			if data, err := os.ReadFile(base + "/status"); err == nil {
				status := strings.TrimSpace(string(data))
				info.Charging = status == "Charging" || status == "Full"
			}
		}
	}
	return info
}

func (a *App) GetProcesses() []ProcessInfo {
	procs, err := process.Processes()
	if err != nil {
		return nil
	}

	var result []ProcessInfo
	for _, p := range procs {
		name, _ := p.Name()
		cpuPct, _ := p.CPUPercent()
		memPct, _ := p.MemoryPercent()
		memInfo, _ := p.MemoryInfo()
		status, _ := p.Status()
		user, _ := p.Username()

		var rss uint64
		if memInfo != nil {
			rss = memInfo.RSS
		}

		result = append(result, ProcessInfo{
			PID:       p.Pid,
			Name:      name,
			CPU:       cpuPct,
			Memory:    memPct,
			MemoryRss: rss,
			Status:    strings.Join(status, ","),
			User:      user,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].CPU > result[j].CPU
	})

	return result
}

func (a *App) KillProcess(pid int32) error {
	p, err := process.NewProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}

func (a *App) OpenTerminal() error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "linux":
		terminals := []string{"gnome-terminal", "konsole", "xfce4-terminal", "xterm"}
		for _, t := range terminals {
			if _, err := exec.LookPath(t); err == nil {
				cmd = exec.Command(t)
				break
			}
		}
	case "darwin":
		cmd = exec.Command("open", "-a", "Terminal")
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "cmd")
	}
	if cmd != nil {
		return cmd.Start()
	}
	return nil
}

func (a *App) OpenFileManager() error {
	home, _ := os.UserHomeDir()
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "linux":
		cmd = exec.Command("xdg-open", home)
	case "darwin":
		cmd = exec.Command("open", home)
	case "windows":
		cmd = exec.Command("explorer", home)
	}
	if cmd != nil {
		return cmd.Start()
	}
	return nil
}

func (a *App) EmptyTrash() error {
	home, _ := os.UserHomeDir()
	trashPath := home + "/.local/share/Trash/files"
	if runtime.GOOS == "linux" {
		os.RemoveAll(trashPath)
		os.MkdirAll(trashPath, 0755)
	}
	return nil
}

func (a *App) GetMemoryPressure() string {
	if v, err := mem.VirtualMemory(); err == nil {
		pct := v.UsedPercent
		if pct > 90 {
			return "critical"
		} else if pct > 75 {
			return "high"
		} else if pct > 50 {
			return "moderate"
		}
		return "low"
	}
	return "unknown"
}

func (a *App) FreeCaches() error {
	if runtime.GOOS == "linux" {
		// This requires root, so it might fail
		f, err := os.OpenFile("/proc/sys/vm/drop_caches", os.O_WRONLY, 0)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = f.WriteString("3")
		return err
	}
	return nil
}

func (a *App) Shutdown() error {
	return nil // Requires elevated privileges
}

func (a *App) Reboot() error {
	return nil // Requires elevated privileges
}
