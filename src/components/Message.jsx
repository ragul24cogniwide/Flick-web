import { memo, useEffect, useRef, useState } from 'react';
import { EMOJI, QUICK_REACTIONS } from '../lib/emoji';
import { clock, fileTypeLabel, formatBytes, formatDuration, linkParts, mediaUrl, memberColor, sameUser, systemEventText } from '../lib/format';
import { CHAT_THEME, PHOTO_STYLE_POLAROID, chatThemeNotice, loveSignalOf, loveSignalTitle } from '../lib/love';
import { OPEN_WHEN } from '../lib/loveContent';
import { useUi } from '../lib/notify';
import Icon from './Icon';
import { Avatar, Menu, Modal } from './ui';

/* ---------------- text: links + light formatting ---------------- */

// *bold*  _italic_  ~strike~  `code`  (WhatsApp style; also **bold**).
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

const HEART = 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z';
// A filled heart of `size` centred on cx, cy; `ring` (a CSS colour) cuts it out from the lines behind
function Heart({ cx, cy, size, className, ring, ringWidth = 1.6 }) {
  const k = size / 24;
  return (
    <g transform={`translate(${cx - 12 * k} ${cy - 12.1 * k}) scale(${k})`}>
      {ring && <path d={HEART} style={{ fill: ring, stroke: ring, strokeWidth: (ringWidth * 2) / k }} />}
      <path d={HEART} className={className} stroke="none" />
    </g>
  );
}

/**
 * Love letters instead of ticks (same as the phone app): a closed grey letter when sent, sealed
 * with a rose heart when delivered (it's in their postbox), a rose love letter 💌 when seen.
 */
function LetterTick({ status }) {
  const title = status === 'read' ? 'Seen' : status === 'delivered' ? 'Delivered' : 'Sent';
  const common = { width: 19, height: 16, viewBox: '0 0 24 20', role: 'img', 'aria-label': title };
  if (status === 'read') {
    return (
      <svg {...common} className="tick letter read">
        <title>{title}</title>
        <rect x="2" y="3.5" width="20" height="14.5" rx="2.6" fill="currentColor" />
        <path d="M3.2 5 12 11l8.8-6" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <Heart cx={12} cy={11.6} size={8.5} className="letter-heart-white" ring="currentColor" ringWidth={1.3} />
      </svg>
    );
  }
  return (
    <svg {...common} className={`tick letter${status === 'delivered' ? ' delivered' : ''}`}>
      <title>{title}</title>
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="13.5" rx="2.2" />
        <path d="M2.8 5.2 12 11.4l9.2-6.2" />
      </g>
      {status === 'delivered' && <Heart cx={12} cy={11.8} size={10.5} className="letter-seal" ring="var(--bubble-me)" />}
    </svg>
  );
}

export function Ticks({ status }) {
  const { letterTicks } = useUi();
  if (status === 'pending') return <Icon name="clock" size={13} className="tick pending" title="Sending" />;
  if (status === 'failed') return <Icon name="alert" size={14} className="tick failed" title="Not sent" />;
  if (letterTicks !== false) return <LetterTick status={status} />;
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

/** An "open when" letter: a sealed envelope; clicking opens it. */
function LetterCard({ letter, mine, fallback }) {
  const [open, setOpen] = useState(false);
  const title = letter.title || 'you need it';
  return (
    <>
      <button type="button" className="letter-msg" onClick={() => setOpen(true)} aria-label={`${mine ? 'Your letter' : 'A letter for you'}: open when ${title}`}>
        <svg width="58" height="42" viewBox="0 0 58 42" aria-hidden="true">
          <rect x="1" y="1" width="56" height="40" rx="7" fill="var(--surface)" stroke="var(--brand)" strokeWidth="1.6" />
          <path d="M2 3 L29 23 L56 3" fill="var(--brand-soft)" stroke="var(--brand)" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M29 30s-5.6-3.5-7.2-7c-1.1-2.5.5-5.3 3.2-5.3 1.6 0 2.9.9 4 2.3 1.1-1.4 2.4-2.3 4-2.3 2.7 0 4.3 2.8 3.2 5.3C34.6 26.5 29 30 29 30z" fill="var(--brand)" />
        </svg>
        <span className="letter-msg-kicker">{mine ? 'Your letter' : 'A letter for you'}</span>
        <span className="letter-msg-title">Open when {title}</span>
        <span className="letter-msg-btn">{mine ? 'Read it again' : 'Open 💌'}</span>
      </button>
      {open && (
        <Modal title={`Open when ${title}`} onClose={() => setOpen(false)} className="letter-modal">
          <p className="letter-body">{letter.letter || fallback}</p>
        </Modal>
      )}
    </>
  );
}

function Message({ msg, isGroup, myId, firstOfRun, onReply, onEdit, onDelete, onRetry, onOpenImage, onJump, onReact, onSendLove, nameOf, reactionsOn = true, highlighted, animate }) {
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
  // A chat theme set on the phone: a centred notice, like group events
  if (meta?.type === CHAT_THEME) {
    return (
      <div className="system-chip" id={`m-${msg.id}`}>
        {chatThemeNotice(msg)}
      </div>
    );
  }
  const love = loveSignalOf(meta);
  const letter = meta?.type === OPEN_WHEN ? meta : null;
  const isLove = !!love || !!letter;
  const loveTitle = love ? loveSignalTitle(love, meta) : '';
  const image = meta?.type === 'image' ? mediaUrl(meta.media_url || meta.uri) : null;
  const isVoice = meta?.type === 'audio';
  // A shared file (from the phone app): opens / downloads from the server
  const doc = meta?.type === 'document' ? mediaUrl(meta.media_url || meta.uri) : null;
  const docName = meta?.file_name || String(msg.text || '').replace(/^📄\s*/, '') || 'Document';
  const caption = image ? meta.caption || (msg.text && !/^📷 Photo$/.test(msg.text) ? msg.text : '') : '';
  const showText = !image && !isVoice && !doc && !isLove;
  const polaroid = !!image && meta?.style === PHOTO_STYLE_POLAROID;
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
      className={`msg-row${msg.mine ? ' mine' : ''}${firstOfRun ? ' first' : ''}${highlighted ? ' flash' : ''}${reactions.length ? ' has-reactions' : ''}${animate ? ' enter' : ''}`}
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
      <div className={`bubble${image ? ' has-image' : ''}${isLove ? ' love' : ''}${polaroid ? ' polaroid-bubble' : ''}`}>
        {showSender && (
          <div className="bubble-sender" style={{ color: nameColor }}>
            {msg.senderName || 'Member'}
          </div>
        )}
        {meta?.forwarded && (
          <div className="bubble-forwarded">
            <Icon name="forward" size={13} /> Forwarded
          </div>
        )}
        {msg.replyTo && (
          <button type="button" className="bubble-reply" onClick={() => onJump(msg.replyTo)}>
            <span className="bubble-reply-name">{msg.replyTo.sender || 'Reply'}</span>
            <span className="bubble-reply-text">{String(msg.replyTo.text || '').slice(0, 200)}</span>
          </button>
        )}
        {polaroid && (
          <figure className="polaroid" style={{ '--tilt': `${String(msg.clientId || msg.id).length % 2 ? 2.5 : -2.5}deg` }}>
            <button type="button" className="polaroid-photo" onClick={() => onOpenImage(image)} aria-label="Open polaroid photo">
              <img src={image} alt={caption || 'Photo'} loading="lazy" referrerPolicy="no-referrer" />
            </button>
            <figcaption>{caption || '\u00a0'}</figcaption>
            <span className="polaroid-sticker" aria-hidden="true">💖</span>
          </figure>
        )}
        {image && !polaroid && (
          <button type="button" className="bubble-image" onClick={() => onOpenImage(image)} aria-label="Open photo">
            <img src={image} alt={caption || 'Photo'} loading="lazy" referrerPolicy="no-referrer" />
          </button>
        )}
        {letter && <LetterCard letter={letter} mine={msg.mine} fallback={msg.text} />}
        {love && (
          <div className="love-msg" aria-label={msg.mine ? `You sent: ${loveTitle}` : loveTitle}>
            <span className="love-msg-emoji">{love.emoji}</span>
            <span className="love-msg-title">{loveTitle}</span>
            {!msg.mine && onSendLove && (
              <button type="button" className="love-back" onClick={() => onSendLove(love.id)}>
                {love.back}
              </button>
            )}
          </div>
        )}
        {isVoice && <VoiceNote meta={meta} mine={msg.mine} />}
        {meta?.type === 'document' && (
          <a
            className="bubble-doc"
            href={doc || undefined}
            target="_blank"
            rel="noopener noreferrer"
            download={docName}
            aria-label={`Document ${docName}. Open`}
          >
            <span className="bubble-doc-icon" data-kind={fileTypeLabel(docName)}>
              <Icon name="file" size={20} />
            </span>
            <span className="bubble-doc-text">
              <span className="bubble-doc-name">{docName}</span>
              <span className="bubble-doc-meta">{[fileTypeLabel(docName), formatBytes(meta.size)].filter(Boolean).join(' · ')}</span>
            </span>
            <Icon name="download" size={18} />
          </a>
        )}
        {(showText || (caption && !polaroid)) && (
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
              doc && { label: 'Download', icon: 'download', onClick: () => window.open(doc, '_blank', 'noopener') },
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
