/** Formatting and safety helpers shared by the whole app. */
import { API_BASE } from './config';

/* ---------------- ids ---------------- */

export const isGroupId = (id) => typeof id === 'string' && id.startsWith('grp_');

const last10 = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

/** Same person? Tolerates "+91 98765 43210" vs "9876543210" like the phone app. Never for groups. */
export function sameUser(a, b) {
  if (!a || !b) return false;
  const x = String(a);
  const y = String(b);
  if (x === y) return true;
  if (isGroupId(x) || isGroupId(y)) return false;
  const dx = last10(x);
  return !!dx && dx === last10(y);
}

/* ---------------- urls ---------------- */

/**
 * A URL that's safe to put in <img src> / <audio src>. Server paths ("/uploads/...") point at
 * the API. Anything else (javascript:, file:, other schemes) is dropped.
 */
export function mediaUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.startsWith('/uploads/')) return `${API_BASE}${v}`;
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(v)) return v;
  if (v.startsWith('blob:')) return v;
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
  } catch {
    /* not a URL */
  }
  return null;
}

/** Splits text into plain parts and http(s) links (rendered as <a rel="noopener noreferrer">). */
export function linkParts(text) {
  const parts = [];
  const re = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;
  let last = 0;
  let m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index) });
    let href = null;
    try {
      const u = new URL(m[0]);
      if (u.protocol === 'https:' || u.protocol === 'http:') href = u.href;
    } catch {
      href = null;
    }
    parts.push(href ? { text: m[0], href } : { text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts;
}

/* ---------------- names / colours ---------------- */

export const initialsOf = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts
    .slice(0, 2)
    .map((p) => Array.from(p)[0])
    .join('')
    .toUpperCase();
};

export const firstName = (name) => String(name || 'Someone').trim().split(/\s+/)[0];

const NAME_COLORS = ['#E5484D', '#0EA5E9', '#10B981', '#F97316', '#8B5CF6', '#EC4899', '#14B8A6', '#CA8A04'];
export const GROUP_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#EF4444', '#6366F1'];

/** Same colour per member everywhere (matches the phone app). */
export const memberColor = (id) => {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
};

export const safeColor = (c, fallback = '#3B82F6') =>
  typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : fallback;

/* ---------------- time ---------------- */

/** Server times are UTC; some older rows come without an offset. */
export function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (!value) return new Date(NaN);
  const s = String(value);
  const hasZone = /([zZ]|[+-]\d\d:?\d\d)$/.test(s);
  return new Date(hasZone || !/T|\s\d/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}

export const toMs = (value) => {
  const t = toDate(value).getTime();
  return Number.isNaN(t) ? Date.now() : t;
};

const sameDay = (a, b) => a.toDateString() === b.toDateString();

// Always 12-hour "4:05 PM" (same as the phone app), whatever the browser's locale prefers
export const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

/** Chat list time: "10:42", "Yesterday", "Tuesday", "12/03/2026". */
export function listTime(value) {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (sameDay(d, now)) return clock(d.getTime());
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  if (now - d < 6 * 86400000) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString();
}

/** Divider between days in a chat: "Today", "Yesterday", "Monday, 3 March". */
export function dayLabel(ms) {
  const d = new Date(ms);
  const now = new Date();
  if (sameDay(d, now)) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

export function lastSeenText(iso) {
  if (!iso) return '';
  const d = toDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const time = clock(d.getTime());
  if (sameDay(d, now)) return `last seen today at ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `last seen yesterday at ${time}`;
  return `last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`;
}

export const formatDuration = (sec) => {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

/* ---------------- group wording ---------------- */

/** "Bob is typing…", "Bob and Cara are typing…", "Bob and 2 others are typing…" */
export function typingLabel(typers) {
  if (!typers?.length) return '';
  if (typers.length === 1) return `${firstName(typers[0].name)} is typing…`;
  if (typers.length === 2) return `${firstName(typers[0].name)} and ${firstName(typers[1].name)} are typing…`;
  return `${firstName(typers[0].name)} and ${typers.length - 1} others are typing…`;
}

/** Group notices worded for the viewer: "You added Dan", "Alice added you". */
export function systemEventText(metadata, fallback, myId) {
  if (!metadata || metadata.type !== 'group_event') return fallback || '';
  const me = (id) => !!id && id === myId;
  const actor = me(metadata.actor_id) ? 'You' : metadata.actor_name || 'Someone';
  const targets = (metadata.targets || []).map((t) => (me(t.id) ? 'you' : t.name || 'someone')).join(', ');
  const asViewer = () => {
    const name = metadata.actor_name || '';
    return me(metadata.actor_id) && name && fallback?.startsWith(name) ? `You${fallback.slice(name.length)}` : fallback;
  };
  switch (metadata.event) {
    case 'created':
    case 'renamed':
      return asViewer() || '';
    case 'added':
      return `${actor} added ${targets}`;
    case 'removed':
      return `${actor} removed ${targets}`;
    case 'left':
      return `${actor} left`;
    case 'description':
      return `${actor} changed the group description`;
    default:
      return fallback || '';
  }
}

/** Short preview of a message for the chat list / reply bar. */
export function previewText(msg) {
  if (!msg) return '';
  const meta = msg.metadata;
  if (meta?.type === 'image') return meta.caption ? `📷 ${meta.caption}` : '📷 Photo';
  if (meta?.type === 'audio') return `🎙️ Voice message${meta.duration ? ` (${meta.duration})` : ''}`;
  return String(msg.text || '').replace(/\s+/g, ' ').trim();
}
