/**
 * The live connection. It opens with a one-time ticket (never the token in the URL), pings every
 * 10 s, reconnects with backoff, and reconnects at once when the tab or the network comes back.
 * Close code 4401 = this browser was logged out: stop and sign out.
 *
 * Presence: an open tab doesn't make you look online. You're online while the tab is visible,
 * focused and being used; it reports you away 30 s after you switch tabs or minimise (a quick
 * look elsewhere doesn't flicker), or after 5 minutes without mouse or keyboard. The server shows
 * you online while any of your devices (this tab, another tab, the phone app) is in use.
 */
import { getWsTicket } from './api';
import { WS_BASE } from './config';
import { clearSession, getSession } from './session';

const PING_MS = 10000;
const DEAD_AFTER_MS = 30000;
const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 20000;
const TYPING_THROTTLE_MS = 2000;
const UNAUTHORIZED = 4401;
const AWAY_GRACE_MS = 30000;
const IDLE_MS = 5 * 60000;

class Socket {
  constructor() {
    this.ws = null;
    this.userId = null;
    this.listeners = new Set();
    this.queue = [];
    this.delay = RECONNECT_MIN;
    this.lastFrameAt = 0;
    this.pingTimer = null;
    this.retryTimer = null;
    this.stopped = true;
    this.connecting = false;
    this.typingSentAt = {};
    this.connected = false;
    this.lastInputAt = Date.now();
    this.presenceSent = null; // what this connection last told the server: true (in use) / false (away)
    this.awayTimer = null;

    if (typeof window !== 'undefined') {
      const wake = () => {
        if (this.stopped) return;
        if (!this.isOpen()) this.reconnectNow();
        else this.reportPresence();
      };
      window.addEventListener('online', wake);
      window.addEventListener('focus', () => {
        this.lastInputAt = Date.now();
        wake();
      });
      window.addEventListener('blur', () => this.reportPresence());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.lastInputAt = Date.now();
        wake();
      });
      const onInput = () => {
        this.lastInputAt = Date.now();
        if (this.presenceSent !== true || this.awayTimer) this.reportPresence();
      };
      ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
        window.addEventListener(ev, onInput, { passive: true })
      );
    }
  }

  /** Visible, focused, and touched in the last few minutes. */
  inUse() {
    return (
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      Date.now() - this.lastInputAt < IDLE_MS
    );
  }

  /** Tells the server when this tab starts or stops being used (away after a short grace period). */
  reportPresence() {
    if (!this.isOpen()) return;
    if (this.inUse()) {
      clearTimeout(this.awayTimer);
      this.awayTimer = null;
      if (this.presenceSent !== true) this.sendPresence(true);
    } else if (this.presenceSent !== false && !this.awayTimer) {
      this.awayTimer = setTimeout(() => {
        this.awayTimer = null;
        if (!this.inUse()) this.sendPresence(false);
      }, AWAY_GRACE_MS);
    }
  }

  sendPresence(inUse) {
    if (this.send({ type: inUse ? 'presence_online' : 'presence_offline', data: {} })) this.presenceSent = inUse;
  }

  start(userId) {
    this.userId = userId;
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.awayTimer);
    this.awayTimer = null;
    this.drop();
    this.setConnected(false);
  }

  isOpen() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  setConnected(value) {
    if (this.connected === value) return;
    this.connected = value;
    this.emit({ type: 'connection_status', data: { connected: value } });
  }

  drop() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
  }

  reconnectNow() {
    clearTimeout(this.retryTimer);
    this.delay = RECONNECT_MIN;
    this.open();
  }

  scheduleRetry() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    const wait = this.delay + Math.random() * 400;
    this.delay = Math.min(RECONNECT_MAX, this.delay * 2);
    this.retryTimer = setTimeout(() => this.open(), wait);
  }

  async open() {
    if (this.stopped || this.connecting || this.isOpen() || !getSession()?.token) return;
    this.connecting = true;
    const ticket = await getWsTicket();
    this.connecting = false;
    if (this.stopped) return;
    if (!ticket.ok) {
      if (ticket.status !== 401) this.scheduleRetry(); // 401: api.js already signed out
      return;
    }
    this.drop();
    let ws;
    try {
      ws = new WebSocket(`${WS_BASE}/ws/${encodeURIComponent(this.userId)}?ticket=${encodeURIComponent(ticket.data.ticket)}`);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.delay = RECONNECT_MIN;
      this.lastFrameAt = Date.now();
      // Say straight away whether this tab is in use (a background tab reconnecting stays away)
      clearTimeout(this.awayTimer);
      this.awayTimer = null;
      this.sendPresence(this.inUse());
      const pending = this.queue.splice(0);
      pending.forEach((f) => this.send(f));
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.heartbeat(), PING_MS);
      this.setConnected(true);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastFrameAt = Date.now();
      let frame;
      try {
        frame = JSON.parse(e.data);
      } catch {
        return;
      }
      if (!frame || typeof frame.type !== 'string') return;
      // Double grey tick for the sender as soon as it reaches this browser
      if (frame.type === 'chat_message' && frame.data?.message_id && frame.data.sender_id !== this.userId) {
        this.send({ type: 'ack_delivered', data: { message_id: frame.data.message_id, sender_id: frame.data.sender_id } });
      }
      // Same for group messages (also while this tab isn't being looked at)
      if (frame.type === 'group_message' && frame.data?.group_id && frame.data.sender_id !== this.userId) {
        this.send({ type: 'ack_group_delivered', data: { group_id: frame.data.group_id, message_id: frame.data.message_id } });
      }
      // This browser now has the message (received, from a group, or sent from my phone): the
      // server records it per device (backend devices.py). No ticks change because of this.
      if (['chat_message', 'group_message', 'message_sent_sync'].includes(frame.type) && frame.data) {
        const id = String(frame.data.message_id || frame.data.id || '');
        if (id && !id.startsWith('temp')) this.send({ type: 'device_ack', data: { message_ids: [id] } });
      }
      this.emit(frame);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
      this.presenceSent = null;
      this.setConnected(false);
      if (e.code === UNAUTHORIZED) {
        this.stop();
        clearSession();
        return;
      }
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  heartbeat() {
    if (!this.isOpen()) return;
    if (Date.now() - this.lastFrameAt > DEAD_AFTER_MS) {
      // Looks open but nothing comes back (sleeping laptop, switched network): dial again
      this.drop();
      this.setConnected(false);
      this.reconnectNow();
      return;
    }
    this.send({ type: 'ping' });
    this.reportPresence(); // notices going idle (no input for a while) with the tab still in front
  }

  /** Sends now, or keeps receipts / call signals for when the connection is back. */
  send(frame) {
    if (this.isOpen()) {
      try {
        this.ws.send(JSON.stringify(frame));
        return true;
      } catch {
        /* falls through to queue */
      }
    }
    if (['mark_read', 'ack_delivered', 'ack_group_delivered', 'device_ack', 'call_ice_candidate', 'call_media_state'].includes(frame?.type)) {
      if (this.queue.length >= 100) this.queue.shift();
      this.queue.push(frame);
    }
    if (!this.stopped && !this.isOpen()) this.open();
    return false;
  }

  sendMessage({ receiverId, content, tempId, replyTo, metadata }) {
    return this.send({
      type: 'chat_message',
      data: { receiver_id: receiverId, content, temp_msg_id: tempId, reply_to: replyTo || null, metadata: metadata || null },
    });
  }

  typing(receiverId, on) {
    if (on) {
      const now = Date.now();
      if (now - (this.typingSentAt[receiverId] || 0) < TYPING_THROTTLE_MS) return;
      this.typingSentAt[receiverId] = now;
      this.send({ type: 'typing_start', data: { receiver_id: receiverId } });
    } else if (this.typingSentAt[receiverId]) {
      delete this.typingSentAt[receiverId];
      this.send({ type: 'typing_stop', data: { receiver_id: receiverId } });
    }
  }

  markRead(peerId) {
    this.send({ type: 'mark_read', data: { sender_id: peerId } });
  }

  queryPresence(userId) {
    this.send({ type: 'query_presence', data: { user_id: userId } });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(frame) {
    this.listeners.forEach((fn) => {
      try {
        fn(frame);
      } catch (err) {
        console.error('[socket listener]', err);
      }
    });
  }
}

export const socket = new Socket();
