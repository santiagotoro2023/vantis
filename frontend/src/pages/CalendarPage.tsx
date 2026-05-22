import { useState, useEffect } from 'react'
import { api } from '../api'
import { Plus, Trash2, Bell, CalendarDays } from 'lucide-react'

interface CalendarEvent {
  id: number
  title: string
  description: string
  event_time: string
  reminder_minutes: number
  reminded: number
}

function formatEventTime(dt: string): string {
  try {
    const d = new Date(dt.includes('T') ? dt : dt.replace(' ', 'T'))
    return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  } catch { return dt }
}

function isUpcoming(dt: string): boolean {
  return new Date(dt.includes('T') ? dt : dt.replace(' ', 'T')) > new Date()
}

function timeUntil(dt: string): string {
  const diff = new Date(dt.includes('T') ? dt : dt.replace(' ', 'T')).getTime() - Date.now()
  if (diff < 0) return 'past'
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `in ${hrs}h`
  const days = Math.floor(hrs / 24)
  return `in ${days}d`
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', event_time: '', reminder_minutes: 15 })
  const [status, setStatus] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.getCalendarEvents()
      setEvents(data)
    } catch { }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const createEvent = async () => {
    if (!form.title || !form.event_time) return
    try {
      await api.createCalendarEvent(form)
      setForm({ title: '', description: '', event_time: '', reminder_minutes: 15 })
      setAdding(false)
      setStatus('Event created. I will remember.')
      setTimeout(() => setStatus(''), 4000)
      load()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed.')
    }
  }

  const deleteEvent = async (id: number) => {
    await api.deleteCalendarEvent(id).catch(() => {})
    setStatus('Removed.')
    setTimeout(() => setStatus(''), 2000)
    load()
  }

  const upcoming = events.filter(e => isUpcoming(e.event_time))
  const past = events.filter(e => !isUpcoming(e.event_time))

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="border-b border-border pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-mono font-bold text-text-bright tracking-widest uppercase">Calendar</h1>
          <p className="text-xs text-muted font-mono mt-1">Events I am aware of. I factor them into every response.</p>
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="flex items-center gap-1.5 border border-accent text-accent font-mono px-3 py-1.5 text-xs uppercase tracking-widest hover:bg-accent/10 transition-colors"
        >
          <Plus size={12} />
          Add Event
        </button>
      </div>

      {status && (
        <div className="text-xs font-mono text-accent border border-accent/20 bg-accent/5 px-3 py-2">{status}</div>
      )}

      {adding && (
        <div className="border border-border bg-surface p-4 space-y-3">
          <div className="text-xs font-mono text-muted uppercase tracking-wider mb-2">New Event</div>
          <input
            type="text"
            placeholder="Event title"
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            className="w-full bg-void border border-border px-3 py-2 text-sm font-mono text-text focus:border-accent outline-none"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            className="w-full bg-void border border-border px-3 py-2 text-sm font-mono text-text focus:border-accent outline-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono text-muted mb-1 uppercase tracking-wider">Date &amp; Time</label>
              <input
                type="datetime-local"
                value={form.event_time}
                onChange={e => setForm(p => ({ ...p, event_time: e.target.value }))}
                className="w-full bg-void border border-border px-3 py-2 text-sm font-mono text-text focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono text-muted mb-1 uppercase tracking-wider">Remind (min before)</label>
              <input
                type="number"
                value={form.reminder_minutes}
                onChange={e => setForm(p => ({ ...p, reminder_minutes: Number(e.target.value) }))}
                min={0}
                className="w-full bg-void border border-border px-3 py-2 text-sm font-mono text-text focus:border-accent outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createEvent} className="border border-accent text-accent font-mono px-4 py-2 text-xs uppercase hover:bg-accent/10 transition-colors">
              Create
            </button>
            <button onClick={() => setAdding(false)} className="border border-border text-muted font-mono px-4 py-2 text-xs uppercase hover:text-text transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-xs font-mono text-muted">Loading...</div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div>
              <div className="text-xs font-mono text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
                <CalendarDays size={11} />
                Upcoming ({upcoming.length})
              </div>
              <div className="space-y-2">
                {upcoming.map(evt => (
                  <div key={evt.id} className="border border-border bg-surface p-3 flex items-start justify-between group">
                    <div>
                      <div className="text-sm font-mono text-text font-semibold">{evt.title}</div>
                      {evt.description && <div className="text-xs text-muted mt-0.5">{evt.description}</div>}
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-xs font-mono text-accent">{formatEventTime(evt.event_time)}</span>
                        <span className="text-[10px] font-mono text-muted/70">{timeUntil(evt.event_time)}</span>
                        {evt.reminder_minutes > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-mono text-muted/60">
                            <Bell size={9} />
                            {evt.reminder_minutes}m before
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteEvent(evt.id)}
                      className="text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-all p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <div className="text-xs font-mono text-muted/60 uppercase tracking-wider mb-3 flex items-center gap-2">
                <CalendarDays size={11} />
                Past ({past.length})
              </div>
              <div className="space-y-2 opacity-50">
                {past.slice(0, 5).map(evt => (
                  <div key={evt.id} className="border border-border/50 bg-surface/50 p-3 flex items-start justify-between group">
                    <div>
                      <div className="text-sm font-mono text-text/70">{evt.title}</div>
                      <div className="text-xs font-mono text-muted/60 mt-1">{formatEventTime(evt.event_time)}</div>
                    </div>
                    <button
                      onClick={() => deleteEvent(evt.id)}
                      className="text-muted/50 hover:text-danger opacity-0 group-hover:opacity-100 transition-all p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {events.length === 0 && (
            <div className="text-center py-12 text-muted/50">
              <CalendarDays size={24} className="mx-auto mb-3 opacity-30" />
              <div className="text-sm font-mono">No events. I operate in a timeless void.</div>
              <div className="text-xs mt-1">Add events and I will factor them into every response.</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
