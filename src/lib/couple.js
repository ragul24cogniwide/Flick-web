/**
 * The couple on Flick Web, same as the phone app (Apptesting/src/services/couple.js): who I'm
 * paired with, our anniversary, nicknames, moods and "Our story", from the server
 * (backend couple_routes.py). Changes from the other phone arrive as a `couple_updated` frame.
 *
 *   const couple = useCouple();   // { status: 'none' | 'waiting' | 'paired', ... } or null while loading
 */
import { useSyncExternalStore } from 'react';
import * as api from './api';
import { firstName, sameUser } from './format';
import { socket } from './socket';
import { ensureChat, sendMessage } from './store';

let current = null;
const subs = new Set();
let offSocket = null;
let inflight = null;

const set = (next) => {
  current = next || { status: 'none' };
  subs.forEach((fn) => fn());
};

export const getCouple = () => current;
export const useCouple = () =>
  useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => current
  );

async function call(path, options) {
  const res = await api.request(path, options);
  if (res.ok && res.data?.status) set(res.data);
  return res;
}

export function refreshCouple() {
  if (!inflight) {
    inflight = call('/api/couple').finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
export const createInvite = () => call('/api/couple/invite', { method: 'POST' });
export const joinCouple = (code, { anniversary = null, nickname = null } = {}) =>
  call('/api/couple/join', { method: 'POST', body: { code, anniversary, nickname } });
export const updateCouple = (fields) => call('/api/couple', { method: 'PATCH', body: fields });
export const unpairCouple = () => call('/api/couple', { method: 'DELETE' });

/** Called once the app has started (and its socket listeners are set up). */
export function startCouple() {
  offSocket?.();
  offSocket = socket.on(({ type, data }) => {
    if (type === 'couple_updated') refreshCouple();
    else if (type === 'connection_status' && data?.connected && current) refreshCouple();
  });
  refreshCouple();
}
export function stopCouple() {
  offSocket?.();
  offSocket = null;
  current = null;
  subs.forEach((fn) => fn());
}

/* ------------------------------- helpers ------------------------------- */

const DAY = 86400000;
const parseDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function daysTogether(anniversary, now = new Date()) {
  const start = parseDay(anniversary);
  return start ? Math.max(1, Math.round((startOfDay(now) - start) / DAY) + 1) : null;
}

export function nextAnniversary(anniversary, now = new Date()) {
  const start = parseDay(anniversary);
  if (!start) return null;
  const today = startOfDay(now);
  let next = new Date(today.getFullYear(), start.getMonth(), start.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, start.getMonth(), start.getDate());
  return { days: Math.round((next - today) / DAY), date: next, years: next.getFullYear() - start.getFullYear() };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDay(iso, { year = true } = {}) {
  const d = parseDay(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ''}` : '';
}

export const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function partnerTime(tz, now = new Date()) {
  if (tz === null || tz === undefined) return null;
  const there = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + tz * 60000);
  return there.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export const partnerName = (c) => c?.nickname || c?.partner?.name || 'Your person';
export const partnerFirstName = (c) => firstName(c?.partner?.name || 'Your person');
/** The name my love signals use for them: my nickname, else their first name. */
export const loveNameFor = (c) => (c?.status === 'paired' ? c.nickname || partnerFirstName(c) : null);

/** My person's chat id in a chat list, or null (pure: for useStore selectors). */
export function partnerChatIn(chats, c) {
  const p = c?.partner;
  if (!p) return null;
  if (chats[String(p.id)]) return String(p.id);
  const hit = Object.values(chats).find((x) => !x.is_group && (sameUser(x.id, p.id) || sameUser(x.phone, p.phone_number)));
  return hit ? hit.id : null;
}

/** The chat id of my person (added to the list if we haven't chatted yet). */
export function partnerChatId(c) {
  const p = c?.partner;
  if (!p) return null;
  return ensureChat({ id: p.id, phone_number: p.phone_number, name: p.name, avatar_url: p.avatar_url, avatar_color: p.avatar_color });
}

/** Sends to my person from outside the chat (Us panel): a normal message, like in the chat. */
export function sendToPartner(c, text, metadata = null) {
  const chatId = partnerChatId(c);
  if (!chatId || !text) return false;
  sendMessage(chatId, text, { metadata });
  return true;
}
