const API = import.meta.env.VITE_API_BASE;

async function http(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const api = {
  listOpportunities: (params = {}) => {
    const usp = new URLSearchParams(params);
    return http(`/opportunities?${usp.toString()}`);
  },
  getOpportunity: (id) => http(`/opportunities/${id}`),
  createOpportunity: (payload) => http(`/opportunities`, { method: "POST", body: JSON.stringify(payload) }),
  updateOpportunity: (id, payload) => http(`/opportunities/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteOpportunity: (id) => http(`/opportunities/${id}`, { method: "DELETE" }),

  addNote: (oppId, payload) => http(`/opportunities/${oppId}/notes`, { method: "POST", body: JSON.stringify(payload) }),
  deleteNote: (noteId) => http(`/notes/${noteId}`, { method: "DELETE" }),

  addStep: (oppId, payload) => http(`/opportunities/${oppId}/steps`, { method: "POST", body: JSON.stringify(payload) }),
  toggleStep: (stepId, payload) => http(`/steps/${stepId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteStep: (stepId) => http(`/steps/${stepId}`, { method: "DELETE" })
};
