import { useState } from 'react'
import { api } from '../api'
import { Save, Play } from 'lucide-react'

export default function ReportsPage() {
  const [webhookUrl, setWebhookUrl] = useState('')
  const [schedule, setSchedule] = useState('daily')
  const [report, setReport] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  const saveWebhook = async () => {
    try {
      await api.setWebhook(webhookUrl, schedule)
      setStatus('Webhook saved.')
      setTimeout(() => setStatus(''), 3000)
    } catch { setStatus('Failed to save.') }
  }

  const generateReport = async () => {
    setLoading(true)
    try {
      const data = await api.generateReport() as { report: string; webhook_sent: boolean }
      setReport(data.report)
      setStatus(data.webhook_sent ? 'Report sent to webhook.' : 'Report generated.')
      setTimeout(() => setStatus(''), 4000)
    } catch { setStatus('Failed.') } finally { setLoading(false) }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-sm font-mono font-semibold text-text">ACTIVITY REPORTS</h1>
        {status && <div className="bg-accent/10 border border-accent/30 p-3 text-sm text-accent font-mono">{status}</div>}

        <div className="bg-surface border border-border p-5 space-y-4">
          <div className="text-xs text-muted font-mono">WEBHOOK</div>
          <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/..."
            className="w-full bg-panel border border-border px-3 py-2 text-sm text-text font-mono focus:border-accent focus:outline-none" />
          <div className="flex items-center gap-3">
            <select value={schedule} onChange={e => setSchedule(e.target.value)}
              className="bg-panel border border-border px-3 py-2 text-sm text-text font-mono focus:outline-none">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
            <button onClick={saveWebhook} className="flex items-center gap-2 bg-accent hover:bg-accent/80 text-white px-4 py-2 text-sm font-mono transition-colors">
              <Save size={14} /> Save
            </button>
          </div>
        </div>

        <button onClick={generateReport} disabled={loading}
          className="flex items-center gap-2 border border-accent/40 hover:border-accent text-accent px-4 py-2 text-sm font-mono transition-colors disabled:opacity-40">
          <Play size={14} /> {loading ? 'Generating...' : 'Generate Report Now'}
        </button>

        {report && (
          <pre className="bg-surface border border-border p-4 text-xs font-mono text-text whitespace-pre-wrap overflow-x-auto max-h-[60vh] overflow-y-auto">
            {report}
          </pre>
        )}
      </div>
    </div>
  )
}
