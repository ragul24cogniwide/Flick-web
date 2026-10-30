/**
 * The live connection. It opens with a one-time ticket (never the token in the URL), pings every
 * 10 s, reconnects with backoff, and reconnects at once when the tab or the network comes back.
 * Close code 4401 = this browser was logged out: stop and sign out.
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

    if (typeof window !== 'undefined') {
      const wake = () => {
        if (this.stopped) return;
        if (!this.isOpen()) this.reconnectNow();
        else this.send({ type: 'presence_online', data: {} });
      };
      window.addEventListener('online', wake);
      window.addEventListener('focus', wake);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
    }
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
      this.send({ type: 'presence_online', data: {} });
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
      this.emit(frame);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.pingTimer);
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
    if (['mark_read', 'ack_delivered', 'call_ice_candidate', 'call_media_state'].includes(frame?.type)) {
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
