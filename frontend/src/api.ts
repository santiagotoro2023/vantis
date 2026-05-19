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
  sendMessage: (content: string, sessionId?: string) =>
    request<{ response: string; emotion_state: Record<string, number>; session_id: string }>(
      '/chat/message',
      { method: 'POST', body: JSON.stringify({ content, session_id: sessionId }) }
    ),

  getChatHistory: (sessionId: string) =>
    request<Array<{ role: string; content: string; timestamp: string }>>(`/chat/history/${sessionId}`),

  getChatSessions: () =>
    request<Array<{ session_id: string; started: string; message_count: number }>>('/chat/sessions'),

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
}
