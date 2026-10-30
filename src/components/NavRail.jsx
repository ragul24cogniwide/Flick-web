import { useMemo } from 'react';
import { callsSeenAt } from '../lib/notify';
import { useStore } from '../lib/store';
import Icon from './Icon';

function RailButton({ icon, label, active, badge, onClick }) {
  return (
    <button
      type="button"
      className={`rail-btn${active ? ' active' : ''}`}
      onClick={onClick}
      aria-label={badge ? `${label}, ${badge} new` : label}
      aria-current={active ? 'page' : undefined}
      title={label}
    >
      <Icon name={icon} size={22} stroke={active ? 2.3 : 2} />
      {badge > 0 && <span className="rail-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

/**
 * The bar on the far left (bottom on small screens): switch between Chats, Status and Calls,
 * start a new group, open Settings.
 */
export default function NavRail({ section, onSection, onNewGroup }) {
  const chats = useStore((s) => s.chats);
  const calls = useStore((s) => s.calls);
  const unreadChats = useMemo(() => Object.values(chats).filter((c) => c.unread && !c.archived).length, [chats]);
  const missedCalls = useMemo(() => {
    if (section === 'calls' || !calls) return 0;
    const seen = callsSeenAt();
    return calls.filter((c) => c.direction === 'incoming' && c.status === 'missed' && Date.parse(c.started_at) > seen).length;
  }, [calls, section]);

  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-group">
        <RailButton icon="chat" label="Chats" active={section === 'chats'} badge={unreadChats} onClick={() => onSection('chats')} />
        <RailButton icon="status" label="Status" active={section === 'status'} onClick={() => onSection('status')} />
        <RailButton icon="phone" label="Calls" active={section === 'calls'} badge={missedCalls} onClick={() => onSection('calls')} />
        <RailButton icon="groupAdd" label="New group" onClick={onNewGroup} />
      </div>
      <div className="rail-group">
        <RailButton icon="settings" label="Settings" active={section === 'settings'} onClick={() => onSection('settings')} />
      </div>
    </nav>
  );
}
