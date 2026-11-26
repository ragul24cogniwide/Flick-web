/**
 * Us: the home of Flick for lovers on the web, same as the phone app's Us tab.
 * Not paired: "Find your person" (my code to share, or their code to join).
 * Paired: days together, my person's presence / mood / local time, love signals, the anniversary
 * countdown, today's question and "open when" letters. Signals, answers and letters are normal
 * chat messages, so the phone app shows them too.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  createInvite,
  daysTogether,
  formatDay,
  isoDay,
  joinCouple,
  loveNameFor,
  nextAnniversary,
  partnerChatId,
  partnerChatIn,
  partnerFirstName,
  partnerTime,
  sendToPartner,
  unpairCouple,
  updateCouple,
  useCouple,
} from '../lib/couple';
import { LOVE_SIGNALS, LOVE_SIGNAL_ORDER, loveBurst } from '../lib/love';
import { DAILY_ANSWER, MOODS, OPEN_WHEN, OPEN_WHEN_TITLES, answerOf, dailyAnswerText, moodText, openWhenText, questionOfDay } from '../lib/loveContent';
import { socket } from '../lib/socket';
import { confirmDialog, loadHistory, openChat, sendLoveSignal, toast, useStore } from '../lib/store';
import { Avatar, Modal, Spinner } from '../components/ui';

const SIGNAL_EMOJI = { thinking: '💭', hug: '🤗', kiss: '😘', morning: '☀️', night: '🌙' };
const SIGNAL_LABEL = { thinking: 'Thinking', hug: 'Hug', kiss: 'Kiss', morning: 'Morning', night: 'Night' };
const SEALS = ['#E11D48', '#7C3AED', '#B45309', '#0F766E', '#BE185D'];
const OPENED_KEY = 'flick.letters.opened';
let tzShared = false;
const readOpened = () => {
  try {
    return JSON.parse(localStorage.getItem(OPENED_KEY) || '{}');
  } catch {
    return {};
  }
};

export default function UsPanel() {
  const couple = useCouple();
  return (
    <div className="side-panel us-panel">
      <header className="us-top">
        <span className="us-wordmark">Flick</span>
      </header>
      <div className="us-scroll">
        {!couple ? (
          <div className="us-loading">
            <Spinner />
          </div>
        ) : couple.status === 'paired' ? (
          <PairedHome couple={couple} />
        ) : (
          <Pairing couple={couple} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------- pairing ------------------------------- */

function Pairing({ couple }) {
  const [code, setCode] = useState('');
  const [anniversary, setAnniversary] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inviteError, setInviteError] = useState('');

  useEffect(() => {
    if (couple.status !== 'none') return;
    createInvite().then((res) => !res.ok && setInviteError(res.error));
  }, [couple.status]);

  const share = async () => {
    const text = `Let's pair on Flick 💕 Open Flick, go to Us and enter my code: ${couple.code}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Copied. Send it to your person.');
      }
    } catch {
      /* closed the share sheet */
    }
  };

  const join = async (e) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError('');
    const res = await joinCouple(code, { anniversary: anniversary || null, nickname: nickname.trim() || null });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else loveBurst('sent', { signal: 'thinking' });
  };

  return (
    <div className="pairing">
      <svg width="140" height="78" viewBox="0 0 140 78" role="img" aria-label="Two circles joined by a heart" className="pair-art">
        <circle cx="48" cy="39" r="34" fill="var(--brand-soft)" />
        <circle cx="92" cy="39" r="34" fill="var(--active)" opacity="0.9" />
        <path d="M70 58s-13-8-16.5-15.5C51 37 54.6 31 60.4 31c4 0 6.8 2.1 9.6 5.4 2.8-3.3 5.6-5.4 9.6-5.4 5.8 0 9.4 6 6.9 11.5C83 50 70 58 70 58z" fill="var(--brand)" />
      </svg>
      <h1 className="pair-title">Find your person</h1>
      <p className="pair-sub">Pair with the one you love. Your space is only for the two of you.</p>

      <section className="us-card raised">
        <span className="us-eyebrow">Your invite code</span>
        {couple.code ? (
          <>
            <p className="pair-code">{couple.code}</p>
            <button type="button" className="btn primary wide" onClick={share}>
              Share my code
            </button>
          </>
        ) : inviteError ? (
          <>
            <p className="us-error">{inviteError}</p>
            <button type="button" className="btn ghost" onClick={() => createInvite().then((r) => setInviteError(r.ok ? '' : r.error))}>
              Try again
            </button>
          </>
        ) : (
          <Spinner size={20} />
        )}
        {couple.status === 'waiting' && <p className="us-hint">When they enter it, you're paired. This page updates by itself.</p>}
      </section>

      <div className="pair-or">
        <span />
        or join theirs
        <span />
      </div>

      <form className="us-form" onSubmit={join}>
        <label>
          Their code
          <input className="text-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. FLK-4T7P" maxLength={12} autoComplete="off" />
        </label>
        <label>
          Our anniversary <small>(optional)</small>
          <input className="text-input" type="date" value={anniversary} max={isoDay()} onChange={(e) => setAnniversary(e.target.value)} />
        </label>
        <label>
          What do you call them? <small>(optional)</small>
          <input className="text-input hand" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Babe, Kutty, Jaan…" maxLength={40} />
        </label>
        {error && <p className="us-error">{error}</p>}
        <button type="submit" className="btn primary wide big" disabled={!code.trim() || busy}>
          {busy ? <Spinner size={18} /> : '♥ Pair us'}
        </button>
        <p className="us-hint center">You can still chat with friends and groups after pairing.</p>
      </form>
    </div>
  );
}

/* ------------------------------ paired home ------------------------------ */

function PairedHome({ couple }) {
  const me = useStore((s) => s.me);
  const partner = couple.partner || {};
  const first = partnerFirstName(couple);
  const chatId = useStore((s) => partnerChatIn(s.chats, couple));
  const [now, setNow] = useState(() => new Date());
  const [sheet, setSheet] = useState(null); // mood | details | write | { letter }
  const [opened, setOpened] = useState(readOpened);

  // Not chatted yet: put my person in the chat list so signals and answers have a chat
  useEffect(() => {
    if (!chatId) partnerChatId(couple);
  }, [chatId, couple]);
  const box = useStore((s) => (chatId ? s.messages[chatId] : null));
  const online = useStore((s) => (chatId ? !!s.chats[chatId]?.online : false));
  const typing = useStore((s) => (chatId ? (s.typing[chatId] || []).length > 0 : false));

  useEffect(() => {
    if (!chatId) return;
    if (!box || (!box.loaded && !box.loading)) loadHistory(chatId);
    socket.queryPresence(partner.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  // Tell the server my time zone once, for "their time" on my person's screen
  useEffect(() => {
    if (tzShared) return;
    tzShared = true;
    updateCouple({ tz: -new Date().getTimezoneOffset() });
  }, []);

  const list = useMemo(() => box?.list || [], [box]);
  const today = isoDay(now);
  const question = questionOfDay(now);
  const answers = useMemo(() => {
    const todays = list.filter((m) => m.metadata?.type === DAILY_ANSWER && m.metadata.day === today);
    return { mine: todays.find((m) => m.mine) || null, theirs: todays.find((m) => !m.mine) || null };
  }, [list, today]);
  const letters = useMemo(
    () => list.filter((m) => !m.mine && m.metadata?.type === OPEN_WHEN).sort((a, b) => b.ts - a.ts),
    [list]
  );

  const days = daysTogether(couple.anniversary, now);
  const next = nextAnniversary(couple.anniversary, now);
  const theirTime = partnerTime(couple.partner_tz, now);
  const name = loveNameFor(couple);

  const openLetter = (m) => {
    setSheet({ letter: m });
    if (!opened[m.id]) {
      const nextOpened = { ...opened, [m.id]: 1 };
      setOpened(nextOpened);
      localStorage.setItem(OPENED_KEY, JSON.stringify(nextOpened));
    }
  };

  return (
    <div className="us-home">
      <section className="us-card raised">
        <div className="us-hero">
          <span className="couple-avatars">
            <Avatar id={me?.id} name={me?.username} color={me?.avatar_color} url={me?.avatar_url} size={58} ring />
            <Avatar id={partner.id} name={partner.name} color={partner.avatar_color} url={partner.avatar_url} size={58} ring />
            <span className="couple-heart" aria-hidden>
              ♥
            </span>
          </span>
          <div className="us-hero-text">
            <span className="us-names">
              {(me?.username || 'You').split(' ')[0]} & {first}
            </span>
            {days ? (
              <>
                <span className="us-days">
                  {days} {days === 1 ? 'day' : 'days'}
                </span>
                <span className="us-since">together since {formatDay(couple.anniversary)}</span>
              </>
            ) : (
              <button type="button" className="us-link" onClick={() => setSheet('details')}>
                + Add your anniversary
              </button>
            )}
          </div>
        </div>
        <div className="us-divider" />
        <div className="us-status">
          <span className={`beat${online ? ' on' : ''}`} aria-hidden />
          <span className="us-status-text">
            <b>{typing ? `${first} is writing you a letter…` : online ? `${first} is online` : `${first} is away`}</b>
            <small>{moodText(couple.partner_mood) ? `Mood: ${moodText(couple.partner_mood)}` : 'No mood shared yet'}</small>
          </span>
          {theirTime && (
            <span className="us-time">
              <small>Their time</small>
              <b>{theirTime}</b>
            </span>
          )}
        </div>
        <div className="us-actions">
          <button type="button" className="mood-chip" onClick={() => setSheet('mood')}>
            {moodText(couple.my_mood) ? `Your mood: ${moodText(couple.my_mood)}` : 'Share your mood'}
          </button>
          <button type="button" className="btn primary" onClick={() => chatId && openChat(chatId)}>
            Open our chat
          </button>
        </div>
      </section>

      <h3 className="us-section">Send some love</h3>
      <div className="signal-row">
        {LOVE_SIGNAL_ORDER.map((id) => (
          <button key={id} type="button" className="signal" onClick={() => chatId && sendLoveSignal(chatId, id, name)} aria-label={LOVE_SIGNALS[id].menu}>
            <span className="signal-circle">{SIGNAL_EMOJI[id]}</span>
            <span className="signal-label">{SIGNAL_LABEL[id]}</span>
          </button>
        ))}
      </div>

      {next && (
        <section className="us-card blush">
          <div className="count-row">
            <b>Our anniversary</b>
            <span>{next.days === 0 ? 'today! 🎉' : next.days === 1 ? 'tomorrow' : `in ${next.days} days`}</span>
          </div>
          <div className="progress">
            <i style={{ width: `${Math.round(Math.max(0, Math.min(1, 1 - next.days / 365)) * 100)}%` }} />
          </div>
          <small className="us-hint">
            {formatDay(couple.anniversary, { year: false })} · {next.years} {next.years === 1 ? 'year' : 'years'} together
          </small>
        </section>
      )}

      <DailyQuestion couple={couple} question={question} today={today} answers={answers} first={first} />

      <h3 className="us-section">Open when…</h3>
      <div className="letter-row">
        <button type="button" className="us-letter write" onClick={() => setSheet('write')}>
          <span className="letter-plus">+</span>
          <span>Write one for {first}</span>
        </button>
        {letters.map((m, i) => (
          <button key={m.id} type="button" className={`us-letter${opened[m.id] ? ' opened' : ''}`} onClick={() => openLetter(m)} aria-label={`Letter: open when ${m.metadata.title}`}>
            <svg className="letter-flap" viewBox="0 0 132 26" preserveAspectRatio="none" aria-hidden>
              <path d="M0 0 L66 22 L132 0" />
            </svg>
            <span className="seal" style={{ background: SEALS[i % SEALS.length] }} />
            <span className="letter-title">{m.metadata.title}</span>
          </button>
        ))}
      </div>
      {!letters.length && <p className="us-hint">Letters {first} writes for you wait here, sealed.</p>}

      <div className="us-foot">
        <button type="button" className="us-link" onClick={() => setSheet('details')}>
          Edit our details
        </button>
        <button
          type="button"
          className="us-link danger"
          onClick={() =>
            confirmDialog({
              title: 'Unpair?',
              body: `Your chats with ${first} stay. Our story and anniversary are removed for both of you.`,
              buttons: [{ label: 'Unpair', danger: true, onClick: () => unpairCouple() }],
            })
          }
        >
          Unpair
        </button>
      </div>

      {sheet === 'mood' && <MoodModal current={couple.my_mood} onClose={() => setSheet(null)} />}
      {sheet === 'details' && <DetailsModal couple={couple} onClose={() => setSheet(null)} />}
      {sheet === 'write' && <WriteModal couple={couple} first={first} onClose={() => setSheet(null)} />}
      {sheet?.letter && (
        <Modal title={`Open when ${sheet.letter.metadata.title}`} onClose={() => setSheet(null)} className="letter-modal">
          <p className="letter-body">{sheet.letter.metadata.letter || sheet.letter.text}</p>
          <p className="letter-from">— {first}</p>
        </Modal>
      )}
    </div>
  );
}

function DailyQuestion({ couple, question, today, answers, first }) {
  const [text, setText] = useState('');
  const nudgeKey = `flick.nudge.${today}`;
  const [nudged, setNudged] = useState(() => !!localStorage.getItem(nudgeKey));
  const send = (e) => {
    e.preventDefault();
    const answer = text.trim();
    if (!answer) return;
    sendToPartner(couple, dailyAnswerText(question, answer), { type: DAILY_ANSWER, day: today, question });
    setText('');
  };
  const nudge = () => {
    localStorage.setItem(nudgeKey, '1');
    setNudged(true);
    sendToPartner(couple, `💭 Today's question is waiting for you: ${question}`);
  };
  return (
    <section className="us-card">
      <span className="us-eyebrow">Today's question</span>
      <p className="us-question">{question}</p>
      {answers.mine ? (
        <>
          <div className="answer">
            <b>You</b>
            <span>{answerOf(answers.mine)}</span>
          </div>
          {answers.theirs ? (
            <div className="answer theirs">
              <b>{first}</b>
              <span>{answerOf(answers.theirs)}</span>
            </div>
          ) : (
            <div className="answer-row">
              <small className="us-hint">{first} hasn't answered yet</small>
              {!nudged && (
                <button type="button" className="btn ghost outline" onClick={nudge}>
                  Nudge
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <form className="answer-form" onSubmit={send}>
          {answers.theirs && <small className="us-hint">{first} answered. Answer to see theirs 💕</small>}
          <div className="answer-input">
            <textarea className="text-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…" maxLength={400} aria-label="Your answer" />
            <button type="submit" className="btn primary" disabled={!text.trim()}>
              Send
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function MoodModal({ current, onClose }) {
  const pick = (label) => {
    onClose();
    updateCouple({ mood: current === label ? null : label });
  };
  return (
    <Modal title="How are you feeling?" onClose={onClose}>
      <div className="mood-grid">
        {MOODS.map((m) => (
          <button key={m.id} type="button" className={`mood${current === m.label ? ' on' : ''}`} onClick={() => pick(m.label)} aria-pressed={current === m.label}>
            <span>{m.emoji}</span>
            {m.label}
          </button>
        ))}
      </div>
      <p className="us-hint">Your person sees it on their Us screen.</p>
    </Modal>
  );
}

function DetailsModal({ couple, onClose }) {
  const [anniversary, setAnniversary] = useState(couple.anniversary || '');
  const [nickname, setNickname] = useState(couple.nickname || '');
  const [error, setError] = useState('');
  const save = async (e) => {
    e.preventDefault();
    const res = await updateCouple({ anniversary: anniversary || null, nickname: nickname.trim() || null });
    if (!res.ok) setError(res.error);
    else onClose();
  };
  return (
    <Modal title="Our details" onClose={onClose}>
      <form className="us-form" onSubmit={save}>
        <label>
          Our anniversary
          <input className="text-input" type="date" value={anniversary} max={isoDay()} onChange={(e) => setAnniversary(e.target.value)} />
        </label>
        <label>
          What do you call {partnerFirstName(couple)}?
          <input className="text-input hand" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Babe, Kutty, Jaan…" maxLength={40} />
        </label>
        <p className="us-hint">Your love signals use it: “Good morning, {nickname.trim() || partnerFirstName(couple)}”.</p>
        {error && <p className="us-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function WriteModal({ couple, first, onClose }) {
  const [title, setTitle] = useState(OPEN_WHEN_TITLES[0]);
  const [body, setBody] = useState('');
  const send = (e) => {
    e.preventDefault();
    const letter = body.trim();
    if (!letter) return;
    sendToPartner(couple, openWhenText(title), { type: OPEN_WHEN, title, letter });
    loveBurst('sent', { signal: 'thinking', particles: ['💌', '💕', '💖', '✉️'] });
    onClose();
  };
  return (
    <Modal title={`A letter for ${first}`} onClose={onClose} width={480}>
      <form className="us-form" onSubmit={send}>
        <span className="us-label">Open when…</span>
        <div className="chip-row">
          {OPEN_WHEN_TITLES.map((t) => (
            <button key={t} type="button" className={`chip${title === t ? ' on' : ''}`} onClick={() => setTitle(t)} aria-pressed={title === t}>
              {t}
            </button>
          ))}
        </div>
        <textarea className="text-input hand letter-input" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write from the heart…" maxLength={2000} aria-label="Your letter" autoFocus />
        <p className="us-hint">It stays sealed until {first} opens it.</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!body.trim()}>
            Seal & send 💌
          </button>
        </div>
      </form>
    </Modal>
  );
}

