/**
 * App state and everything that changes it: the chat list, messages, ticks, typing, presence.
 * Components read it with useStore(selector); socket frames and user actions update it here.
 * Messages live in memory only (the server is the source of truth, as on WhatsApp Web).
 */
import { useSyncExternalStore } from 'react';
import * as api from './api';
import { AGENT_ID, HISTORY_PAGE, MAX_MESSAGE_CHARS } from './config';
import { isGroupId, previewText, sameUser, toMs } from './format';
import { notifyMessage, notifyReaction, updateTitle } from './notify';
import { socket } from './socket';

const initial = {
  me: null,
  prefs: {},
  connected: false,
  ready: false, // first chat list loaded
  syncError: null,
  chats: {}, // id -> chat
  messages: {}, // chatId -> { list, loaded, loading, hasMore, error }
  typing: {}, // chatId -> [{ id, name, avatar_color, avatar_url }]
  groupInfo: {}, // groupId -> details from /api/groups/{id}
  activeId: null,
  call: null, // see calls.js
  dialog: null,
  toasts: [],
  statusVersion: 0, // bumps when someone posts a status
};

let state = initial;
const subs = new Set();
const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

export const getState = () => state;

export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  if (!next) return;
  state = { ...state, ...next };
  subs.forEach((fn) => fn());
}

export function useStore(selector) {
  return useSyncExternalStore(subscribe, () => selector(state));
}

/* ------------------------------------------------------------------ */
/* toasts                                                               */
/* ------------------------------------------------------------------ */

let toastSeq = 0;
export function toast(text, kind = 'info') {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
}

/** confirmDialog({ title, body, buttons: [{ label, danger, onClick }] }): a small confirm dialog. */
export function confirmDialog({ title, body, buttons, cancelLabel = 'Cancel' }) {
  setState({ dialog: { title, body, buttons, cancelLabel } });
}

/* ------------------------------------------------------------------ */
/* normalising server data                                              */
/* ------------------------------------------------------------------ */

const myId = () => state.me?.id;

// Server-made previews name the actor ("Alice created the group…"); I'm "You"
function asViewer(text) {
  const name = state.me?.username;
  const s = String(text ?? '');
  return name && s.startsWith(`${name} `) ? `You ${s.slice(name.length + 1)}` : s;
}

function normChat(item, prev = {}) {
  return {
    ...prev,
    id: String(item.id),
    phone: item.phone_number || prev.phone || '',
    name: item.name || prev.name || 'Flick user',
    avatar_color: item.avatar_color || prev.avatar_color,
    avatar_url: item.avatar_url ?? prev.avatar_url ?? null,
    quote: item.quote ?? prev.quote ?? '',
    last_message: item.last_message != null ? asViewer(item.last_message) : prev.last_message ?? '',
    time: item.time || prev.time || '',
    unread: Number(item.unread ?? prev.unread ?? 0) || 0,
    is_group: !!(item.is_group || isGroupId(String(item.id))),
    member_count: item.member_count ?? prev.member_count ?? null,
    is_member: item.is_member ?? prev.is_member ?? true,
    last_seen: item.last_seen ?? prev.last_seen ?? null,
    online: prev.online ?? !!item.online,
    isAgent: String(item.id) === AGENT_ID,
  };
}

function parseMeta(raw) {
  let meta = raw;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = null;
    }
  }
  return meta && typeof meta === 'object' ? { ...meta } : null;
}

export function normMessage(raw, chatId) {
  let meta = parseMeta(raw.metadata);
  const content = String(raw.content ?? '');
  const url = String(meta?.media_url || meta?.uri || '');
  if (meta?.type === 'audio' || url.includes('/audio/') || url.endsWith('.m4a') || content.startsWith('🎙️ Voice message')) {
    meta = { ...(meta || {}), type: 'audio', media_url: meta?.media_url || meta?.uri || null };
  } else if (meta && !meta.type && (meta.media_url || meta.uri)) {
    meta = { ...meta, type: 'image', media_url: meta.media_url || meta.uri };
  } else if (!meta && /^(https?:\/\/\S+\.(jpe?g|png|gif|webp)|\/uploads\/images\/\S+)$/i.test(content.trim())) {
    meta = { type: 'image', media_url: content.trim() };
  }
  const isSystem = raw.kind === 'system';
  return {
    id: String(raw.message_id || raw.id),
    clientId: raw.client_msg_id || null,
    chatId,
    senderId: raw.sender_id,
    mine: !isSystem && sameUser(raw.sender_id, myId()),
    text: content,
    ts: toMs(raw.timestamp),
    status: String(raw.status || 'sent').toLowerCase(),
    replyTo: raw.reply_to && typeof raw.reply_to === 'object' ? raw.reply_to : null,
    metadata: meta,
    edited: !!raw.is_edited,
    kind: isSystem ? 'system' : 'text',
    senderName: raw.sender_name || null,
    senderColor: raw.sender_color || null,
    senderAvatar: raw.sender_avatar_url || null,
    reactions: Array.isArray(raw.reactions) ? raw.reactions : [],
  };
}

/** Chat id in the list for a user id / phone number (the list uses account ids). */
export function chatIdFor(id) {
  if (!id) return null;
  const key = String(id);
  if (state.chats[key]) return key;
  if (isGroupId(key)) return null;
  const hit = Object.values(state.chats).find((c) => !c.is_group && (sameUser(c.id, key) || sameUser(c.phone, key)));
  return hit ? hit.id : null;
}

/* ------------------------------------------------------------------ */
/* message list helpers                                                 */
/* ------------------------------------------------------------------ */

const RANK = { failed: 0, pending: 1, sent: 2, delivered: 3, read: 4 };
const better = (a, b) => ((RANK[b] ?? 2) > (RANK[a] ?? 2) ? b : a);

function mergeInto(list, incoming) {
  const out = list.slice();
  const index = new Map();
  out.forEach((m, i) => {
    index.set(m.id, i);
    if (m.clientId) index.set(`c:${m.clientId}`, i);
  });
  for (const m of incoming) {
    const i = index.get(m.id) ?? (m.clientId ? index.get(`c:${m.clientId}`) : undefined);
    if (i === undefined) {
      out.push(m);
      index.set(m.id, out.length - 1);
      if (m.clientId) index.set(`c:${m.clientId}`, out.length - 1);
    } else {
      const old = out[i];
      out[i] = { ...old, ...m, status: old.mine ? better(old.status, m.status) : m.status };
      index.set(m.id, i);
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function updateMessages(chatId, fn) {
  setState((s) => {
    const box = s.messages[chatId];
    if (!box) return null;
    const list = fn(box.list);
    if (list === box.list) return null;
    return { messages: { ...s.messages, [chatId]: { ...box, list } } };
  });
}

function addLive(chatId, msg) {
  setState((s) => {
    const box = s.messages[chatId];
    if (!box) return null; // not opened yet: history will include it
    return { messages: { ...s.messages, [chatId]: { ...box, list: mergeInto(box.list, [msg]) } } };
  });
}

function patchChat(chatId, patch) {
  setState((s) => {
    const c = s.chats[chatId];
    if (!c) return null;
    return { chats: { ...s.chats, [chatId]: { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } } };
  });
}

function findMessage(id) {
  for (const [chatId, box] of Object.entries(state.messages)) {
    const m = box.list.find((x) => x.id === id || x.clientId === id);
    if (m) return { chatId, m };
  }
  return null;
}

function totalUnread() {
  return Object.values(state.chats).reduce((n, c) => n + (c.unread ? 1 : 0), 0);
}

/* ------------------------------------------------------------------ */
/* session start / sync                                                 */
/* ------------------------------------------------------------------ */

let cursor = null;
let syncing = null;
let started = false;

export async function startApp(user) {
  if (started) return;
  started = true;
  setState({ ...initial, me: user });
  socket.on(handleFrame);
  socket.start(user.id);
  const me = await api.getMe();
  if (me.ok) setState({ me: { ...user, ...me.data }, prefs: me.data.prefs || {} });
  await sync(true);
}

export function stopApp() {
  started = false;
  cursor = null;
  socket.stop();
  socket.listeners.clear();
  clearTypingTimers();
  setState({ ...initial });
  updateTitle(0);
}

export function sync(full = false) {
  if (syncing) return syncing;
  syncing = (async () => {
    let more = true;
    let first = true;
    while (more) {
      const res = await api.syncConversations(full && first ? null : cursor);
      if (!res.ok) {
        setState({ syncError: res.error, ready: true });
        break;
      }
      const page = res.data;
      cursor = page.cursor;
      setState((s) => {
        const chats = page.full_sync ? {} : { ...s.chats };
        if (page.full_sync) {
          // keep presence we already know
          Object.values(s.chats).forEach((c) => {
            if (c.online) chats[c.id] = c;
          });
        }
        for (const row of [...(page.created || []), ...(page.updated || [])]) {
          const id = String(row.id);
          const prev = s.chats[id] || {};
          const next = normChat(row, prev);
          // Open and on screen: it's being read right now
          if (id === s.activeId && isActiveVisible()) next.unread = 0;
          chats[id] = next;
        }
        for (const id of page.deleted || []) delete chats[String(id)];
        return { chats, ready: true, syncError: null };
      });
      more = !!page.has_more;
      first = false;
    }
    updateTitle(totalUnread());
    syncing = null;
  })();
  return syncing;
}

/* ------------------------------------------------------------------ */
/* opening chats / history                                              */
/* ------------------------------------------------------------------ */

const isActiveVisible = () => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();

export function openChat(chatId) {
  if (!chatId) {
    setState({ activeId: null });
    return;
  }
  setState({ activeId: chatId });
  const box = state.messages[chatId];
  if (!box || (!box.loaded && !box.loading)) loadHistory(chatId);
  else refreshLatest(chatId);
  markChatRead(chatId);
  if (isGroupId(chatId)) loadGroupInfo(chatId);
  else if (chatId !== AGENT_ID) socket.queryPresence(chatId);
}

/** Opens a chat with someone who isn't in the list yet (new chat). */
export function openPerson(person) {
  const id = String(person.id);
  if (!state.chats[id]) {
    setState((s) => ({
      chats: {
        ...s.chats,
        [id]: normChat({ ...person, name: person.name || person.username, last_message: '', time: '', unread: 0 }),
      },
    }));
  }
  openChat(id);
}

export async function loadHistory(chatId) {
  setState((s) => ({
    messages: {
      ...s.messages,
      [chatId]: { list: s.messages[chatId]?.list || [], loaded: false, loading: true, hasMore: true, error: null },
    },
  }));
  const res = await api.getHistory(chatId, 0, HISTORY_PAGE);
  setState((s) => {
    const box = s.messages[chatId] || { list: [] };
    if (!res.ok) {
      return { messages: { ...s.messages, [chatId]: { ...box, loading: false, loaded: false, error: res.error } } };
    }
    const page = (Array.isArray(res.data) ? res.data : []).map((m) => normMessage(m, chatId));
    return {
      messages: {
        ...s.messages,
        [chatId]: { list: mergeInto(box.list, page), loaded: true, loading: false, hasMore: page.length >= HISTORY_PAGE, error: null },
      },
    };
  });
}

export async function loadOlder(chatId) {
  const box = state.messages[chatId];
  if (!box || box.loadingOlder || !box.hasMore || !box.loaded) return;
  setState((s) => ({ messages: { ...s.messages, [chatId]: { ...s.messages[chatId], loadingOlder: true } } }));
  const offset = box.list.filter((m) => m.status !== 'pending' && m.status !== 'failed').length;
  const res = await api.getHistory(chatId, offset, HISTORY_PAGE);
  setState((s) => {
    const cur = s.messages[chatId];
    if (!cur) return null;
    if (!res.ok) return { messages: { ...s.messages, [chatId]: { ...cur, loadingOlder: false } } };
    const page = (Array.isArray(res.data) ? res.data : []).map((m) => normMessage(m, chatId));
    return {
      messages: {
        ...s.messages,
        [chatId]: { ...cur, list: mergeInto(cur.list, page), loadingOlder: false, hasMore: page.length >= HISTORY_PAGE },
      },
    };
  });
}

/** After reconnecting: pick up what arrived meanwhile, and tick changes. */
async function refreshLatest(chatId) {
  const box = state.messages[chatId];
  if (!box?.loaded) return;
  const res = await api.getHistory(chatId, 0, HISTORY_PAGE);
  if (!res.ok || !Array.isArray(res.data)) return;
  const page = res.data.map((m) => normMessage(m, chatId));
  const serverIds = new Set(page.map((m) => m.id));
  const oldest = page.length ? page[0].ts : Infinity;
  updateMessages(chatId, (list) =>
    // Messages in the window that the server no longer has were deleted meanwhile
    mergeInto(
      list.filter((m) => m.ts < oldest || serverIds.has(m.id) || m.status === 'pending' || m.status === 'failed'),
      page,
    ),
  );
}

export function markChatRead(chatId) {
  const chat = state.chats[chatId];
  if (!chat || !isActiveVisible() || state.activeId !== chatId) return;
  const box = state.messages[chatId];
  const hasUnseen = chat.unread > 0 || box?.list.some((m) => !m.mine && m.status !== 'read' && m.kind !== 'system');
  if (!hasUnseen) return;
  if (chatId !== AGENT_ID) socket.markRead(chatId);
  patchChat(chatId, { unread: 0 });
  updateMessages(chatId, (list) => list.map((m) => (!m.mine && m.status !== 'read' ? { ...m, status: 'read' } : m)));
  updateTitle(totalUnread());
}

/* ------------------------------------------------------------------ */
/* sending                                                              */
/* ------------------------------------------------------------------ */

const ackTimers = new Map();
const newTempId = () => `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export function sendMessage(chatId, text, { replyTo = null, metadata = null } = {}) {
  const content = String(text || '').trim();
  if (!content || !state.me) return;
  if (content.length > MAX_MESSAGE_CHARS) {
    toast(`Messages can be up to ${MAX_MESSAGE_CHARS} characters.`, 'error');
    return;
  }
  const tempId = newTempId();
  const msg = {
    id: tempId,
    clientId: tempId,
    chatId,
    senderId: state.me.id,
    mine: true,
    text: content,
    ts: Date.now(),
    status: 'pending',
    replyTo,
    metadata,
    edited: false,
    kind: 'text',
  };
  if (!state.messages[chatId]) {
    setState((s) => ({ messages: { ...s.messages, [chatId]: { list: [], loaded: false, loading: false, hasMore: true } } }));
  }
  addLive(chatId, msg);
  const chat = state.chats[chatId];
  patchChat(chatId, {
    last_message: chat?.is_group ? `You: ${previewText(msg)}` : previewText(msg),
    time: new Date().toISOString(),
  });
  transmit(chatId, msg);
}

function transmit(chatId, msg) {
  const payload = { receiverId: chatId, content: msg.text, tempId: msg.clientId, replyTo: msg.replyTo, metadata: msg.metadata };
  if (socket.sendMessage(payload)) {
    // No confirmation over the socket within 8 s: send the same message over HTTP (the server
    // recognises the id, so it's never stored twice)
    clearTimeout(ackTimers.get(msg.clientId));
    ackTimers.set(
      msg.clientId,
      setTimeout(() => sendOverHttp(chatId, msg), 8000),
    );
  } else {
    sendOverHttp(chatId, msg);
  }
}

async function sendOverHttp(chatId, msg) {
  ackTimers.delete(msg.clientId);
  const current = findMessage(msg.clientId);
  if (!current || current.m.status !== 'pending') return;
  const res = await api.sendMessageRest({
    receiver_id: chatId,
    content: msg.text,
    temp_msg_id: msg.clientId,
    reply_to: msg.replyTo || null,
    metadata: msg.metadata || null,
  });
  if (res.ok) {
    applyAck({ temp_msg_id: msg.clientId, message_id: res.data.message_id, timestamp: res.data.timestamp, status: res.data.status });
  } else {
    updateMessages(chatId, (list) => list.map((m) => (m.clientId === msg.clientId ? { ...m, status: 'failed', error: res.error } : m)));
    if (res.status && res.status !== 0) toast(res.error, 'error');
  }
}

export function retryMessage(chatId, id) {
  const hit = state.messages[chatId]?.list.find((m) => m.id === id);
  if (!hit) return;
  updateMessages(chatId, (list) => list.map((m) => (m.id === id ? { ...m, status: 'pending', error: null } : m)));
  transmit(chatId, { ...hit, status: 'pending' });
}

function resendPending() {
  for (const [chatId, box] of Object.entries(state.messages)) {
    box.list.filter((m) => m.mine && m.status === 'pending').forEach((m) => transmit(chatId, m));
  }
}

function applyAck(data) {
  const temp = String(data.temp_msg_id || data.temp_id || '');
  clearTimeout(ackTimers.get(temp));
  ackTimers.delete(temp);
  const realId = String(data.message_id || '');
  const hit = (temp && findMessage(temp)) || (realId && findMessage(realId));
  if (!hit) return;
  const status = String(data.status || 'sent').toLowerCase();
  updateMessages(hit.chatId, (list) => {
    const updated = list.map((m) =>
      m === hit.m
        ? {
            ...m,
            id: realId || m.id,
            ts: data.timestamp ? toMs(data.timestamp) : m.ts,
            status: better(m.status === 'pending' || m.status === 'failed' ? 'sent' : m.status, status),
            error: null,
          }
        : m,
    );
    // The same message may already be listed under its real id (e.g. it came with history)
    const seen = new Set();
    return updated.filter((m) => !seen.has(m.id) && seen.add(m.id));
  });
}

/**
 * React to a message: one reaction per person; picking the reaction you already gave removes it.
 * Shown at once, then replaced with the server's list (or put back if it fails).
 */
export async function reactToMessage(chatId, id, emoji) {
  const myIdNow = state.me?.id;
  const msg = state.messages[chatId]?.list.find((m) => m.id === id);
  if (!msg || !myIdNow) return;
  const before = msg.reactions || [];
  const mine = before.find((r) => sameUser(r.user_id, myIdNow));
  const next = mine?.emoji === emoji ? null : emoji;
  const others = before.filter((r) => !sameUser(r.user_id, myIdNow));
  const setReactions = (reactions) =>
    updateMessages(chatId, (list) => list.map((m) => (m.id === id ? { ...m, reactions } : m)));
  setReactions(next ? [...others, { user_id: myIdNow, emoji: next }] : others);
  const res = await api.reactToMessage(id, next);
  if (res.ok) setReactions(res.data.reactions || []);
  else {
    setReactions(before);
    toast(res.status === 404 ? 'Couldn’t react to this message. Refresh and try again.' : res.error, 'error');
  }
}

export async function editMessage(chatId, id, text) {
  const content = String(text || '').trim();
  if (!content) return false;
  const res = await api.editMessage(id, content);
  if (!res.ok) {
    toast(res.error, 'error');
    return false;
  }
  updateMessages(chatId, (list) => list.map((m) => (m.id === id ? { ...m, text: content, edited: true } : m)));
  return true;
}

export async function deleteMessage(chatId, id, forEveryone) {
  const res = await api.deleteMessage(id, forEveryone);
  if (!res.ok) {
    toast(res.error, 'error');
    return;
  }
  removeLocal(chatId, id);
}

function removeLocal(chatId, id) {
  updateMessages(chatId, (list) => list.filter((m) => m.id !== id));
  const box = state.messages[chatId];
  const last = box?.list[box.list.length - 1];
  if (last) {
    const chat = state.chats[chatId];
    const prefix = chat?.is_group && last.kind !== 'system' ? `${last.mine ? 'You' : last.senderName || 'Someone'}: ` : '';
    patchChat(chatId, { last_message: prefix + previewText(last) });
  }
}

/* ------------------------------------------------------------------ */
/* typing                                                               */
/* ------------------------------------------------------------------ */

const typingTimers = {};
function clearTypingTimers() {
  Object.values(typingTimers).forEach(clearTimeout);
  Object.keys(typingTimers).forEach((k) => delete typingTimers[k]);
}

function setTyper(chatId, person, on) {
  const key = `${chatId}|${person.id}`;
  clearTimeout(typingTimers[key]);
  delete typingTimers[key];
  setState((s) => {
    const cur = s.typing[chatId] || [];
    const others = cur.filter((t) => !sameUser(t.id, person.id));
    const next = on ? [...others, person] : others;
    if (!on && others.length === cur.length) return null;
    return { typing: { ...s.typing, [chatId]: next } };
  });
  // They re-send "typing" every ~2 s while typing; drop them if that stops
  if (on) typingTimers[key] = setTimeout(() => setTyper(chatId, person, false), chatId.startsWith('grp_') ? 4500 : 6000);
}

/* ------------------------------------------------------------------ */
/* groups                                                               */
/* ------------------------------------------------------------------ */

export async function loadGroupInfo(groupId) {
  const res = await api.getGroup(groupId);
  if (res.ok) {
    setState((s) => ({ groupInfo: { ...s.groupInfo, [groupId]: res.data } }));
    patchChat(groupId, { is_member: res.data.is_member !== false, member_count: res.data.member_count ?? res.data.members?.length });
  } else if (res.status === 403 || res.status === 404) {
    patchChat(groupId, { is_member: false });
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* incoming frames                                                      */
/* ------------------------------------------------------------------ */

function bumpChat(chatId, { preview, ts, unreadDelta = 0 }) {
  setState((s) => {
    const c = s.chats[chatId];
    if (!c) return null;
    const reading = chatId === s.activeId && isActiveVisible();
    return {
      chats: {
        ...s.chats,
        [chatId]: {
          ...c,
          last_message: preview,
          time: new Date(ts || Date.now()).toISOString(),
          unread: reading ? 0 : (c.unread || 0) + unreadDelta,
        },
      },
    };
  });
  updateTitle(totalUnread());
}

function incoming(chatId, msg, preview) {
  addLive(chatId, msg);
  bumpChat(chatId, { preview, ts: msg.ts, unreadDelta: msg.mine || msg.kind === 'system' ? 0 : 1 });
  if (!msg.mine && msg.kind !== 'system') {
    if (chatId === state.activeId && isActiveVisible()) markChatRead(chatId);
    else notifyMessage(state.chats[chatId], msg, state.prefs);
  }
}

function handleFrame({ type, data }) {
  switch (type) {
    case 'connection_status':
      setState({ connected: !!data?.connected });
      if (data?.connected) {
        sync(false);
        resendPending();
        if (state.activeId) refreshLatest(state.activeId);
      }
      return;

    case 'chat_message': {
      if (!data?.sender_id) return;
      let chatId = chatIdFor(data.sender_id);
      if (!chatId) {
        chatId = String(data.sender_id);
        setState((s) => ({
          chats: {
            ...s.chats,
            [chatId]: normChat({ id: chatId, phone_number: chatId, name: data.sender_name || 'New contact', unread: 0 }),
          },
        }));
        sync(false); // fetch their real name / photo
      }
      const msg = normMessage({ ...data, status: 'delivered' }, chatId);
      incoming(chatId, msg, previewText(msg));
      setTyper(chatId, { id: data.sender_id }, false);
      return;
    }

    case 'message_sent_sync': {
      // Something I sent from my phone: show it here too
      const target = data?.group_id || data?.receiver_id;
      const chatId = data?.group_id ? (state.chats[data.group_id] ? data.group_id : null) : chatIdFor(target);
      if (!chatId) {
        sync(false);
        return;
      }
      const msg = normMessage({ ...data, sender_id: state.me?.id }, chatId);
      addLive(chatId, msg);
      bumpChat(chatId, { preview: data.group_id ? `You: ${previewText(msg)}` : previewText(msg), ts: msg.ts });
      return;
    }

    case 'group_message': {
      const chatId = data?.group_id;
      if (!chatId) return;
      if (!state.chats[chatId]) {
        sync(false);
        return;
      }
      const msg = normMessage(data, chatId);
      const preview =
        msg.kind === 'system' ? msg.text : `${msg.mine ? 'You' : data.sender_name || 'Someone'}: ${previewText(msg)}`;
      incoming(chatId, msg, preview);
      if (data.sender_id) setTyper(chatId, { id: data.sender_id }, false);
      if (msg.kind === 'system') {
        sync(false);
        if (state.groupInfo[chatId] || state.activeId === chatId) loadGroupInfo(chatId);
      }
      return;
    }

    case 'group_updated':
      sync(false);
      if (data?.group_id && (state.groupInfo[data.group_id] || state.activeId === data.group_id)) loadGroupInfo(data.group_id);
      return;

    case 'ack_sent':
      applyAck(data || {});
      return;

    case 'message_error': {
      const temp = String(data?.temp_msg_id || '');
      clearTimeout(ackTimers.get(temp));
      const hit = findMessage(temp);
      if (hit) {
        updateMessages(hit.chatId, (list) => list.map((m) => (m.clientId === temp ? { ...m, status: 'failed', error: data.reason } : m)));
      }
      if (data?.reason) toast(data.reason, 'error');
      return;
    }

    case 'ack_delivered': {
      const hit = data?.message_id && findMessage(String(data.message_id));
      if (hit) {
        updateMessages(hit.chatId, (list) =>
          list.map((m) => (m.id === String(data.message_id) && m.mine ? { ...m, status: better(m.status, 'delivered') } : m)),
        );
      }
      return;
    }

    case 'ack_read': {
      const ids = new Set((data?.message_ids || []).map(String));
      const chatId = chatIdFor(data?.reader_id);
      if (!chatId) return;
      updateMessages(chatId, (list) =>
        list.map((m) => (m.mine && (ids.size ? ids.has(m.id) : true) ? { ...m, status: 'read' } : m)),
      );
      return;
    }

    case 'group_receipt': {
      const chatId = data?.group_id;
      if (!chatId) return;
      const delivered = data.delivered_upto ? toMs(data.delivered_upto) : 0;
      const read = data.read_upto ? toMs(data.read_upto) : 0;
      updateMessages(chatId, (list) =>
        list.map((m) => {
          if (!m.mine || m.status === 'pending' || m.status === 'failed') return m;
          const next = m.ts <= read ? 'read' : m.ts <= delivered ? better(m.status, 'delivered') : m.status;
          return next === m.status ? m : { ...m, status: next };
        }),
      );
      return;
    }

    case 'read_sync': {
      // Read on my phone: clear the badge here
      const chatId = isGroupId(data?.peer_id) ? data.peer_id : chatIdFor(data?.peer_id);
      if (chatId) {
        patchChat(chatId, { unread: 0 });
        updateTitle(totalUnread());
      }
      return;
    }

    case 'message_edited': {
      const chatId = data?.group_id || null;
      const hit = findMessage(String(data?.message_id));
      if (hit) {
        updateMessages(hit.chatId, (list) =>
          list.map((m) => (m.id === String(data.message_id) ? { ...m, text: data.content, edited: true } : m)),
        );
        const box = state.messages[hit.chatId];
        if (box?.list[box.list.length - 1]?.id === String(data.message_id)) sync(false);
      } else if (chatId) sync(false);
      return;
    }

    case 'message_reaction': {
      const hit = data?.message_id && findMessage(String(data.message_id));
      if (hit) {
        updateMessages(hit.chatId, (list) =>
          list.map((m) => (m.id === String(data.message_id) ? { ...m, reactions: data.reactions || [] } : m)),
        );
      }
      // Someone reacted to my message: chat list line + (if I'm not looking) a notification
      if (data?.emoji && sameUser(data.sender_id, state.me?.id) && !sameUser(data.user_id, state.me?.id)) {
        const chatId = data.group_id || chatIdFor(data.user_id);
        const about = data.message_preview ? `: “${data.message_preview}”` : ' your message';
        if (chatId) {
          patchChat(chatId, {
            last_message: data.group_id ? `${data.name} reacted ${data.emoji} to${about}` : `Reacted ${data.emoji} to${about}`,
            time: new Date().toISOString(),
          });
        }
        const chat = chatId && state.chats[chatId];
        if (chat && state.prefs.msg_notifications !== false && !(chatId === state.activeId && isActiveVisible())) {
          notifyReaction(chat, data, hit?.m);
        }
      }
      return;
    }

    case 'message_deleted': {
      const hit = findMessage(String(data?.message_id));
      if (hit) removeLocal(hit.chatId, hit.m.id);
      else sync(false);
      return;
    }

    case 'typing_start':
    case 'typing_stop': {
      const chatId = chatIdFor(data?.sender_id);
      if (chatId) setTyper(chatId, { id: data.sender_id, name: state.chats[chatId]?.name }, type === 'typing_start');
      return;
    }

    case 'group_typing': {
      if (!data?.group_id || sameUser(data.user_id, state.me?.id)) return;
      setTyper(
        data.group_id,
        { id: data.user_id, name: data.name, avatar_color: data.avatar_color, avatar_url: data.avatar_url },
        !!data.typing,
      );
      return;
    }

    case 'presence_update': {
      const ids = [data?.user_id, ...(data?.aliases || [])].filter(Boolean);
      setState((s) => {
        let changed = false;
        const chats = { ...s.chats };
        for (const c of Object.values(chats)) {
          if (c.is_group || !ids.some((i) => sameUser(c.id, i) || sameUser(c.phone, i))) continue;
          chats[c.id] = { ...c, online: !!data.is_online, last_seen: data.is_online ? c.last_seen : data.last_seen || null };
          changed = true;
        }
        return changed ? { chats } : null;
      });
      return;
    }

    case 'online_users_snapshot': {
      const ids = data?.online_user_ids || [];
      setState((s) => {
        const chats = {};
        for (const c of Object.values(s.chats)) {
          chats[c.id] = c.is_group ? c : { ...c, online: ids.some((i) => sameUser(c.id, i) || sameUser(c.phone, i)) };
        }
        return { chats };
      });
      return;
    }

    case 'status_update':
      setState((s) => ({ statusVersion: s.statusVersion + 1 }));
      return;

    default:
  }
}

/* Coming back to the tab: the open chat counts as read */
if (typeof window !== 'undefined') {
  const onFocus = () => state.activeId && markChatRead(state.activeId);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && onFocus());
}
