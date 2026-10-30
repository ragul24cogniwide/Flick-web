import { memo, useEffect, useRef, useState } from 'react';
import { EMOJI, QUICK_REACTIONS } from '../lib/emoji';
import { clock, formatDuration, linkParts, mediaUrl, memberColor, sameUser, systemEventText } from '../lib/format';
import Icon from './Icon';
import { Avatar, Menu } from './ui';

/* ---------------- text: links + light formatting ---------------- */

// *bold*  _italic_  ~strike~  `code`  (WhatsApp style; also **bold** from the AI agent).
// Markers only count at word edges, so snake_case names and a*b*c stay as typed.
const FORMAT = /(?<![\p{L}\p{N}_*~`])(\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*?\*|_[^_\s][^_\n]*?_|~[^~\s][^~\n]*?~|`[^`\n]+`)(?![\p{L}\p{N}_*~`])/gu;

function formatted(text, keyBase) {
  const out = [];
  let last = 0;
  let m;
  let i = 0;
  FORMAT.lastIndex = 0;
  while ((m = FORMAT.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = `${keyBase}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t[0] === '*') out.push(<strong key={key}>{t.slice(1, -1)}</strong>);
    else if (t[0] === '_') out.push(<em key={key}>{t.slice(1, -1)}</em>);
    else if (t[0] === '~') out.push(<s key={key}>{t.slice(1, -1)}</s>);
    else out.push(<code key={key}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }) {
  return linkParts(text).map((p, i) =>
    p.href ? (
      <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow">
        {p.text}
      </a>
    ) : (
      <span key={i}>{formatted(p.text, i)}</span>
    ),
  );
}

/* ---------------- ticks ---------------- */

export function Ticks({ status }) {
  if (status === 'pending') return <Icon name="clock" size={13} className="tick pending" title="Sending" />;
  if (status === 'failed') return <Icon name="alert" size={14} className="tick failed" title="Not sent" />;
  if (status === 'read') return <Icon name="checks" size={16} className="tick read" title="Read" />;
  if (status === 'delivered') return <Icon name="checks" size={16} className="tick" title="Delivered" />;
  return <Icon name="check" size={14} className="tick" title="Sent" />;
}

/* ---------------- voice note ---------------- */

function VoiceNote({ meta, mine }) {
  const src = mediaUrl(meta.media_url || meta.uri);
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(!src);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const a = ref.current;
    if (!a) return undefined;
    const onTime = () => {
      setElapsed(a.currentTime);
      setProgress(a.duration ? a.currentTime / a.duration : 0);
    };
    const onEnd = () => {
      setPlaying(false);
      setProgress(0);
      setElapsed(0);
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    a.addEventListener('pause', () => setPlaying(false));
    a.addEventListener('play', () => setPlaying(true));
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
    };
  }, []);

  const toggle = () => {
    const a = ref.current;
    if (!a || failed) return;
    if (a.paused) {
      document.querySelectorAll('audio').forEach((o) => o !== a && o.pause());
      a.play().catch(() => setFailed(true));
    } else a.pause();
  };

  const seek = (e) => {
    const a = ref.current;
    if (!a?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
  };

  return (
    <div className={`voice${mine ? ' mine' : ''}`}>
      <button type="button" className="voice-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play voice message'} disabled={failed}>
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <div className="voice-track" onClick={seek} role="presentation">
        <div className="voice-fill" style={{ width: `${progress * 100}%` }} />
        <div className="voice-knob" style={{ left: `${progress * 100}%` }} />
      </div>
      <span className="voice-time">{failed ? 'Unavailable' : playing || elapsed ? formatDuration(elapsed) : meta.duration || '0:00'}</span>
      {src && <audio ref={ref} src={src} preload="none" onError={() => setFailed(true)} />}
    </div>
  );
}

/* ---------------- reactions ---------------- */

const ALL_EMOJI = Object.values(EMOJI).join(' ').split(' ');

/** Quick reactions, with "+" for any emoji. Picking your current reaction removes it. */
function ReactionPicker({ mine, onPick, onClose, align }) {
  const [more, setMore] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  const pick = (e) => {
    onPick(e);
    onClose();
  };
  return (
    <div className={`reaction-picker ${align}`} ref={ref} role="menu" aria-label="React">
      <div className="reaction-quick">
        {QUICK_REACTIONS.map((e) => (
          <button key={e} type="button" className={mine === e ? 'on' : ''} onClick={() => pick(e)} aria-label={`React ${e}`}>
            {e}
          </button>
        ))}
        <button type="button" className="reaction-more" onClick={() => setMore((v) => !v)} aria-label="More reactions" aria-expanded={more}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      {more && (
        <div className="reaction-grid">
          {ALL_EMOJI.map((e) => (
            <button key={e} type="button" className={mine === e ? 'on' : ''} onClick={() => pick(e)} aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Chips under the bubble: each emoji once with a count; mine highlighted (click to remove). */
function ReactionChips({ reactions, myId, nameOf, onReact }) {
  const groups = [];
  for (const r of reactions) {
    let g = groups.find((x) => x.emoji === r.emoji);
    if (!g) groups.push((g = { emoji: r.emoji, people: [], mine: false }));
    g.people.push(nameOf(r.user_id));
    if (sameUser(r.user_id, myId)) g.mine = true;
  }
  return (
    <div className="reactions">
      {groups.map((g) => (
        <button
          key={g.emoji}
          type="button"
          className={`reaction-chip${g.mine ? ' mine' : ''}`}
          title={`${g.people.join(', ')}${g.mine ? ' · click to remove yours' : ''}`}
          aria-label={`${g.emoji} ${g.people.join(', ')}`}
          onClick={() => onReact(g.emoji)}
        >
          <span>{g.emoji}</span>
          {g.people.length > 1 && <span className="reaction-count">{g.people.length}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------------- one message ---------------- */

function Message({ msg, isGroup, myId, firstOfRun, onReply, onEdit, onDelete, onRetry, onOpenImage, onJump, onReact, nameOf, reactionsOn = true, highlighted }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reacting, setReacting] = useState(false);
  const btnRef = useRef(null);

  if (msg.kind === 'system') {
    return (
      <div className="system-chip" id={`m-${msg.id}`}>
        {systemEventText(msg.metadata, msg.text, myId)}
      </div>
    );
  }

  const meta = msg.metadata;
  const image = meta?.type === 'image' ? mediaUrl(meta.media_url || meta.uri) : null;
  const isVoice = meta?.type === 'audio';
  const caption = image ? meta.caption || (msg.text && !/^📷 Photo$/.test(msg.text) ? msg.text : '') : '';
  const showText = !image && !isVoice;
  const showSender = isGroup && !msg.mine && firstOfRun;
  const nameColor = memberColor(msg.senderId);
  const canEdit = msg.mine && showText && msg.status !== 'pending' && msg.status !== 'failed';

  const copy = () => navigator.clipboard?.writeText(caption || msg.text).catch(() => {});
  const canReact = reactionsOn && msg.status !== 'pending' && msg.status !== 'failed';
  const reactions = msg.reactions || [];
  const myReaction = reactions.find((r) => sameUser(r.user_id, myId))?.emoji;
  const react = (emoji) => onReact(msg, emoji);

  return (
    <div
      className={`msg-row${msg.mine ? ' mine' : ''}${firstOfRun ? ' first' : ''}${highlighted ? ' flash' : ''}${reactions.length ? ' has-reactions' : ''}`}
      id={`m-${msg.id}`}
    >
      {isGroup && !msg.mine && (
        <span className="msg-avatar">{firstOfRun && <Avatar id={msg.senderId} name={msg.senderName} url={msg.senderAvatar} color={nameColor} size={28} />}</span>
      )}
      {canReact && (
        <span className={`react-slot${reacting ? ' open' : ''}`}>
          <button type="button" className="react-btn" aria-label="React" title="React" onClick={() => setReacting((v) => !v)}>
            <Icon name="smile" size={18} />
          </button>
          {reacting && <ReactionPicker mine={myReaction} onPick={react} onClose={() => setReacting(false)} align={msg.mine ? 'right' : 'left'} />}
        </span>
      )}
      <div className={`bubble${image ? ' has-image' : ''}`}>
        {showSender && (
          <div className="bubble-sender" style={{ color: nameColor }}>
            {msg.senderName || 'Member'}
          </div>
        )}
        {msg.replyTo && (
          <button type="button" className="bubble-reply" onClick={() => msg.replyTo.id && onJump(msg.replyTo.id)}>
            <span className="bubble-reply-name">{msg.replyTo.sender || 'Reply'}</span>
            <span className="bubble-reply-text">{String(msg.replyTo.text || '').slice(0, 200)}</span>
          </button>
        )}
        {image && (
          <button type="button" className="bubble-image" onClick={() => onOpenImage(image)} aria-label="Open photo">
            <img src={image} alt={caption || 'Photo'} loading="lazy" referrerPolicy="no-referrer" />
          </button>
        )}
        {isVoice && <VoiceNote meta={meta} mine={msg.mine} />}
        {(showText || caption) && (
          <div className="bubble-text">
            <RichText text={showText ? msg.text : caption} />
          </div>
        )}
        <span className="bubble-meta">
          {msg.edited && <span className="edited">Edited</span>}
          <span>{clock(msg.ts)}</span>
          {msg.mine && <Ticks status={msg.status} />}
        </span>
        <button
          type="button"
          ref={btnRef}
          className="bubble-menu-btn"
          aria-label="Message options"
          aria-haspopup="menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon name="chevronDown" size={18} />
        </button>
        {menuOpen && (
          <Menu
            anchor={btnRef}
            align={msg.mine ? 'right' : 'left'}
            onClose={() => setMenuOpen(false)}
            items={[
              msg.status === 'failed' && { label: 'Try again', icon: 'refresh', onClick: () => onRetry(msg) },
              msg.status !== 'pending' && msg.status !== 'failed' && { label: 'Reply', icon: 'reply', onClick: () => onReply(msg) },
              canReact && { label: 'React', icon: 'smile', onClick: () => setReacting(true) },
              (showText || caption) && { label: 'Copy', icon: 'copy', onClick: copy },
              image && { label: 'Open photo', icon: 'image', onClick: () => onOpenImage(image) },
              canEdit && { label: 'Edit', icon: 'edit', onClick: () => onEdit(msg) },
              { label: 'Delete', icon: 'trash', danger: true, onClick: () => onDelete(msg) },
            ]}
          />
        )}
        {reactions.length > 0 && <ReactionChips reactions={reactions} myId={myId} nameOf={nameOf} onReact={react} />}
      </div>
      {msg.status === 'failed' && (
        <button type="button" className="retry-link" onClick={() => onRetry(msg)}>
          {msg.error ? `${msg.error} · ` : 'Not sent · '}Tap to retry
        </button>
      )}
    </div>
  );
}

export default memo(Message);
