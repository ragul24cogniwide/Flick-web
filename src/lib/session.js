/**
 * The browser's sign-in. Kept in localStorage when "Keep me signed in" is ticked, otherwise in
 * sessionStorage (gone when the browser closes). Only the token and the profile are stored; no
 * messages are written to disk.
 */
const KEY = 'flick.web.session';

let current = null;
const listeners = new Set();

const stores = () => {
  const out = [];
  try {
    out.push(window.localStorage);
  } catch {
    /* storage blocked */
  }
  try {
    out.push(window.sessionStorage);
  } catch {
    /* storage blocked */
  }
  return out;
};

export function loadSession() {
  for (const store of stores()) {
    try {
      const raw = store.getItem(KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.token && parsed?.user?.id) {
        current = { ...parsed, persist: store === window.localStorage };
        return current;
      }
    } catch {
      /* unreadable entry: ignore */
    }
  }
  return null;
}

export function getSession() {
  return current;
}

export function saveSession({ token, user, persist }) {
  current = { token, user, persist: !!persist };
  for (const store of stores()) {
    try {
      store.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  try {
    const store = persist ? window.localStorage : window.sessionStorage;
    store.setItem(KEY, JSON.stringify({ token, user }));
  } catch {
    /* private mode: stays in memory for this tab */
  }
  listeners.forEach((fn) => fn(current));
}

export function updateSessionUser(user) {
  if (!current) return;
  saveSession({ ...current, user: { ...current.user, ...user } });
}

export function clearSession() {
  current = null;
  for (const store of stores()) {
    try {
      store.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((fn) => fn(null));
}

export function onSessionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Signing out in one tab signs out the others
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY && !e.newValue && current) {
      current = null;
      listeners.forEach((fn) => fn(null));
    }
  });
}
