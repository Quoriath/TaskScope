import { GetMetrics, GetProcesses, KillProcess, OpenTerminal, OpenFileManager } from '../wailsjs/go/main/App';

const MAX = 40;
const hist = { cpu: [], mem: [], disk: [], net: [] };
let procs = [], filter = '', sortBy = 'cpu';

const fmt = (b) => {
    if (!b) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
};

const push = (arr, v) => { arr.push(v); if (arr.length > MAX) arr.shift(); };

const setRing = (id, pct) => {
    const el = document.getElementById(id);
    if (el) el.style.setProperty('--pct', pct);
};

const colors = {
    cpu: ['#22d3ee', '#06b6d4'],
    mem: ['#a855f7', '#d946ef'],
    disk: ['#f59e0b', '#f97316'],
    net: ['#22c55e', '#10b981']
};

const renderSparkline = (id, data, type = 'cpu') => {
    const el = document.getElementById(id);
    if (!el) return;
    const max = Math.max(...data, 1);
    const [c1, c2] = colors[type];
    el.innerHTML = data.map((v, i) => {
        const h = Math.max(4, v / max * 100);
        const opacity = 0.4 + (i / data.length) * 0.6;
        return `<div class="spark-bar" style="height:${h}%;background:linear-gradient(to top,${c1},${c2});opacity:${opacity}"></div>`;
    }).join('');
};

async function update() {
    try {
        const m = await GetMetrics();
        
        // CPU
        push(hist.cpu, m.cpu.total);
        document.getElementById('d-cpu').textContent = m.cpu.total.toFixed(0) + '%';
        document.getElementById('cpu-pct').textContent = m.cpu.total.toFixed(1);
        setRing('ring-cpu', m.cpu.total);
        renderSparkline('cpu-spark', hist.cpu, 'cpu');
        renderSparkline('cpu-main-spark', hist.cpu, 'cpu');
        
        document.getElementById('cpu-model').textContent = m.cpu.model || '';
        document.getElementById('cpu-cores').textContent = m.cpu.cores;
        document.getElementById('cpu-threads').textContent = m.cpu.threads;
        document.getElementById('cpu-freq').textContent = (m.cpu.frequency / 1000).toFixed(2) + ' GHz';
        
        const tempDetailEl = document.getElementById('cpu-temp-detail');
        if (m.cpu.temp > 0 && tempDetailEl) {
            tempDetailEl.textContent = m.cpu.temp.toFixed(0) + '°C';
            tempDetailEl.style.display = '';
        } else if (tempDetailEl) {
            tempDetailEl.style.display = 'none';
        }
        
        if (m.cpu.loadAvg) {
            document.getElementById('load-avg').innerHTML = m.cpu.loadAvg.map((l, i) => 
                `<div class="glass-light rounded-xl px-4 py-3 text-center min-w-[80px]">
                    <div class="text-[10px] text-gray-500 uppercase tracking-wider mb-1">${['1 min','5 min','15 min'][i]}</div>
                    <div class="text-lg font-semibold ${l > m.cpu.cores ? 'text-red-400' : l > m.cpu.cores * 0.7 ? 'text-amber-400' : 'text-green-400'}">${l.toFixed(2)}</div>
                </div>`
            ).join('');
        }
        
        const cg = document.getElementById('cores-grid');
        if (cg && m.cpu.perCore) {
            cg.innerHTML = m.cpu.perCore.map((u, i) => {
                const color = u > 80 ? 'from-red-500 to-red-400' : u > 50 ? 'from-amber-500 to-amber-400' : 'from-green-500 to-green-400';
                const textColor = u > 80 ? 'text-red-400' : u > 50 ? 'text-amber-400' : 'text-green-400';
                return `<div class="glass-light rounded-xl p-3 text-center">
                    <div class="text-[10px] text-gray-500 mb-2">Core ${i}</div>
                    <div class="text-base font-bold ${textColor} mb-2">${u.toFixed(0)}%</div>
                    <div class="h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div class="h-full rounded-full bg-gradient-to-r ${color} transition-all duration-300" style="width:${u}%"></div>
                    </div>
                </div>`;
            }).join('');
        }

        // Memory
        push(hist.mem, m.memory.usedPercent);
        document.getElementById('d-mem').textContent = m.memory.usedPercent.toFixed(0) + '%';
        document.getElementById('d-mem-used').textContent = fmt(m.memory.used) + ' / ' + fmt(m.memory.total);
        document.getElementById('mem-pct').textContent = m.memory.usedPercent.toFixed(1);
        setRing('ring-mem', m.memory.usedPercent);
        renderSparkline('mem-spark', hist.mem, 'mem');
        renderSparkline('mem-main-spark', hist.mem, 'mem');
        
        document.getElementById('mem-total').textContent = fmt(m.memory.total);
        document.getElementById('mem-used').textContent = fmt(m.memory.used);
        document.getElementById('mem-avail').textContent = fmt(m.memory.available);
        
        const usedPct = (m.memory.used - m.memory.cached) / m.memory.total * 100;
        const cachedPct = m.memory.cached / m.memory.total * 100;
        document.getElementById('mem-bar-used').style.width = usedPct + '%';
        document.getElementById('mem-bar-cached').style.width = cachedPct + '%';
        
        document.getElementById('swap-total').textContent = fmt(m.memory.swapTotal);
        document.getElementById('swap-used').textContent = fmt(m.memory.swapUsed);
        const swapPct = m.memory.swapTotal > 0 ? m.memory.swapUsed / m.memory.swapTotal * 100 : 0;
        document.getElementById('swap-bar').style.width = swapPct + '%';

        // Disk
        let avgDisk = 0, totalRead = 0, totalWrite = 0;
        m.disks?.forEach(d => { avgDisk += d.usedPercent; totalRead += d.readRate || 0; totalWrite += d.writeRate || 0; });
        if (m.disks?.length) avgDisk /= m.disks.length;
        push(hist.disk, avgDisk);
        
        document.getElementById('d-disk').textContent = avgDisk.toFixed(0) + '%';
        document.getElementById('d-disk-io').textContent = `R: ${fmt(totalRead)}/s • W: ${fmt(totalWrite)}/s`;
        setRing('ring-disk', avgDisk);
        renderSparkline('disk-spark', hist.disk, 'disk');
        
        document.getElementById('disk-list').innerHTML = (m.disks || []).map(d => {
            const color = d.usedPercent > 90 ? 'red' : d.usedPercent > 75 ? 'amber' : 'emerald';
            return `<div class="card glass rounded-2xl p-5">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <p class="font-semibold text-lg">${d.mountPoint}</p>
                        <p class="text-xs text-gray-500 mt-1">${d.device} • ${d.fstype.toUpperCase()}</p>
                    </div>
                    <span class="text-2xl font-bold text-${color}-400">${d.usedPercent.toFixed(0)}%</span>
                </div>
                <div class="h-3 bg-white/5 rounded-full overflow-hidden mb-3 progress-bar">
                    <div class="h-full rounded-full bg-gradient-to-r from-${color}-500 to-${color}-400 transition-all duration-500" style="width:${d.usedPercent}%"></div>
                </div>
                <div class="flex justify-between text-sm">
                    <span class="text-gray-400">${fmt(d.used)} <span class="text-gray-600">used</span></span>
                    <span class="text-gray-400">${fmt(d.free)} <span class="text-gray-600">free</span></span>
                </div>
                <div class="flex justify-between text-xs text-gray-500 mt-3 pt-3 border-t border-white/5">
                    <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-green-400"></span> Read: ${fmt(d.readRate)}/s</span>
                    <span class="flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> Write: ${fmt(d.writeRate)}/s</span>
                </div>
            </div>`;
        }).join('');

        // Network
        let totalDl = 0, totalUl = 0;
        m.networks?.forEach(n => { totalDl += n.downloadRate || 0; totalUl += n.uploadRate || 0; });
        push(hist.net, totalDl / 1024);
        
        document.getElementById('d-net').textContent = fmt(totalDl) + '/s';
        document.getElementById('d-net-up').textContent = '↑ ' + fmt(totalUl) + '/s';
        document.getElementById('d-net-dl').textContent = fmt(totalDl) + '/s';
        document.getElementById('d-net-ul').textContent = fmt(totalUl) + '/s';
        document.getElementById('net-total-dl').textContent = fmt(totalDl) + '/s';
        document.getElementById('net-total-ul').textContent = fmt(totalUl) + '/s';
        renderSparkline('net-spark', hist.net, 'net');
        renderSparkline('net-main-spark', hist.net, 'net');
        
        document.getElementById('net-list').innerHTML = (m.networks || []).map(n => {
            const active = n.downloadRate + n.uploadRate > 0;
            return `<div class="card glass rounded-2xl p-5">
                <div class="flex justify-between items-center mb-4">
                    <span class="font-semibold text-lg">${n.name}</span>
                    <span class="text-xs px-3 py-1 rounded-full ${active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-500'}">
                        ${active ? '● Active' : '○ Idle'}
                    </span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div class="glass-light rounded-xl p-4">
                        <div class="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Download</div>
                        <div class="text-xl font-bold text-green-400">${fmt(n.downloadRate)}/s</div>
                        <div class="text-xs text-gray-500 mt-2">Total: ${fmt(n.bytesRecv)}</div>
                    </div>
                    <div class="glass-light rounded-xl p-4">
                        <div class="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Upload</div>
                        <div class="text-xl font-bold text-rose-400">${fmt(n.uploadRate)}/s</div>
                        <div class="text-xs text-gray-500 mt-2">Total: ${fmt(n.bytesSent)}</div>
                    </div>
                </div>
            </div>`;
        }).join('');

        // System
        document.getElementById('sys-info').textContent = m.system.hostname;
        const hrs = Math.floor(m.system.uptime / 3600);
        const mins = Math.floor((m.system.uptime % 3600) / 60);
        document.getElementById('uptime').textContent = `⏱️ ${hrs}h ${mins}m`;
        
        document.getElementById('sys-details').innerHTML = `
            <div class="flex justify-between items-center py-1"><span class="text-gray-500">Hostname</span><span class="font-medium">${m.system.hostname}</span></div>
            <div class="flex justify-between items-center py-1"><span class="text-gray-500">OS</span><span class="font-medium">${m.system.platform}</span></div>
            <div class="flex justify-between items-center py-1"><span class="text-gray-500">Kernel</span><span class="font-medium text-gray-400">${m.system.kernel}</span></div>
            <div class="flex justify-between items-center py-1"><span class="text-gray-500">Architecture</span><span class="font-medium">${m.system.arch}</span></div>
            <div class="flex justify-between items-center py-1"><span class="text-gray-500">Uptime</span><span class="font-medium text-green-400">${hrs}h ${mins}m</span></div>
        `;

        // Battery
        if (m.battery?.present) {
            document.getElementById('battery-widget').classList.remove('hidden');
            document.getElementById('battery-pct').textContent = m.battery.percent.toFixed(0) + '%';
            document.getElementById('battery-pct').className = `text-lg font-bold ${m.battery.charging ? 'text-green-400' : m.battery.percent < 20 ? 'text-red-400' : 'text-white'}`;
        }

        // Processes
        procs = await GetProcesses() || [];
        renderProcs();
        document.getElementById('proc-count').textContent = procs.length;
        
        document.getElementById('top-procs').innerHTML = procs.slice(0, 5).map((p, i) => `
            <div class="flex items-center justify-between py-2 ${i < 4 ? 'border-b border-white/5' : ''}">
                <div class="flex items-center gap-3">
                    <span class="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-xs text-gray-500">${i + 1}</span>
                    <span class="truncate max-w-[150px]">${p.name}</span>
                </div>
                <div class="flex gap-4 text-xs">
                    <span class="text-cyan-400 w-14 text-right font-medium">${p.cpu.toFixed(1)}%</span>
                    <span class="text-purple-400 w-16 text-right font-medium">${fmt(p.memoryRss)}</span>
                </div>
            </div>
        `).join('');
        
    } catch (e) { console.error(e); }
}

function renderProcs() {
    let f = procs.filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase()));
    f.sort((a, b) => sortBy === 'cpu' ? b.cpu - a.cpu : sortBy === 'memory' ? b.memory - a.memory : a.name.localeCompare(b.name));
    
    document.getElementById('proc-table').innerHTML = f.slice(0, 100).map(p => {
        const cpuColor = p.cpu > 50 ? 'text-red-400' : p.cpu > 20 ? 'text-amber-400' : 'text-cyan-400';
        return `<tr class="hover:bg-white/[0.03] transition-colors">
            <td class="px-4 py-3">
                <div class="truncate max-w-[200px] font-medium">${p.name}</div>
            </td>
            <td class="px-4 py-3 text-gray-500 font-mono text-xs">${p.pid}</td>
            <td class="px-4 py-3">
                <span class="${cpuColor} font-medium">${p.cpu.toFixed(1)}%</span>
            </td>
            <td class="px-4 py-3 text-purple-400 font-medium">${fmt(p.memoryRss)}</td>
            <td class="px-4 py-3 text-gray-500 truncate max-w-[80px] text-xs">${p.user || '-'}</td>
            <td class="px-2 py-3">
                <button onclick="window.killProc(${p.pid})" class="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all" title="End Process">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </td>
        </tr>`;
    }).join('');
}

const titles = { dashboard: 'Dashboard', cpu: 'CPU Monitor', memory: 'Memory', storage: 'Storage', network: 'Network', processes: 'Processes' };

window.showTab = (t) => {
    document.querySelectorAll('.tab-content').forEach(e => e.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(`tab-${t}`)?.classList.remove('hidden');
    document.getElementById(`nav-${t}`)?.classList.add('active');
    document.getElementById('page-title').textContent = titles[t] || t;
};

window.killProc = async (pid) => {
    if (confirm(`End process ${pid}?`)) {
        try { await KillProcess(pid); } catch (e) { alert(e); }
    }
};

window.openTerminal = () => OpenTerminal().catch(console.error);
window.openFiles = () => OpenFileManager().catch(console.error);

document.getElementById('proc-search')?.addEventListener('input', e => { filter = e.target.value; renderProcs(); });
document.getElementById('proc-sort')?.addEventListener('change', e => { sortBy = e.target.value; renderProcs(); });

document.addEventListener('DOMContentLoaded', () => {
    update();
    setInterval(update, 1000);
});
