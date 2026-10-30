import { useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import { listTime } from '../lib/format';
import { preparePhoto, uploadPhoto } from '../lib/media';
import { askNotificationPermission, notificationPermission, notificationsSupported, setUi, useUi } from '../lib/notify';
import { updateSessionUser } from '../lib/session';
import { getState, setState, toast, useStore } from '../lib/store';
import Icon from '../components/Icon';
import { Avatar, IconButton, PanelHeader, Spinner, Toggle } from '../components/ui';

const COLORS = ['#FFB800', '#3B82F6', '#10B981', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#EF4444'];

function EditableRow({ label, value, maxLength, onSave, multiline }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const clean = text.trim();
    if (clean === (value || '')) return setEditing(false);
    setBusy(true);
    const ok = await onSave(clean);
    setBusy(false);
    if (ok) setEditing(false);
  };
  return (
    <div className="info-section">
      <h4>{label}</h4>
      {editing ? (
        <div className="edit-row">
          {multiline ? (
            <textarea className="text-input" rows={2} value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} autoFocus />
          ) : (
            <input className="text-input" value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} autoFocus />
          )}
          {busy ? <Spinner size={18} /> : <IconButton icon="check" label="Save" onClick={save} />}
        </div>
      ) : (
        <div className="edit-row">
          <p>{value}</p>
          <IconButton
            icon="edit"
            label={`Edit ${label.toLowerCase()}`}
            size={17}
            onClick={() => {
              setText(value || '');
              setEditing(true);
            }}
          />
        </div>
      )}
    </div>
  );
}

async function saveProfile(changes) {
  const res = await api.updateProfile(changes);
  if (!res.ok) {
    toast(res.error, 'error');
    return false;
  }
  setState((s) => ({ me: { ...s.me, ...res.data } }));
  updateSessionUser(res.data);
  return true;
}

export function ProfilePanel({ onClose }) {
  const me = useStore((s) => s.me);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const changePhoto = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadPhoto(await preparePhoto(file));
      await saveProfile({ avatar_url: url });
    } catch (e) {
      toast(e.message, 'error');
    }
    setUploading(false);
  };

  return (
    <div className="side-panel">
      <PanelHeader title="Profile" onBack={onClose} />
      <div className="info-body">
        <div className="info-hero">
          <button type="button" className="photo-edit" onClick={() => fileRef.current?.click()} aria-label="Change profile photo">
            <Avatar id={me.id} name={me.username} color={me.avatar_color} url={me.avatar_url} size={140} />
            <span className="photo-edit-overlay">{uploading ? <Spinner /> : <><Icon name="image" size={22} /> Change photo</>}</span>
          </button>
          <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => {
            changePhoto(e.target.files?.[0]);
            e.target.value = '';
          }} />
          {me.avatar_url && (
            <button type="button" className="link-btn" onClick={() => saveProfile({ avatar_url: '' })}>
              Remove photo
            </button>
          )}
        </div>
        <EditableRow label="Your name" value={me.username} maxLength={40} onSave={(v) => (v ? saveProfile({ username: v }) : false)} />
        <EditableRow label="About" value={me.quote} maxLength={140} multiline onSave={(v) => saveProfile({ quote: v })} />
        <div className="info-section">
          <h4>Colour</h4>
          <div className="swatches left">
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} className={`swatch${me.avatar_color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => saveProfile({ avatar_color: c })} />
            ))}
          </div>
        </div>
        <div className="info-section">
          <h4>Phone</h4>
          <p>{me.phone_number}</p>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({ onClose, onLogout }) {
  const ui = useUi();
  const prefs = useStore((s) => s.prefs);
  const [permission, setPermission] = useState(notificationPermission());
  const [sessions, setSessions] = useState(null);

  useEffect(() => {
    api.listSessions().then((res) => setSessions(res.ok ? res.data.sessions : []));
  }, []);

  const setPref = async (key, value) => {
    const before = getState().prefs;
    setState({ prefs: { ...before, [key]: value } });
    const res = await api.updatePreferences({ [key]: value });
    if (!res.ok) {
      setState({ prefs: before });
      toast(res.error, 'error');
    } else setState({ prefs: res.data });
  };

  const enableNotifications = async (on) => {
    if (on && permission !== 'granted') {
      const result = await askNotificationPermission();
      setPermission(result);
      if (result !== 'granted') {
        toast('Notifications are blocked. Allow them for this site in your browser settings.', 'error');
        return;
      }
    }
    setUi({ notifications: on });
  };

  return (
    <div className="side-panel">
      <PanelHeader title="Settings" onBack={onClose} />
      <div className="settings">
        <h3 className="settings-title">
          <Icon name="moon" size={16} /> Appearance
        </h3>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {[
            ['system', 'System'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ].map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={ui.theme === k} className={ui.theme === k ? 'on' : ''} onClick={() => setUi({ theme: k })}>
              {label}
            </button>
          ))}
        </div>

        <h3 className="settings-title">
          <Icon name="bell" size={16} /> Notifications
        </h3>
        <Toggle
          label="Desktop notifications"
          hint={!notificationsSupported() ? 'Not supported in this browser' : permission === 'denied' ? 'Blocked in your browser settings' : 'Show new messages while Flick is in the background'}
          checked={ui.notifications && permission === 'granted'}
          disabled={!notificationsSupported()}
          onChange={enableNotifications}
        />
        <Toggle label="Show message preview" hint="In desktop notifications on this computer" checked={ui.notificationPreview} onChange={(v) => setUi({ notificationPreview: v })} />
        <Toggle label="Sounds" hint="For incoming messages and calls" checked={ui.sounds} onChange={(v) => setUi({ sounds: v })} />
        <Toggle label="Message notifications" hint="For this account, on all your devices" checked={prefs.msg_notifications !== false} onChange={(v) => setPref('msg_notifications', v)} />

        <h3 className="settings-title">
          <Icon name="lock" size={16} /> Privacy
        </h3>
        <Toggle label="Read receipts" hint="If off, you won’t send or see blue ticks (except in groups)" checked={prefs.read_receipts !== false} onChange={(v) => setPref('read_receipts', v)} />
        <Toggle label="Show my last seen" hint="If off, you can’t see other people’s last seen either" checked={prefs.last_seen !== 'nobody'} onChange={(v) => setPref('last_seen', v ? 'everyone' : 'nobody')} />

        <h3 className="settings-title">
          <Icon name="type" size={16} /> Chats
        </h3>
        <Toggle label="Enter is send" hint="Shift + Enter adds a new line" checked={ui.enterToSend} onChange={(v) => setUi({ enterToSend: v })} />

        <h3 className="settings-title">
          <Icon name="monitor" size={16} /> Linked devices
        </h3>
        {sessions === null ? (
          <Spinner size={18} />
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="device-row">
              <Icon name="monitor" size={18} />
              <span>
                {s.device_name}
                {s.current && <b> · This browser</b>}
                <small>Active {listTime(s.last_active_at)}</small>
              </span>
            </div>
          ))
        )}
        <p className="muted small">To log out other browsers, open Flick on your phone: ⋮ → Linked devices.</p>

        <button type="button" className="danger-row" onClick={onLogout}>
          <Icon name="logout" size={18} /> Log out of this browser
        </button>
      </div>
    </div>
  );
}
