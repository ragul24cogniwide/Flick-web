import { useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { lastSeenText, sameUser } from '../lib/format';
import { confirmDialog, loadGroupInfo, openChat, openPerson, setState, sync, toast, useStore } from '../lib/store';
import Icon from '../components/Icon';
import { Avatar, IconButton, Modal, Spinner } from '../components/ui';
import PeoplePicker from './PeoplePicker';

function ContactInfo({ chat }) {
  return (
    <div className="info-body">
      <div className="info-hero">
        <Avatar id={chat.id} name={chat.name} color={chat.avatar_color} url={chat.avatar_url} size={120} />
        <h3>{chat.name}</h3>
        {!chat.isAgent && <p className="muted">{chat.phone}</p>}
        <p className="muted small">{chat.online ? 'online' : lastSeenText(chat.last_seen)}</p>
      </div>
      {chat.quote && (
        <div className="info-section">
          <h4>About</h4>
          <p>{chat.quote}</p>
        </div>
      )}
      <div className="info-section">
        <p className="muted small">
          <Icon name="lock" size={13} /> Calls go directly between your devices, encrypted end to end.
        </p>
      </div>
    </div>
  );
}

function RenameModal({ group, onClose }) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const clean = name.trim();
    if (!clean) return;
    setBusy(true);
    const changes = {};
    if (clean !== group.name) changes.name = clean;
    if (description.trim() !== (group.description || '')) changes.description = description.trim();
    if (Object.keys(changes).length) {
      const res = await api.updateGroup(group.id, changes);
      if (!res.ok) {
        toast(res.error, 'error');
        setBusy(false);
        return;
      }
      await loadGroupInfo(group.id);
      sync(false);
    }
    onClose();
  };
  return (
    <Modal title="Edit group" onClose={onClose}>
      <label className="field">
        <span>Group name</span>
        <input className="text-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </label>
      <label className="field">
        <span>Description</span>
        <textarea className="text-input" rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={save}>
          {busy ? <Spinner size={16} /> : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

function AddMembersModal({ group, onClose }) {
  const chats = useStore((s) => s.chats);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const existing = useMemo(() => new Set((group.members || []).map((m) => m.id)), [group.members]);
  const people = useMemo(() => Object.values(chats).filter((c) => !c.is_group && !c.isAgent && !existing.has(c.id)), [chats, existing]);
  const add = async () => {
    setBusy(true);
    const res = await api.addGroupMembers(group.id, picked.map((p) => p.id));
    setBusy(false);
    if (!res.ok) {
      toast(res.error, 'error');
      return;
    }
    loadGroupInfo(group.id);
    onClose();
  };
  return (
    <Modal title="Add members" onClose={onClose} width={460}>
      <PeoplePicker people={people} picked={picked} onChange={setPicked} />
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={busy || !picked.length} onClick={add}>
          {busy ? <Spinner size={16} /> : `Add${picked.length ? ` ${picked.length}` : ''}`}
        </button>
      </div>
    </Modal>
  );
}

function GroupInfo({ chat }) {
  const me = useStore((s) => s.me);
  const group = useStore((s) => s.groupInfo[chat.id]);
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    loadGroupInfo(chat.id);
  }, [chat.id]);

  const run = async (action, failText) => {
    const res = await action();
    if (!res.ok) toast(res.error || failText, 'error');
    else {
      loadGroupInfo(chat.id);
      sync(false);
    }
    return res.ok;
  };

  if (!group) {
    return (
      <div className="info-body center">
        <Spinner />
      </div>
    );
  }

  const members = group.members || [];
  const isMember = group.is_member !== false && chat.is_member !== false;
  const myRole = members.find((m) => sameUser(m.id, me?.id))?.role;
  const isAdmin = isMember && (group.my_role === 'admin' || myRole === 'admin');

  const memberActions = (m) => {
    if (sameUser(m.id, me?.id)) return;
    const buttons = [{ label: `Message ${m.name?.split(' ')[0] || ''}`.trim(), onClick: () => openPerson({ ...m, phone_number: m.phone_number }) }];
    if (isAdmin) {
      buttons.push(
        m.role === 'admin'
          ? { label: 'Dismiss as admin', onClick: () => run(() => api.setGroupAdmin(chat.id, m.id, false), 'Couldn’t change admin') }
          : { label: 'Make group admin', onClick: () => run(() => api.setGroupAdmin(chat.id, m.id, true), 'Couldn’t change admin') },
      );
      if (!m.is_creator) {
        buttons.push({
          label: 'Remove from group',
          danger: true,
          onClick: () =>
            confirmDialog({
              title: `Remove ${m.name}?`,
              body: 'They will stop getting messages from this group.',
              buttons: [{ label: 'Remove', danger: true, onClick: () => run(() => api.removeGroupMember(chat.id, m.id), 'Couldn’t remove them') }],
            }),
        });
      }
    }
    confirmDialog({ title: m.name, body: m.role === 'admin' ? 'Group admin' : m.phone_number, buttons, cancelLabel: 'Close' });
  };

  const exit = () =>
    confirmDialog({
      title: `Exit “${group.name}”?`,
      body: 'You’ll stop getting messages from this group. You can still read what was sent before you left.',
      buttons: [{ label: 'Exit group', danger: true, onClick: () => run(() => api.leaveGroup(chat.id), 'Couldn’t leave the group') }],
    });

  const remove = () =>
    confirmDialog({
      title: `Delete “${group.name}”?`,
      body: 'The group and its messages will be removed from your chats.',
      buttons: [
        {
          label: 'Delete group',
          danger: true,
          onClick: async () => {
            const res = await api.deleteGroupChat(chat.id);
            if (!res.ok) return toast(res.error, 'error');
            openChat(null);
            setState((s) => {
              const chats = { ...s.chats };
              delete chats[chat.id];
              return { chats };
            });
            sync(false);
          },
        },
      ],
    });

  return (
    <div className="info-body">
      <div className="info-hero">
        <Avatar id={chat.id} name={group.name} color={group.avatar_color} url={group.avatar_url} size={120} />
        <h3>
          {group.name}
          {isAdmin && <IconButton icon="edit" label="Edit group" size={16} onClick={() => setRenaming(true)} />}
        </h3>
        <p className="muted">{isMember ? `Group · ${members.length} members` : 'You’re no longer a member'}</p>
      </div>
      {group.description && (
        <div className="info-section">
          <h4>Description</h4>
          <p className="pre">{group.description}</p>
        </div>
      )}
      {isMember && (
        <div className="info-section flush">
          <h4 className="pad">{members.length} members</h4>
          {isAdmin && (
            <button type="button" className="person-row" onClick={() => setAdding(true)}>
              <span className="round-icon brand">
                <Icon name="plus" size={20} />
              </span>
              <span className="person-name">Add members</span>
            </button>
          )}
          {members.map((m) => (
            <button type="button" key={m.id} className="person-row" onClick={() => memberActions(m)}>
              <Avatar id={m.id} name={m.name} color={m.avatar_color} url={m.avatar_url} size={40} />
              <span className="person-text">
                <span className="person-name">{sameUser(m.id, me?.id) ? 'You' : m.name}</span>
                <span className="person-sub">{m.quote || m.phone_number}</span>
              </span>
              {m.role === 'admin' && <span className="admin-badge">Admin</span>}
            </button>
          ))}
        </div>
      )}
      <div className="info-section flush">
        {isMember ? (
          <button type="button" className="danger-row" onClick={exit}>
            <Icon name="logout" size={18} /> Exit group
          </button>
        ) : (
          <button type="button" className="danger-row" onClick={remove}>
            <Icon name="trash" size={18} /> Delete group
          </button>
        )}
      </div>
      {renaming && <RenameModal group={group} onClose={() => setRenaming(false)} />}
      {adding && <AddMembersModal group={group} onClose={() => setAdding(false)} />}
    </div>
  );
}

export default function InfoPanel({ chat, onClose }) {
  return (
    <aside className="info-panel">
      <header className="panel-header">
        <IconButton icon="x" label="Close" onClick={onClose} />
        <h2>{chat.is_group ? 'Group info' : 'Contact info'}</h2>
      </header>
      {chat.is_group ? <GroupInfo chat={chat} /> : <ContactInfo chat={chat} />}
    </aside>
  );
}
