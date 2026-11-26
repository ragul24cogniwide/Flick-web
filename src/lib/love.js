/**
 * Lovers' features, same as the phone app (Apptesting/src/screens/chat/chatHelpers.js).
 * Both are normal chat messages with a type in their metadata:
 *   thinking_of_you  "💭 Thinking of you": hearts float up on both screens
 *   chat_theme       a chat theme set "for both of us" on the phone ({ vibe_id, theme_key })
 */

export const THINKING_OF_YOU = 'thinking_of_you';
export const LOVE_SIGNAL = 'love_signal';
export const CHAT_THEME = 'chat_theme';
export const PHOTO_STYLE_POLAROID = 'polaroid';

// Same as the phone app (chatHelpers.js LOVE_SIGNALS). motion: up / down (falls) / hug (bursts out)
export const LOVE_SIGNALS = {
  thinking: { id: 'thinking', emoji: '💭❤️', title: 'Thinking of you', text: '💭 Thinking of you', menu: 'Thinking of you', back: 'Send one back 💕', from: (n) => `${n} is thinking of you`, particles: ['❤️', '💕', '💖', '💗', '💓', '🩷', '💞'], motion: 'up' },
  hug: { id: 'hug', emoji: '🤗', title: 'A big hug for you', text: '🤗 A big hug for you', menu: 'Send a hug', back: 'Hug back 🤗', from: (n) => `${n} sent you a hug`, particles: ['💛', '🧡', '💕', '🤗', '💖'], motion: 'hug' },
  kiss: { id: 'kiss', emoji: '😘', title: 'Sending you a kiss', text: '😘 Sending you a kiss', menu: 'Send a kiss', back: 'Kiss back 😘', from: (n) => `${n} sent you a kiss`, particles: ['💋', '😘', '💋', '❤️', '💕'], motion: 'up' },
  morning: { id: 'morning', emoji: '☀️', title: 'Good morning, love', text: '☀️ Good morning, love', menu: 'Good morning', back: 'Good morning ☀️', from: (n) => `Good morning from ${n}`, particles: ['🌼', '🌸', '✨', '💛', '☀️', '🌷'], motion: 'up' },
  night: { id: 'night', emoji: '🌙', title: 'Good night, sweet dreams', text: '🌙 Good night, sweet dreams', menu: 'Good night', back: 'Good night 🌙', from: (n) => `Good night from ${n}`, particles: ['⭐', '✨', '🌟', '💫', '⭐', '🌙'], motion: 'down' },
};
export const LOVE_SIGNAL_ORDER = ['thinking', 'hug', 'kiss', 'morning', 'night'];
export const THINKING_OF_YOU_TEXT = LOVE_SIGNALS.thinking.text;

export const loveSignalOf = (meta) => {
  if (!meta) return null;
  if (meta.type === THINKING_OF_YOU) return LOVE_SIGNALS.thinking;
  if (meta.type === LOVE_SIGNAL) return LOVE_SIGNALS[meta.signal] || null;
  return null;
};
export const loveSignalMetadata = (id) => (id === 'thinking' ? { type: THINKING_OF_YOU } : { type: LOVE_SIGNAL, signal: id });

// Reactions that make hearts float for the person whose message got them (💋 for kisses)
export const LOVE_REACTIONS = ['❤️', '😘', '🥰', '😍', '💕', '💖', '💗', '💞', '🩷', '❤️‍🔥', '💋', '😻'];
export const isLoveReaction = (emoji) => LOVE_REACTIONS.includes(emoji);
export const reactionParticles = (emoji) =>
  emoji === '😘' || emoji === '💋' ? ['💋', '😘', '💋', '❤️'] : ['❤️', '💕', '💖', '💗', emoji];

// The phone app's chat themes (vibes). Colours are in index.css (.chat-pane[data-vibe=…]).
export const VIBES = {
  default: { label: 'Classic' },
  love: { label: 'In love', couple: true },
  blush: { label: 'Blush', couple: true },
  midnight: { label: 'Midnight love', couple: true },
  coffee: { label: 'Coffee chat' },
  dev: { label: 'Dev sprint' },
  night: { label: 'Late night' },
  party: { label: 'Celebration' },
};

export function chatThemeNotice(msg) {
  const vibe = VIBES[msg?.metadata?.vibe_id];
  const name = vibe ? `${vibe.label}${vibe.couple ? ' 💕' : ''}` : 'a new theme';
  return msg?.mine ? `You changed the chat theme to ${name}` : `Chat theme changed to ${name}`;
}

/** The newest chat-theme message in a chat's list, or null. */
export function latestTheme(list) {
  let best = null;
  for (const m of list || []) {
    if (m?.metadata?.type !== CHAT_THEME || !VIBES[m.metadata.vibe_id]) continue;
    if (!best || (m.ts || 0) >= (best.ts || 0)) best = m;
  }
  return best;
}

const THEME_KEY = 'flick_chat_theme:';

/** The theme of a chat: from its newest theme message, else the last one seen (kept in the browser). */
export function chatTheme(chatId, list) {
  const latest = latestTheme(list);
  try {
    if (latest) {
      localStorage.setItem(THEME_KEY + chatId, latest.metadata.vibe_id);
      return latest.metadata.vibe_id;
    }
    const saved = localStorage.getItem(THEME_KEY + chatId);
    return saved && VIBES[saved] ? saved : 'default';
  } catch {
    return latest ? latest.metadata.vibe_id : 'default';
  }
}

/* ---------------- "Thinking of you" hearts ---------------- */

const listeners = new Set();
const BURST_GAP_MS = 2500; // several at once give one burst
let lastBurstAt = 0;

export function onLoveBurst(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * kind: 'sent' (mine), 'received' (their signal: card too), 'reaction' (their love reaction to my
 * message). signal: a LOVE_SIGNALS id; particles: emojis to float instead of the signal's own.
 */
export function loveBurst(kind = 'sent', { name = null, signal = 'thinking', particles = null } = {}) {
  const now = Date.now();
  if (now - lastBurstAt < BURST_GAP_MS) return false;
  lastBurstAt = now;
  listeners.forEach((fn) => {
    try {
      fn({ kind, name, signal, particles, at: now });
    } catch (err) {
      console.error('[love]', err);
    }
  });
  // A soft heartbeat on phones / tablets that can vibrate (desktop browsers ignore it)
  if (kind === 'received' || kind === 'reaction') {
    try {
      navigator.vibrate?.([35, 110, 55]);
    } catch {
      /* not allowed here */
    }
  }
  return true;
}
