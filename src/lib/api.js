/**
 * REST calls to the Flick backend. Every call returns { ok, status, data, error } and never
 * throws. A 401 means the browser was logged out (from the phone, or by logging out there):
 * the session is cleared and the app goes back to the link screen.
 */
import { API_BASE } from './config';
import { clearSession, getSession } from './session';

const TIMEOUT_MS = 20000;

const errorText = (data, status) => {
  const detail = data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  if (status === 0) return 'No connection. Check your internet.';
  if (status === 429) return 'Too many requests. Wait a moment and try again.';
  if (status >= 500) return 'Flick is having trouble right now. Try again in a moment.';
  return 'Something went wrong. Try again.';
};

export async function request(path, { method = 'GET', body, auth = true, timeout = TIMEOUT_MS, keepalive = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getSession()?.token;
  if (auth) {
    if (!token) return { ok: false, status: 401, data: null, error: 'Signed out' };
    headers.Authorization = `Bearer ${token}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      keepalive,
      credentials: 'omit', // bearer token only: no cookies, so no cross-site request forgery
      referrerPolicy: 'no-referrer',
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.status === 401 && auth && getSession()?.token === token) clearSession();
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : errorText(data, res.status) };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    return { ok: false, status: 0, data: null, error: aborted ? 'The request timed out. Try again.' : errorText(null, 0) };
  } finally {
    clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

/* ---- linking ---- */
export const startLink = () => request('/api/web/link/start', { method: 'POST', body: {}, auth: false });
export const pollLink = (link_id, poll_secret) =>
  request('/api/web/link/poll', { method: 'POST', body: { link_id, poll_secret }, auth: false });
export const getWsTicket = () => request('/api/web/ws-ticket', { method: 'POST', timeout: 10000 });
export const getMe = () => request('/api/web/me');
export const logout = () => request('/api/web/logout', { method: 'POST' });
export const listSessions = () => request('/api/web/sessions');

/* ---- profile / settings ---- */
export const updateProfile = (changes) => request('/api/users/profile', { method: 'PATCH', body: changes });
export const updatePreferences = (changes) => request('/api/users/preferences', { method: 'PUT', body: changes });
export const getUser = (id) => request(`/api/users/${enc(id)}`);

/* ---- chats ---- */
export const syncConversations = (cursor) =>
  request(`/api/sync/conversations?limit=200${cursor ? `&cursor=${enc(cursor)}` : ''}`);
export const lookupNumbers = (phone_numbers) => request('/api/contacts/sync', { method: 'POST', body: { phone_numbers } });
export const getHistory = (peerId, offset = 0, limit = 50) =>
  request(`/api/messages/${enc(peerId)}?limit=${limit}&offset=${offset}`);
export const sendMessageRest = (payload) => request('/api/messages/send', { method: 'POST', body: payload });
export const editMessage = (id, content) => request(`/api/messages/${enc(id)}`, { method: 'PUT', body: { content } });
export const deleteMessage = (id, forEveryone) =>
  request(`/api/messages/${enc(id)}?for_everyone=${forEveryone ? 'true' : 'false'}`, { method: 'DELETE' });
export const archiveChat = (peerId, archived) =>
  request(`/api/chats/${enc(peerId)}/archive`, { method: 'PUT', body: { archived } });
export const reactToMessage = (id, emoji) =>
  request(`/api/messages/${enc(id)}/reaction`, { method: 'PUT', body: { emoji: emoji || null } });
export const uploadImage = (dataUrl, ext) =>
  request('/api/upload/image', { method: 'POST', body: { image_base64: dataUrl, ext }, timeout: 60000 });
export const uploadAudio = (dataUrl, duration) =>
  request('/api/upload/audio', { method: 'POST', body: { audio_base64: dataUrl, duration }, timeout: 60000 });

/* ---- groups ---- */
const groupPath = (id, suffix = '') => `/api/groups/${enc(id)}${suffix}`;
export const createGroup = ({ name, memberIds, avatarColor }) =>
  request('/api/groups', { method: 'POST', body: { name, member_ids: memberIds, avatar_color: avatarColor } });
export const getGroup = (id) => request(groupPath(id));
export const updateGroup = (id, changes) => request(groupPath(id), { method: 'PATCH', body: changes });
export const addGroupMembers = (id, memberIds) =>
  request(groupPath(id, '/members'), { method: 'POST', body: { member_ids: memberIds } });
export const removeGroupMember = (id, userId) => request(groupPath(id, `/members/${enc(userId)}`), { method: 'DELETE' });
export const leaveGroup = (id) => request(groupPath(id, '/leave'), { method: 'POST' });
export const setGroupAdmin = (id, userId, admin) =>
  request(groupPath(id, `/admins/${enc(userId)}`), { method: 'POST', body: { admin } });
export const deleteGroupChat = (id) => request(groupPath(id, '/chat'), { method: 'DELETE' });

/* ---- status ---- */
export const getStatusFeed = () => request('/api/statuses/feed');
export const postStatus = (payload) => request('/api/statuses', { method: 'POST', body: payload });
export const viewStatus = (id) => request(`/api/statuses/${enc(id)}/view`, { method: 'POST' });
export const deleteStatus = (id) => request(`/api/statuses/${enc(id)}`, { method: 'DELETE' });

/* ---- calls ---- */
export const callOffer = (payload) => request('/api/call/offer', { method: 'POST', body: payload });
export const callAnswer = (payload) => request('/api/call/answer', { method: 'POST', body: payload });
export const callReject = (payload, keepalive = false) =>
  request('/api/call/reject', { method: 'POST', body: payload, keepalive });
export const callEnd = (payload, keepalive = false) => request('/api/call/end', { method: 'POST', body: payload, keepalive });
export const callStatus = (id) => request(`/api/call/status/${enc(id)}`, { timeout: 10000 });
export const iceServers = () => request('/api/call/ice-servers', { timeout: 8000 });
