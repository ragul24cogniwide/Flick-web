import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { startCall } from '../lib/calls';
import { formatDuration, listTime } from '../lib/format';
import { markCallsSeen } from '../lib/notify';
import { confirmDialog, loadCalls, openPerson, setState, toast, useStore } from '../lib/store';
import Icon from '../components/Icon';
import { Avatar, IconButton, PanelHeader, Spinner } from '../components/ui';

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

export default function CallsPanel({ onClose }) {
  const calls = useStore((s) => s.calls);
  const inCall = useStore((s) => !!s.call);
  const [filter, setFilter] = useState('all');

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

  return (
    <div className="side-panel section-panel">
      <PanelHeader title="Calls" onBack={onClose}>
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
        {calls === null ? (
          <div className="list-empty">
            <Spinner />
          </div>
        ) : !shown.length ? (
          <div className="list-empty">
            <span className="empty-icon">
              <Icon name="phone" size={30} />
            </span>
            <p>{filter === 'missed' ? 'No missed calls.' : 'No calls yet. Start one from any chat with the 📞 or 📹 button.'}</p>
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
