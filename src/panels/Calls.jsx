import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { startCall } from '../lib/calls';
import { formatDuration, listTime } from '../lib/format';
import { markCallsSeen } from '../lib/notify';
import { confirmDialog, loadCalls, openPerson, setState, toast, useStore } from '../lib/store';
import Icon from '../components/Icon';
import { Avatar, IconButton, PanelHeader, Spinner } from '../components/ui';
import { usePeople } from '../lib/people';
import { partnerFirstName, partnerName, useCouple } from '../lib/couple';
import { sameUser } from '../lib/format';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const talkText = (sec) => {
  const mins = Math.round(sec / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
};

/** My person first: big voice / video buttons and how long we talked each day this week. */
function PartnerCallCard({ couple, calls, inCall }) {
  const partner = couple.partner;
  const week = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i);
      return { day: DAY_LETTERS[d.getDay()], seconds: 0, today: i === 6 };
    });
    for (const c of calls || []) {
      if (c.status !== 'completed' || !sameUser(c.peer?.id, partner.id)) continue;
      const ts = Date.parse(c.started_at);
      const idx = Math.floor((ts - start) / 86400000);
      if (idx >= 0 && idx < 7) days[idx].seconds += Number(c.duration) || 0;
    }
    return { days, total: days.reduce((n, d) => n + d.seconds, 0) };
  }, [calls, partner.id]);
  const max = Math.max(1, ...week.days.map((d) => d.seconds));
  const person = { id: partner.id, name: partner.name, avatar_url: partner.avatar_url, avatar_color: partner.avatar_color };
  return (
    <div className="partner-call">
      <div className="us-card raised center">
        <span className="pin-avatar big">
          <Avatar id={partner.id} name={partner.name} color={partner.avatar_color} url={partner.avatar_url} size={72} />
        </span>
        <b className="partner-call-name">{partnerName(couple)}</b>
        <div className="partner-call-btns">
          <button type="button" className="btn primary" disabled={inCall} onClick={() => startCall(partner.id, false, person)}>
            <Icon name="phone" size={16} /> Voice
          </button>
          <button type="button" className="btn outline" disabled={inCall} onClick={() => startCall(partner.id, true, person)}>
            <Icon name="video" size={16} /> Video
          </button>
        </div>
      </div>
      <div className="us-card blush" aria-label={`This week you talked ${talkText(week.total)} with ${partnerFirstName(couple)}`}>
        <div className="count-row">
          <b>This week we talked</b>
          <span>{talkText(week.total)}</span>
        </div>
        <div className="bars" aria-hidden>
          {week.days.map((d, i) => (
            <span key={i} className={d.today ? 'today' : ''}>
              <i style={{ height: `${Math.max(4, Math.round((d.seconds / max) * 52))}px` }} />
              {d.day}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const LABEL = {
  completed: (c) => (c.direction === 'outgoing' ? 'Outgoing' : 'Incoming'),
  missed: () => 'Missed',
  no_answer: () => 'No answer',
  declined: () => 'Declined',
  busy: () => 'Busy',
  ongoing: () => 'In progress',
};
const isMissed = (c) => c.direction === 'incoming' && (c.status === 'missed' || c.status === 'declined');

function CallRow({ call, inCall }) {
  const remove = async () => {
    const res = await api.removeCall(call.id);
    if (!res.ok) return toast(res.error, 'error');
    setState((s) => ({ calls: (s.calls || []).filter((c) => c.id !== call.id) }));
  };
  return (
    <div className="call-row">
      <button type="button" className="call-row-main" onClick={() => openPerson(call.peer)} title={`Message ${call.peer.name}`}>
        <Avatar id={call.peer.id} name={call.peer.name} color={call.peer.avatar_color} url={call.peer.avatar_url} size={46} />
        <span className="call-row-text">
          <span className={`call-row-name${isMissed(call) ? ' missed' : ''}`}>{call.peer.name}</span>
          <span className={`call-row-sub${call.status !== 'completed' && call.status !== 'ongoing' ? ' bad' : ''}`}>
            <Icon name={call.direction === 'outgoing' ? 'callOut' : 'callIn'} size={14} stroke={2.4} />
            {(LABEL[call.status] || LABEL.completed)(call)}
            <span className="dot">·</span>
            <Icon name={call.video ? 'video' : 'phone'} size={12} />
            {call.status === 'completed' && call.duration > 0 && <span>{formatDuration(call.duration)}</span>}
          </span>
        </span>
        <span className="call-row-time">{listTime(call.started_at)}</span>
      </button>
      <IconButton
        icon={call.video ? 'video' : 'phone'}
        label={`${call.video ? 'Video' : 'Voice'} call ${call.peer.name}`}
        className="call-back"
        disabled={inCall}
        onClick={() => startCall(call.peer.id, call.video)}
      />
      <IconButton icon="trash" label="Remove from call log" className="call-remove" size={16} onClick={remove} />
    </div>
  );
}

/**
 * New call: your phone contacts on Flick and people you chat with. The server only rings people
 * in your contacts, or who have messaged or called you; anyone else gets a "Can't call" note.
 */
function NewCallPanel({ onBack, inCall }) {
  const { people, loading, noContacts } = usePeople();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return people
      .filter((p) => !q || p.name?.toLowerCase().includes(q) || (digits.length >= 3 && (p.phone || p.phone_number || '').includes(digits)))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [people, query]);
  const call = (p, video) => {
    startCall(p.id, video, p);
    onBack();
  };
  return (
    <div className="side-panel">
      <PanelHeader title="New call" onBack={onBack} />
      {noContacts && (
        <p className="picker-note">
          Your phone contacts on Flick show here after you open New chat in the Flick app on your phone.
        </p>
      )}
      <div className="search-box inset">
        <Icon name="search" size={17} />
        <input type="search" placeholder="Search contacts" value={query} maxLength={40} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      <div className="picker-list">
        {loading && !shown.length && (
          <p className="picker-note">
            <Spinner size={16} /> Loading your contacts…
          </p>
        )}
        {!loading && !shown.length && (
          <p className="picker-note">
            {query ? 'No one found.' : 'You can call your contacts on Flick, and anyone who has messaged or called you.'}
          </p>
        )}
        {shown.map((p) => (
          <div key={p.id} className="call-row">
            <span className="call-row-main">
              <Avatar id={p.id} name={p.name} color={p.avatar_color} url={p.avatar_url} size={40} />
              <span className="call-row-text">
                <span className="call-row-name">{p.name}</span>
                <span className="call-row-sub">{p.quote || p.phone || p.phone_number}</span>
              </span>
            </span>
            <IconButton icon="video" label={`Video call ${p.name}`} className="call-back" disabled={inCall} onClick={() => call(p, true)} />
            <IconButton icon="phone" label={`Voice call ${p.name}`} className="call-back" disabled={inCall} onClick={() => call(p, false)} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CallsPanel({ onClose }) {
  const calls = useStore((s) => s.calls);
  const inCall = useStore((s) => !!s.call);
  const [filter, setFilter] = useState('all');
  const [picking, setPicking] = useState(false);
  const couple = useCouple();

  useEffect(() => {
    loadCalls();
    markCallsSeen();
  }, []);
  // Stays "seen" while the panel is open
  useEffect(() => {
    if (calls) markCallsSeen();
  }, [calls]);

  const shown = useMemo(() => (calls || []).filter((c) => filter === 'all' || isMissed(c)), [calls, filter]);

  const clearAll = () =>
    confirmDialog({
      title: 'Clear call log?',
      body: 'Your call history will be removed from your devices. The other people keep theirs.',
      buttons: [
        {
          label: 'Clear call log',
          danger: true,
          onClick: async () => {
            const res = await api.clearCalls();
            if (!res.ok) return toast(res.error, 'error');
            setState({ calls: [] });
          },
        },
      ],
    });

  if (picking) return <NewCallPanel onBack={() => setPicking(false)} inCall={inCall} />;

  return (
    <div className="side-panel section-panel">
      <PanelHeader title="Calls" onBack={onClose}>
        <IconButton icon="phone" label="New call" onClick={() => setPicking(true)} disabled={inCall} />
        <IconButton icon="trash" label="Clear call log" onClick={clearAll} disabled={!calls?.length} />
      </PanelHeader>
      <div className="filters">
        {[
          ['all', 'All'],
          ['missed', 'Missed'],
        ].map(([k, label]) => (
          <button key={k} type="button" className={`chip${filter === k ? ' on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="calls-list">
        {filter === 'all' && couple?.status === 'paired' && couple.partner && <PartnerCallCard couple={couple} calls={calls} inCall={inCall} />}
        {calls === null ? (
          <div className="list-empty">
            <Spinner />
          </div>
        ) : !shown.length ? (
          <div className="list-empty">
            <span className="empty-icon">
              <Icon name="phone" size={30} />
            </span>
            <p>{filter === 'missed' ? 'No missed calls.' : 'No calls yet. Tap 📞 above to call a contact, or use 📞 / 📹 in a chat.'}</p>
          </div>
        ) : (
          shown.map((c) => <CallRow key={c.id} call={c} inCall={inCall} />)
        )}
        <p className="muted small pad center">
          <Icon name="lock" size={12} /> Calls are end-to-end encrypted. Click a name to open the chat.
        </p>
      </div>
    </div>
  );
}
