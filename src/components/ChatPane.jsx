import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { startCall } from '../lib/calls';
import { dayLabel, lastSeenText, sameUser, typingLabel } from '../lib/format';
import { confirmDialog, deleteMessage, loadHistory, loadOlder, reactToMessage, retryMessage, useStore } from '../lib/store';
import Composer from './Composer';
import Icon from './Icon';
import Message from './Message';
import { Avatar, IconButton, Menu, Spinner, TypingAvatars, TypingDots } from './ui';

const RUN_GAP_MS = 5 * 60 * 1000;
const EMPTY = [];

function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label="Photo">
      <IconButton icon="x" label="Close" className="lightbox-close" onClick={onClose} />
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} referrerPolicy="no-referrer" />
    </div>
  );
}

export default function ChatPane({ chat, infoOpen, onToggleInfo, onBack, onClose }) {
  const me = useStore((s) => s.me);
  const box = useStore((s) => s.messages[chat.id]);
  const typers = useStore((s) => s.typing[chat.id]) || EMPTY;
  const group = useStore((s) => s.groupInfo[chat.id]);
  const inCall = useStore((s) => !!s.call);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [newBelow, setNewBelow] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef(null);
  const scrollRef = useRef(null);
  const stick = useRef(true);
  const prevInfo = useRef({ firstId: null, lastId: null, height: 0, top: 0, chatId: null });

  const list = box?.list || EMPTY;
  const isGroup = chat.is_group;
  const left = isGroup && chat.is_member === false;

  // New chat: start at the bottom, drop reply / edit state
  useEffect(() => {
    stick.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset per-chat UI state
    setReplyTo(null);
    setEditing(null);
    setNewBelow(0);
  }, [chat.id]);

  // Keep the reading position: stay at the bottom for new messages, hold still when older ones load
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = prevInfo.current;
    const firstId = list[0]?.id;
    const lastId = list[list.length - 1]?.id;
    if (prev.chatId !== chat.id) {
      el.scrollTop = el.scrollHeight;
    } else if (prev.firstId && firstId !== prev.firstId && lastId === prev.lastId) {
      el.scrollTop = el.scrollHeight - prev.height + prev.top;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    } else if (lastId !== prev.lastId && list[list.length - 1] && !list[list.length - 1].mine) {
      setNewBelow((n) => n + 1);
    }
    if (list[list.length - 1]?.mine && lastId !== prev.lastId) el.scrollTop = el.scrollHeight;
    prevInfo.current = { firstId, lastId, height: el.scrollHeight, top: el.scrollTop, chatId: chat.id };
  }, [list, chat.id]);

  // Typing indicator appearing at the bottom shouldn't hide the last message
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [typers.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = bottom;
    setAtBottom(bottom);
    if (bottom) setNewBelow(0);
    prevInfo.current = { ...prevInfo.current, height: el.scrollHeight, top: el.scrollTop };
    if (el.scrollTop < 120 && box?.hasMore && !box.loadingOlder) loadOlder(chat.id);
  };

  const toBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewBelow(0);
  };

  const jumpTo = useCallback((id) => {
    const node = document.getElementById(`m-${id}`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(id);
    setTimeout(() => setHighlight(null), 1600);
  }, []);

  const askDelete = useCallback(
    (msg) => {
      const buttons = [];
      if (msg.mine && msg.status !== 'pending' && msg.status !== 'failed') {
        buttons.push({ label: 'Delete for everyone', danger: true, onClick: () => deleteMessage(chat.id, msg.id, true) });
      }
      buttons.push({ label: 'Delete for me', danger: !buttons.length, onClick: () => deleteMessage(chat.id, msg.id, false) });
      confirmDialog({ title: 'Delete message?', body: msg.mine ? null : 'It will be removed from your devices only.', buttons });
    },
    [chat.id],
  );

  const onRetry = useCallback((msg) => retryMessage(chat.id, msg.id), [chat.id]);
  const onReact = useCallback((msg, emoji) => reactToMessage(chat.id, msg.id, emoji), [chat.id]);
  // Who reacted: "You", the other person, or the group member's name
  const nameOf = useCallback(
    (userId) => {
      if (sameUser(userId, me?.id)) return 'You';
      if (!isGroup) return chat.name;
      return group?.members?.find((m) => sameUser(m.id, userId))?.name || 'Member';
    },
    [me?.id, isGroup, chat.name, group],
  );
  const onEdit = useCallback((msg) => {
    setReplyTo(null);
    setEditing(msg);
  }, []);
  const onReply = useCallback((msg) => {
    setEditing(null);
    setReplyTo(msg);
  }, []);

  // Day dividers + "first of a run" (sender name / avatar shown once per run in groups)
  const rows = useMemo(() => {
    const out = [];
    let lastDay = null;
    let prev = null;
    for (const m of list) {
      const day = new Date(m.ts).toDateString();
      if (day !== lastDay) {
        out.push({ divider: dayLabel(m.ts), key: `d-${day}` });
        lastDay = day;
        prev = null;
      }
      const first = !prev || prev.kind === 'system' || prev.senderId !== m.senderId || m.ts - prev.ts > RUN_GAP_MS;
      out.push({ msg: m, first, key: m.clientId || m.id });
      prev = m;
    }
    return out;
  }, [list]);

  let subtitle;
  if (isGroup) {
    if (typers.length) subtitle = typingLabel(typers);
    else if (group?.members?.length) {
      subtitle = group.members
        .map((m) => (sameUser(m.id, me?.id) ? 'You' : m.name))
        .slice(0, 8)
        .join(', ');
    } else subtitle = chat.member_count ? `${chat.member_count} members` : 'Tap for group info';
    if (left) subtitle = 'You’re no longer a member';
  } else if (chat.isAgent) subtitle = typers.length ? 'thinking…' : 'Personal AI assistant';
  else if (typers.length) subtitle = 'typing…';
  else if (chat.online) subtitle = 'online';
  else subtitle = lastSeenText(chat.last_seen);

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <IconButton icon="back" label="Back to chats" className="mobile-only" onClick={onBack} />
        <button type="button" className="chat-header-main" onClick={onToggleInfo} aria-label={`${chat.name} info`}>
          <Avatar id={chat.id} name={chat.name} color={chat.avatar_color} url={chat.avatar_url} size={40} group={isGroup} />
          <span className="chat-header-text">
            <span className="chat-header-name">{chat.name}</span>
            {subtitle && <span className={`chat-header-sub${typers.length ? ' typing' : ''}`}>{subtitle}</span>}
          </span>
        </button>
        <div className="chat-header-actions">
          {!isGroup && !chat.isAgent && (
            <>
              <IconButton icon="video" label="Video call" disabled={inCall} onClick={() => startCall(chat.id, true)} />
              <IconButton icon="phone" label="Voice call" disabled={inCall} onClick={() => startCall(chat.id, false)} />
            </>
          )}
          <IconButton icon={isGroup ? 'users' : 'info'} label={isGroup ? 'Group info' : 'Contact info'} active={infoOpen} onClick={onToggleInfo} />
          <div className="menu-wrap">
            <IconButton icon="more" label="Chat menu" ref={menuBtn} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} />
            {menuOpen && (
              <Menu
                anchor={menuBtn}
                onClose={() => setMenuOpen(false)}
                items={[
                  { label: isGroup ? 'Group info' : 'Contact info', icon: isGroup ? 'users' : 'info', onClick: onToggleInfo },
                  { label: 'Close chat', icon: 'x', onClick: onClose },
                ]}
              />
            )}
          </div>
        </div>
      </header>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        <div className="messages-inner">
          {box?.loadingOlder && (
            <div className="older-loading">
              <Spinner size={18} />
            </div>
          )}
          {!box?.hasMore && box?.loaded && (
            <div className="encryption-note">
              <Icon name="lock" size={12} />{' '}
              {chat.isAgent
                ? 'Your AI agent can read this chat to help you. Ask it to plan meetings or answer questions.'
                : 'Messages are sent securely to the people in this chat.'}
            </div>
          )}
          {box?.loading && !list.length && (
            <div className="older-loading">
              <Spinner />
            </div>
          )}
          {box?.error && !list.length && (
            <div className="load-error">
              <p>{box.error}</p>
              <button type="button" className="btn primary" onClick={() => loadHistory(chat.id)}>
                Try again
              </button>
            </div>
          )}
          {box?.loaded && !list.length && (
            <div className="empty-chat">{isGroup ? 'Say hi to the group 👋' : chat.isAgent ? 'Ask me anything ✨' : `Say hi to ${chat.name} 👋`}</div>
          )}
          {rows.map((r) =>
            r.divider ? (
              <div key={r.key} className="day-divider">
                <span>{r.divider}</span>
              </div>
            ) : (
              <Message
                key={r.key}
                msg={r.msg}
                isGroup={isGroup}
                myId={me?.id}
                firstOfRun={r.first}
                highlighted={highlight === r.msg.id}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={askDelete}
                onRetry={onRetry}
                onOpenImage={setLightbox}
                onJump={jumpTo}
                onReact={onReact}
                nameOf={nameOf}
                reactionsOn={!chat.isAgent}
              />
            ),
          )}
          {typers.length > 0 && (
            <div className="typing-row">
              {isGroup && <TypingAvatars typers={typers} />}
              <span className="typing-bubble">
                <TypingDots />
              </span>
              {isGroup && <span className="typing-label">{typingLabel(typers)}</span>}
            </div>
          )}
        </div>
      </div>

      {!atBottom && (
        <button type="button" className="to-bottom" onClick={toBottom} aria-label="Scroll to latest">
          {newBelow > 0 && <span className="unread-badge">{newBelow}</span>}
          <Icon name="arrowDown" size={20} />
        </button>
      )}

      <Composer
        chat={chat}
        replyTo={replyTo}
        editing={editing}
        onClearReply={() => setReplyTo(null)}
        onClearEdit={() => setEditing(null)}
        disabled={left ? 'You can’t send messages to this group because you’re no longer a member.' : null}
      />

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </section>
  );
}

export function EmptyPane() {
  return (
    <section className="chat-pane empty-pane">
      <div className="empty-pane-inner">
        <div className="empty-pane-art" aria-hidden>
          <Icon name="monitor" size={64} stroke={1.4} />
        </div>
        <h1>Flick Web</h1>
        <p>Send and receive messages from your computer. Your phone and this browser stay in sync.</p>
        <p className="muted">
          <Icon name="lock" size={13} /> Log out of this browser any time from your phone: ⋮ → Linked devices.
        </p>
      </div>
    </section>
  );
}

