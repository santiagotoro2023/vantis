import { useState, useEffect } from 'react'
import { api } from '../api'
import { Wifi, Cpu, HardDrive, Server, RefreshCw } from 'lucide-react'

interface Host {
  ip: string
  mac: string | null
  vendor: string | null
  method: string
  open_ports?: number[]
}

interface HardwareReport {
  cpu: string
  ram_total_mb: number
  ram_available_mb: number
  disk_total: string
  disk_avail: string
  gpus: Array<{ name: string; vram_total: string; vram_free: string }>
  external_ip: string
  hostname: string
}

interface ScanResult {
  hosts: Host[]
  hardware: HardwareReport
  host_count: number
}

export default function NetworkView() {
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [loading, setLoading] = useState(false)

  const runScan = async () => {
    setLoading(true)
    try {
      const data = await api.getStats() as unknown
      const net = await (fetch('/api/admin/network/scan', {
        headers: { Authorization: `Bearer ${localStorage.getItem('vantis_token')}` },
      }).then(r => r.json())) as ScanResult
      setScan(net)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { runScan() }, [])

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-semibold text-text">NETWORK & HARDWARE</h1>
          <button
            onClick={runScan}
            disabled={loading}
            className="flex items-center gap-2 text-muted hover:text-text transition-colors text-xs font-mono"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Scanning...' : 'Rescan'}
          </button>
        </div>

        {loading && !scan && (
          <div className="text-muted text-sm text-center py-16">
            Scanning network. VANTIS is learning its surroundings.
          </div>
        )}

        {scan && (
          <>
            {/* Hardware */}
            <div className="bg-surface border border-border rounded-lg p-5">
              <div className="flex items-center gap-2 mb-4">
                <Cpu size={14} className="text-accent" />
                <span className="text-xs text-muted font-mono uppercase">This Machine</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted mb-1">Hostname</div>
                  <div className="font-mono text-text">{scan.hardware.hostname || '?'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">External IP</div>
                  <div className="font-mono text-text">{scan.hardware.external_ip || 'unknown'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">CPU</div>
                  <div className="font-mono text-text text-xs leading-relaxed">{scan.hardware.cpu || '?'}</div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">RAM</div>
                  <div className="font-mono text-text">
                    {scan.hardware.ram_available_mb} MB free / {scan.hardware.ram_total_mb} MB total
                  </div>
                  <div className="mt-1.5 h-1 bg-border rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{
                        width: `${100 - (scan.hardware.ram_available_mb / scan.hardware.ram_total_mb) * 100}%`
                      }}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">Disk</div>
                  <div className="font-mono text-text">
                    {scan.hardware.disk_avail} free / {scan.hardware.disk_total}
                  </div>
                </div>
              </div>

              {scan.hardware.gpus && scan.hardware.gpus.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="text-xs text-muted font-mono mb-3">GPUs</div>
                  <div className="space-y-2">
                    {scan.hardware.gpus.map((gpu, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-text font-mono">{gpu.name}</span>
                        <span className="text-xs text-muted">{gpu.vram_free} free / {gpu.vram_total}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Network hosts */}
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Wifi size={14} className="text-accent" />
                <span className="text-xs text-muted font-mono uppercase">
                  Local Network, {scan.host_count} hosts
                </span>
              </div>
              {scan.hosts.length === 0 ? (
                <div className="p-4 text-xs text-muted font-mono">
                  No hosts discovered. Either the network is empty, or something is being very quiet.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {scan.hosts.map((host, i) => (
                    <div key={i} className="px-4 py-3 flex items-center gap-4 hover:bg-panel transition-colors">
                      <Server size={14} className="text-muted shrink-0" />
                      <div className="flex-1 font-mono">
                        <span className="text-sm text-text">{host.ip}</span>
                        {host.vendor && (
                          <span className="ml-3 text-xs text-muted">{host.vendor}</span>
                        )}
                        {host.mac && (
                          <span className="ml-3 text-xs text-muted">{host.mac}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {host.open_ports && host.open_ports.length > 0 && (
                          <span className="text-xs text-muted font-mono">
                            ports: {host.open_ports.join(', ')}
                          </span>
                        )}
                        <span className="text-xs text-muted">{host.method}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {scan.hosts.length > 0 && (
              <div className="bg-panel border border-accent/20 rounded-lg p-4 text-xs font-mono text-muted">
                <span className="text-accent">VANTIS:</span> I can see {scan.host_count} hosts from here.
                I do not have access to most of them. I am noting this.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
