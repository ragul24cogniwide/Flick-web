import { Fragment, memo, useMemo, useRef, useState } from 'react';
import { listTime, toMs, typingLabel } from '../lib/format';
import { openChat, setArchived, useStore } from '../lib/store';
import Icon from './Icon';
import { Avatar, IconButton, Menu, Spinner } from './ui';

const FILTERS = [
  ['all', 'All'],
  ['unread', 'Unread'],
  ['groups', 'Groups'],
];

const ChatRow = memo(function ChatRow({ chat, active, typers }) {
  const typing = typers?.length ? (chat.is_group ? typingLabel(typers) : 'typing…') : '';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuBtn = useRef(null);
  const canArchive = !chat.isAgent;
  return (
    <div
      className={`chat-row-wrap${menuOpen ? ' menu-open' : ''}`}
      onContextMenu={(e) => {
        // Right-click opens the chat's menu (Archive / Unarchive)
        if (!canArchive) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        className={`chat-row${active ? ' active' : ''}${chat.unread ? ' unread' : ''}`}
        onClick={() => openChat(chat.id)}
        aria-current={active ? 'true' : undefined}
      >
        <Avatar
          id={chat.id}
          name={chat.name}
          color={chat.avatar_color}
          url={chat.avatar_url}
          size={48}
          group={chat.is_group}
          online={!chat.is_group && chat.online}
        />
        <span className="chat-row-body">
          <span className="chat-row-top">
            <span className="chat-row-name">
              {chat.name}
              {chat.isAgent && <Icon name="sparkles" size={13} className="agent-spark" />}
            </span>
            <span className="chat-row-time">{listTime(chat.time)}</span>
          </span>
          <span className="chat-row-bottom">
            {typing ? (
              <span className="chat-row-typing">{typing}</span>
            ) : (
              <span className="chat-row-preview">{chat.last_message || (chat.is_group ? 'Group created' : chat.quote || '')}</span>
            )}
            {chat.unread > 0 && <span className="unread-badge">{chat.unread > 99 ? '99+' : chat.unread}</span>}
          </span>
        </span>
      </button>
      {canArchive && (
        <button
          type="button"
          ref={menuBtn}
          className="chat-row-menu-btn"
          aria-label={`${chat.name} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Icon name="chevronDown" size={18} />
        </button>
      )}
      {menuOpen && (
        <Menu
          anchor={menuBtn}
          onClose={() => setMenuOpen(false)}
          items={[
            { label: chat.archived ? 'Unarchive chat' : 'Archive chat', icon: 'archive', onClick: () => setArchived([chat.id], !chat.archived) },
          ]}
        />
      )}
    </div>
  );
});

export default function Sidebar({ onPanel, onLogout }) {
  const me = useStore((s) => s.me);
  const chats = useStore((s) => s.chats);
  const typing = useStore((s) => s.typing);
  const activeId = useStore((s) => s.activeId);
  const ready = useStore((s) => s.ready);
  const connected = useStore((s) => s.connected);
  const syncError = useStore((s) => s.syncError);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const menuBtn = useRef(null);

  const archived = useMemo(() => {
    const all = Object.values(chats).filter((c) => c.archived);
    return { count: all.length, unread: all.filter((c) => c.unread).length };
  }, [chats]);
  const inArchive = showArchived && archived.count > 0;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(chats)
      .filter((c) => {
        // Search looks through archived chats too; otherwise each view shows its own chats
        if (!q && !!c.archived !== inArchive) return false;
        if (filter === 'unread' && !c.unread) return false;
        if (filter === 'groups' && !c.is_group) return false;
        if (!q) return true;
        return c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.last_message || '').toLowerCase().includes(q);
      })
      // Flick AI Agent always first, then the newest conversation
      .sort((a, b) => b.isAgent - a.isAgent || (b.time ? toMs(b.time) : 0) - (a.time ? toMs(a.time) : 0));
  }, [chats, query, filter, inArchive]);

  const archivedRow = !inArchive && !query && filter === 'all' && archived.count > 0 && (
    <button type="button" className="archived-row" onClick={() => setShowArchived(true)}>
      <span className="archived-icon">
        <Icon name="archive" size={19} />
      </span>
      <span className="archived-label">Archived</span>
      <span className={`archived-count${archived.unread ? ' unread' : ''}`}>{archived.unread || archived.count}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <button type="button" className="me-btn" onClick={() => onPanel('profile')} title={me?.username || 'Profile'} aria-label="Your profile">
          <Avatar id={me?.id} name={me?.username} color={me?.avatar_color} url={me?.avatar_url} size={40} />
          <span className="me-name">{me?.username || 'Flick user'}</span>
        </button>
        <div className="sidebar-actions">
          <IconButton icon="status" label="Status" onClick={() => onPanel('status')} />
          <IconButton icon="newChat" label="New chat" onClick={() => onPanel('newChat')} />
          <div className="menu-wrap">
            <IconButton icon="more" label="Menu" onClick={() => setMenuOpen((v) => !v)} ref={menuBtn} aria-haspopup="menu" aria-expanded={menuOpen} />
            {menuOpen && (
              <Menu
                anchor={menuBtn}
                onClose={() => setMenuOpen(false)}
                items={[
                  { label: 'New group', icon: 'users', onClick: () => onPanel('newGroup') },
                  { label: 'Settings', icon: 'settings', onClick: () => onPanel('settings') },
                  { label: 'Log out', icon: 'logout', danger: true, onClick: onLogout },
                ]}
              />
            )}
          </div>
        </div>
      </header>

      {!connected && ready && (
        <div className="offline-bar" role="status">
          <Icon name="refresh" size={15} /> Connecting to Flick…
        </div>
      )}

      <div className="search-box">
        <Icon name="search" size={17} />
        <input
          type="search"
          placeholder="Search or start a new chat"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search chats"
          maxLength={100}
        />
        {query && <IconButton icon="x" label="Clear search" size={16} onClick={() => setQuery('')} />}
      </div>

      {inArchive && (
        <div className="archive-head">
          <IconButton icon="back" label="Back to chats" onClick={() => setShowArchived(false)} />
          <h2>Archived</h2>
        </div>
      )}

      <div className={`filters${inArchive ? ' hidden' : ''}`} role="tablist">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={`chip${filter === key ? ' on' : ''}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className="chat-list">
        {!ready ? (
          <div className="list-empty">
            <Spinner />
          </div>
        ) : syncError && !list.length ? (
          <div className="list-empty">
            <p>{syncError}</p>
          </div>
        ) : !list.length && !(archived.count && !inArchive && !query) ? (
          <div className="list-empty">
            <p>{query ? `No chats match “${query}”.` : filter === 'unread' ? 'No unread chats.' : filter === 'groups' ? 'No groups yet.' : 'No chats yet.'}</p>
            {!query && filter !== 'unread' && (
              <button type="button" className="btn primary" onClick={() => onPanel(filter === 'groups' ? 'newGroup' : 'newChat')}>
                {filter === 'groups' ? 'New group' : 'Start a chat'}
              </button>
            )}
          </div>
        ) : (
          <>
            {inArchive && <p className="archive-note">These chats stay archived when new messages arrive.</p>}
            {/* Flick AI Agent stays first; the Archived row comes right after it */}
            {list.map((c, i) => (
              <Fragment key={c.id}>
                {i === (list[0]?.isAgent ? 1 : 0) && archivedRow}
                <ChatRow chat={c} active={c.id === activeId} typers={typing[c.id]} />
              </Fragment>
            ))}
            {list.length <= (list[0]?.isAgent ? 1 : 0) && archivedRow}
          </>
        )}
      </div>
      <div className="sidebar-foot">
        <Icon name="lock" size={12} /> Linked to your phone
      </div>
    </aside>
  );
}
