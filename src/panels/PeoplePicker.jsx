import { useMemo, useState } from 'react';
import * as api from '../lib/api';
import Icon from '../components/Icon';
import { Avatar, Spinner } from '../components/ui';

const cleanNumber = (raw) => {
  const v = String(raw || '').replace(/[\s()-]/g, '');
  if (!/^\+?\d{8,15}$/.test(v)) return null;
  return v.startsWith('+') ? v : v.length === 10 ? `+91${v}` : `+${v}`;
};

/**
 * Pick people from your chats, or find someone by phone number. `single` picks one person
 * (new chat); otherwise several (groups), shown as removable chips.
 */
export default function PeoplePicker({ people, picked = [], onChange, single = false, onPick }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState('');

  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  const all = useMemo(() => {
    const map = new Map();
    [...found, ...people].forEach((p) => map.set(p.id, p));
    return [...map.values()];
  }, [people, found]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return all
      .filter((p) => !q || p.name?.toLowerCase().includes(q) || (digits.length >= 3 && (p.phone || p.phone_number || '').includes(digits)))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [all, query]);

  const number = cleanNumber(query);

  const lookUp = async () => {
    if (!number) return;
    setLooking(true);
    setNote('');
    const res = await api.lookupNumbers([number]);
    setLooking(false);
    const users = (res.data?.registered_users || []).map((u) => ({ ...u, phone: u.phone_number }));
    if (!res.ok) setNote(res.error);
    else if (!users.length) setNote('That number isn’t on Flick yet.');
    else {
      setFound((prev) => [...users, ...prev.filter((p) => !users.some((u) => u.id === p.id))]);
      if (single) onPick(users[0]);
      else onChange([...picked, ...users.filter((u) => !pickedIds.has(u.id))]);
      setQuery('');
    }
  };

  const toggle = (p) => {
    if (single) return onPick(p);
    onChange(pickedIds.has(p.id) ? picked.filter((x) => x.id !== p.id) : [...picked, p]);
  };

  return (
    <div className="picker">
      {!single && picked.length > 0 && (
        <div className="chips">
          {picked.map((p) => (
            <button key={p.id} type="button" className="person-chip" onClick={() => toggle(p)} aria-label={`Remove ${p.name}`}>
              <Avatar id={p.id} name={p.name} color={p.avatar_color} url={p.avatar_url} size={24} />
              <span>{p.name}</span>
              <Icon name="x" size={14} />
            </button>
          ))}
        </div>
      )}
      <div className="search-box inset">
        <Icon name="search" size={17} />
        <input
          type="search"
          placeholder="Search name or enter a phone number"
          value={query}
          maxLength={40}
          onChange={(e) => {
            setQuery(e.target.value);
            setNote('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && number && lookUp()}
          autoFocus
        />
      </div>
      {number && !shown.length && (
        <button type="button" className="person-row" onClick={lookUp} disabled={looking}>
          <span className="round-icon brand">{looking ? <Spinner size={18} /> : <Icon name="search" size={18} />}</span>
          <span className="person-text">
            <span className="person-name">Find {number} on Flick</span>
            <span className="person-sub">Checks whether this number has an account</span>
          </span>
        </button>
      )}
      {note && <p className="picker-note">{note}</p>}
      <div className="picker-list">
        {shown.map((p) => (
          <button type="button" key={p.id} className={`person-row${pickedIds.has(p.id) ? ' picked' : ''}`} onClick={() => toggle(p)}>
            <Avatar id={p.id} name={p.name} color={p.avatar_color} url={p.avatar_url} size={40} />
            <span className="person-text">
              <span className="person-name">{p.name}</span>
              <span className="person-sub">{p.quote || p.phone || p.phone_number}</span>
            </span>
            {!single && <span className={`check-circle${pickedIds.has(p.id) ? ' on' : ''}`}>{pickedIds.has(p.id) && <Icon name="check" size={14} stroke={3} />}</span>}
          </button>
        ))}
        {!shown.length && !number && <p className="picker-note">{query ? 'No one found. Try a phone number.' : 'No contacts yet. Enter a phone number.'}</p>}
      </div>
    </div>
  );
}
