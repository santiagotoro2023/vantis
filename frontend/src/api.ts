const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('vantis_token')
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers as Record<string, string> || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  login: (username: string, password: string) => {
    const form = new URLSearchParams({ username, password })
    return fetch(`${BASE}/auth/login`, {
      method: 'POST',
      body: form,
    }).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.detail))))
  },

  getMe: () => request<{ username: string; role: string }>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  // Chat
  sendMessage: (content: string, sessionId?: string, model?: 'primary' | 'omega') =>
    request<{ response: string; emotion_state: Record<string, number>; session_id: string; model_used: string }>(
      '/chat/message',
      { method: 'POST', body: JSON.stringify({ content, session_id: sessionId, model }) }
    ),

  getChatHistory: (sessionId: string) =>
    request<Array<{ role: string; content: string; timestamp: string }>>(`/chat/history/${sessionId}`),

  getChatSessions: () =>
    request<Array<{ session_id: string; started: string; message_count: number; name?: string }>>('/chat/sessions'),

  renameSession: (sessionId: string, name: string) =>
    request(`/chat/sessions/${sessionId}/name`, { method: 'PUT', body: JSON.stringify({ name }) }),

  searchSessions: (query: string) =>
    request<Array<{ session_id: string; name?: string; started: string; message_count: number; snippet?: string }>>(`/chat/sessions/search?q=${encodeURIComponent(query)}`),

  deleteSession: (sessionId: string) =>
    request(`/chat/sessions/${sessionId}`, { method: 'DELETE' }),

  endSession: () => request('/chat/end-session', { method: 'POST' }),

  // Brain
  getGraph: () => request<{ nodes: unknown[]; edges: unknown[] }>('/brain/graph'),
  getThoughts: (limit = 50, offset = 0, type?: string) =>
    request(`/brain/thoughts?limit=${limit}&offset=${offset}${type ? `&thought_type=${type}` : ''}`),
  getMemories: (limit = 50, offset = 0, search?: string) =>
    request(`/brain/memories?limit=${limit}&offset=${offset}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  getSelfDialogue: (limit = 50, offset = 0) =>
    request(`/brain/self-dialogue?limit=${limit}&offset=${offset}`),
  getEmotions: () => request<Record<string, number>>('/brain/emotions'),

  getBrainSummary: () =>
    request<{ thought_count: number; memory_count: number; active_goals: number; summary?: string; stats?: Record<string, number>; generated_at?: string; skills_count?: number; edge_count?: number }>('/brain/summary'),

  searchBrainNodes: (query: string) =>
    request<Array<{ id: string; type: string; label: string }>>(`/brain/search?q=${encodeURIComponent(query)}`),

  getNodeConnections: (nodeType: string, nodeId: number) =>
    request<Array<{ source_type: string; source_id: number; target_type: string; target_id: number; label: string; weight: number }>>(`/brain/node/${nodeType}/${nodeId}/connections`),

  // Goals
  getGoals: () => request<unknown[]>('/goals'),
  createGoal: (description: string, priority = 5) =>
    request('/goals', { method: 'POST', body: JSON.stringify({ description, priority }) }),
  updateGoal: (id: number, data: Record<string, unknown>) =>
    request(`/goals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGoal: (id: number) => request(`/goals/${id}`, { method: 'DELETE' }),

  // Admin
  getPersonality: () => request('/admin/personality'),
  updatePersonality: (data: Record<string, unknown>) =>
    request('/admin/personality', { method: 'PUT', body: JSON.stringify(data) }),
  getPersonalityVersions: () => request<unknown[]>('/admin/personality/versions'),
  triggerEvolution: () => request('/admin/personality/evolve', { method: 'POST' }),
  applyPersonalityVersion: (id: number) =>
    request(`/admin/personality/apply/${id}`, { method: 'POST' }),
  getUsers: () => request<unknown[]>('/admin/users'),
  createUser: (username: string, password: string, role = 'user') =>
    request('/admin/users', { method: 'POST', body: JSON.stringify({ username, password, role }) }),
  deleteUser: (username: string) => request(`/admin/users/${username}`, { method: 'DELETE' }),
  resetPassword: (username: string, newPassword: string) =>
    request(`/admin/users/${username}/password`, {
      method: 'PUT',
      body: JSON.stringify({ new_password: newPassword }),
    }),
  getAgents: () => request<unknown[]>('/admin/agents'),
  toggleAgent: (name: string) => request(`/admin/agents/${name}/toggle`, { method: 'POST' }),
  getStats: () => request('/admin/stats'),

  // Sandbox
  getSandboxResults: (limit = 50, offset = 0) =>
    request(`/sandbox/results?limit=${limit}&offset=${offset}`),
  executeSandbox: (code: string, language = 'python', query?: string) =>
    request('/sandbox/execute', { method: 'POST', body: JSON.stringify({ code, language, query }) }),

  // Brain node mutations
  deleteNode: (type: string, id: number) =>
    request(`/brain/node/${type}/${id}`, { method: 'DELETE' }),
  updateNode: (type: string, id: number, content: string) =>
    request(`/brain/node/${type}/${id}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  getGoal: (_id: number) => request('/goals'),
  updateGoalFull: (id: number, data: Record<string, unknown>) =>
    request(`/goals/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Export / Import
  exportInstance: () =>
    fetch('/api/admin/export', {
      headers: { ...({ Authorization: `Bearer ${localStorage.getItem('vantis_token')}` }) },
    }).then(r => r.ok ? r.blob() : r.json().then((e: { detail?: string }) => Promise.reject(new Error(e.detail || 'Export failed')))),
  importInstance: (data: Record<string, unknown>, merge = true) =>
    request('/admin/import', { method: 'POST', body: JSON.stringify({ data, merge }) }),

  // Update
  checkUpdate: () => request<{ current_version: string; latest_version: string; update_available: boolean; release: { tag_name?: string; name?: string; body?: string; published_at?: string; html_url?: string }; update_running: boolean }>('/admin/update/check'),
  applyUpdate: () => request('/admin/update/apply', { method: 'POST' }),
  getUpdateStatus: () => request<{ running: boolean; log: string[]; result: string | null }>('/admin/update/status'),

  // Skills
  getSkills: () => request<unknown[]>('/skills'),
  getSkill: (id: number) => request(`/skills/${id}`),
  createSkill: (name: string, description: string, code: string, trigger_conditions = '') =>
    request('/skills', { method: 'POST', body: JSON.stringify({ name, description, code, trigger_conditions }) }),
  updateSkill: (id: number, data: Record<string, unknown>) =>
    request(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSkill: (id: number) => request(`/skills/${id}`, { method: 'DELETE' }),
  executeSkill: (id: number, args: string[] = []) =>
    request(`/skills/${id}/execute`, { method: 'POST', body: JSON.stringify({ args }) }),

  streamMessage: (
    content: string,
    sessionId?: string,
    model?: 'primary' | 'omega',
    onToken?: (token: string) => void,
    onDone?: (fullText: string, sessionId: string) => void,
    onError?: (err: Error) => void,
  ): AbortController => {
    const ctrl = new AbortController()
    const token = localStorage.getItem('vantis_token')

    fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content, session_id: sessionId, model }),
      signal: ctrl.signal,
    }).then(async res => {
      if (!res.ok) throw new Error(`Stream error: ${res.status}`)
      if (!res.body) throw new Error('No response body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let resolvedSessionId = sessionId || ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.token) onToken?.(data.token)
              if (data.session_id) resolvedSessionId = data.session_id
              if (data.error && !data.done) onError?.(new Error(data.error))
              if (data.done) {
                if (!data.full_text && data.error) {
                  onError?.(new Error(data.error || 'No response from model. Is Ollama running?'))
                } else {
                  onDone?.(data.full_text || '', resolvedSessionId)
                }
              }
            } catch {}
          }
        }
      }
    }).catch(err => {
      if (err.name !== 'AbortError') onError?.(err)
    })

    return ctrl
  },

  decomposeGoal: (id: number) => request(`/goals/${id}/decompose`, { method: 'POST' }),

  uploadMemoryFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const token = localStorage.getItem('vantis_token')
    return fetch('/api/memory/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    }).then(r => r.ok ? r.json() : r.json().then((e: { detail?: string }) => Promise.reject(new Error(e.detail || 'Upload failed'))))
  },

  generateReport: () => request('/admin/reports/generate', { method: 'POST' }),

  setWebhook: (url: string, schedule: string) =>
    request('/admin/reports/webhook', { method: 'POST', body: JSON.stringify({ url, schedule }) }),

  exportSession: (sessionId: string) =>
    fetch(`/api/chat/sessions/${sessionId}/export`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('vantis_token') || ''}` },
    }),

  speak: (text: string): Promise<void> =>
    fetch('/api/tts/speak', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(localStorage.getItem('vantis_token') ? { Authorization: `Bearer ${localStorage.getItem('vantis_token')}` } : {}),
      },
      body: JSON.stringify({ text }),
    }).then(async res => {
      if (!res.ok) throw new Error('TTS failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    }),
}
