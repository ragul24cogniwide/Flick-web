import { useState } from 'react';
import * as api from '../lib/api';
import { GROUP_COLORS, initialsOf } from '../lib/format';
import { usePeople } from '../lib/people';
import { openChat, openPerson, sync, toast } from '../lib/store';
import Icon from '../components/Icon';
import { PanelHeader, Spinner } from '../components/ui';
import PeoplePicker from './PeoplePicker';

const CONTACTS_HINT =
  'Your phone contacts on Flick show here after you open New chat in the Flick app on your phone. You can also type any phone number.';

export function NewChatPanel({ onClose, onNewGroup }) {
  const { people, loading, noContacts } = usePeople();
  return (
    <div className="side-panel">
      <PanelHeader title="New chat" onBack={onClose} />
      <button type="button" className="person-row" onClick={onNewGroup}>
        <span className="round-icon brand">
          <Icon name="users" size={20} />
        </span>
        <span className="person-name">New group</span>
      </button>
      {noContacts && <p className="picker-note">{CONTACTS_HINT}</p>}
      <PeoplePicker
        people={people}
        loading={loading}
        single
        onPick={(p) => {
          openPerson({ ...p, phone_number: p.phone || p.phone_number });
          onClose();
        }}
      />
    </div>
  );
}

export function NewGroupPanel({ onClose }) {
  const { people, loading } = usePeople();
  const [step, setStep] = useState('pick');
  const [picked, setPicked] = useState([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState(GROUP_COLORS[0]);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    const res = await api.createGroup({ name: clean, memberIds: picked.map((p) => p.id), avatarColor: color });
    setBusy(false);
    if (!res.ok) {
      toast(res.error || 'Couldn’t create the group', 'error');
      return;
    }
    await sync(false);
    openChat(res.data.id);
    onClose();
  };

  if (step === 'pick') {
    return (
      <div className="side-panel">
        <PanelHeader title="Add group members" onBack={onClose} />
        <PeoplePicker people={people} loading={loading} picked={picked} onChange={setPicked} />
        {picked.length > 0 && (
          <button type="button" className="fab" onClick={() => setStep('details')} aria-label="Next">
            <Icon name="back" size={22} className="flip" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="side-panel">
      <PanelHeader title="New group" onBack={() => setStep('pick')} />
      <div className="group-details">
        <div className="group-icon-big" style={{ background: color }}>
          {name.trim() ? initialsOf(name) : <Icon name="users" size={44} />}
        </div>
        <div className="swatches" role="radiogroup" aria-label="Group colour">
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={c}
              className={`swatch${c === color ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <label className="field">
          <span>Group name</span>
          <input
            className="text-input"
            value={name}
            maxLength={60}
            placeholder="e.g. Office Team"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </label>
        <p className="muted small">
          {picked.length + 1} members: You, {picked.map((p) => p.name).join(', ')}
        </p>
        <button type="button" className="btn primary wide" disabled={!name.trim() || busy} onClick={create}>
          {busy ? <Spinner size={16} /> : 'Create group'}
        </button>
      </div>
    </div>
  );
}
