/**
 * Desktop notifications, sounds and the unread count in the tab title, plus this browser's own
 * display settings (theme, sounds, Enter to send). Those settings stay in this browser only.
 */
import { useSyncExternalStore } from 'react';
import { previewText } from './format';

const UI_KEY = 'flick.web.ui';
const DEFAULT_UI = { theme: 'system', enterToSend: true, notifications: true, sounds: true, notificationPreview: true };

let ui = (() => {
  try {
    return { ...DEFAULT_UI, ...JSON.parse(window.localStorage.getItem(UI_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_UI };
  }
})();
const uiSubs = new Set();

export const getUi = () => ui;
export function setUi(patch) {
  ui = { ...ui, ...patch };
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    /* private mode: keep in memory */
  }
  uiSubs.forEach((fn) => fn());
}
export const useUi = () =>
  useSyncExternalStore(
    (fn) => {
      uiSubs.add(fn);
      return () => uiSubs.delete(fn);
    },
    () => ui,
  );

/* ---------------- title ---------------- */

export function updateTitle(unreadChats) {
  document.title = unreadChats > 0 ? `(${unreadChats}) Flick` : 'Flick';
}

/* ---------------- permission ---------------- */

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notificationPermission = () => (notificationsSupported() ? Notification.permission : 'denied');

export async function askNotificationPermission() {
  if (!notificationsSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/* ---------------- sounds (generated, no audio files) ---------------- */

let audioCtx = null;
const ctx = () => {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
};

function tone(freq, start, length, gain = 0.08, type = 'sine') {
  const c = ctx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + length);
  osc.connect(g).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + length + 0.05);
}

export function playMessageSound() {
  if (!ui.sounds) return;
  tone(880, 0, 0.12);
  tone(1320, 0.09, 0.16);
}

let ringTimer = null;
/** Incoming call ring (repeats) or the caller's ringback tone. */
export function startRing(incoming) {
  stopRing();
  const once = () => {
    if (incoming) {
      tone(660, 0, 0.35, 0.12, 'triangle');
      tone(880, 0.4, 0.35, 0.12, 'triangle');
    } else {
      tone(440, 0, 1.2, 0.05);
      tone(480, 0, 1.2, 0.05);
    }
  };
  once();
  ringTimer = setInterval(once, incoming ? 2000 : 4000);
}
export function stopRing() {
  clearInterval(ringTimer);
  ringTimer = null;
}

/* ---------------- notifications ---------------- */

const pageHidden = () => document.visibilityState !== 'visible' || !document.hasFocus();

export function showNotification(title, body, { tag, onClick, requireInteraction = false } = {}) {
  if (!ui.notifications || notificationPermission() !== 'granted') return null;
  try {
    const n = new Notification(title, { body, tag, icon: '/favicon.svg', silent: true, requireInteraction });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
    return n;
  } catch {
    return null;
  }
}

export function notifyMessage(chat, msg, prefs = {}) {
  if (prefs.msg_notifications === false) return;
  playMessageSound();
  if (!pageHidden() || !chat) return;
  const preview = ui.notificationPreview && prefs.preview !== false;
  const body = preview
    ? chat.is_group
      ? `${msg.senderName || 'Someone'}: ${previewText(msg)}`
      : previewText(msg)
    : 'New message';
  showNotification(chat.name, body.slice(0, 200), {
    tag: `chat-${chat.id}`,
    onClick: () => window.dispatchEvent(new CustomEvent('flick:open-chat', { detail: chat.id })),
  });
}

export function notifyReaction(chat, data, msg) {
  if (!pageHidden()) return;
  const about = msg ? `“${previewText(msg).slice(0, 60)}”` : 'your message';
  const who = chat.is_group ? data.name : chat.name;
  showNotification(chat.name, `${who} reacted ${data.emoji} to ${about}`, {
    tag: `react-${data.message_id}`,
    onClick: () => window.dispatchEvent(new CustomEvent('flick:open-chat', { detail: chat.id })),
  });
}

/* ---------------- theme ---------------- */

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}
