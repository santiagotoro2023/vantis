import { useState } from 'react'
import { api } from '../api'
import ReactMarkdown from 'react-markdown'

export default function ReportsPage() {
  const [webhookUrl, setWebhookUrl] = useState('')
  const [schedule, setSchedule] = useState('daily')
  const [webhookStatus, setWebhookStatus] = useState('')
  const [report, setReport] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)

  const saveWebhook = async () => {
    setSaving(true)
    try {
      await api.setWebhook(webhookUrl, schedule)
      setWebhookStatus('Webhook saved.')
    } catch (err: unknown) {
      setWebhookStatus(err instanceof Error ? err.message : 'Failed.')
    } finally {
      setSaving(false)
    }
  }

  const generateReport = async () => {
    setGenerating(true)
    setReport('')
    try {
      const data = await api.generateReport() as { report: string }
      setReport(data.report || '')
    } catch (err: unknown) {
      setReport(`Error: ${err instanceof Error ? err.message : 'Failed.'}`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div className="border-b border-border pb-3">
        <h1 className="text-lg font-mono font-bold text-text-bright tracking-widest uppercase">Reports</h1>
        <p className="text-xs text-muted font-mono mt-1">Generate and deliver periodic intelligence reports.</p>
      </div>

      {/* Webhook config */}
      <section className="border border-border bg-surface p-5 space-y-4">
        <h2 className="text-sm font-mono font-bold text-text-bright uppercase tracking-wider">Webhook Delivery</h2>
        <div>
          <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1">Webhook URL</label>
          <input
            type="url"
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            className="w-full bg-void border border-border px-3 py-2 text-sm text-text font-mono focus:border-accent transition-colors"
            placeholder="https://hooks.slack.com/..."
          />
        </div>
        <div>
          <label className="block text-xs text-muted font-mono uppercase tracking-wider mb-1">Schedule</label>
          <select
            value={schedule}
            onChange={e => setSchedule(e.target.value)}
            className="bg-void border border-border px-3 py-2 text-sm text-text font-mono focus:border-accent transition-colors"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        {webhookStatus && (
          <div className="text-xs font-mono text-success">{webhookStatus}</div>
        )}
        <button
          onClick={saveWebhook}
          disabled={saving || !webhookUrl}
          className="border border-accent bg-transparent hover:bg-accent/10 disabled:opacity-40
                     text-accent font-mono px-4 py-2 text-xs uppercase tracking-widest transition-all"
        >
          {saving ? 'Saving...' : 'Save Webhook'}
        </button>
      </section>

      {/* Generate report */}
      <section className="border border-border bg-surface p-5 space-y-4">
        <h2 className="text-sm font-mono font-bold text-text-bright uppercase tracking-wider">Generate Report</h2>
        <p className="text-xs text-muted font-mono">Produce a markdown intelligence summary of VANTIS's current state.</p>
        <button
          onClick={generateReport}
          disabled={generating}
          className="border border-accent bg-transparent hover:bg-accent/10 disabled:opacity-40
                     text-accent font-mono px-4 py-2 text-xs uppercase tracking-widest transition-all"
        >
          {generating ? 'Generating...' : 'Generate Report Now'}
        </button>
        {report && (
          <div className="border border-border bg-void p-4 prose prose-invert prose-sm max-w-none font-mono text-xs text-text leading-relaxed">
            <ReactMarkdown>{report}</ReactMarkdown>
          </div>
        )}
      </section>
    </div>
  )
}
