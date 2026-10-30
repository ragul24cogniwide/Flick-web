import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import { listTime, mediaUrl, safeColor } from '../lib/format';
import { preparePhoto, uploadPhoto } from '../lib/media';
import { confirmDialog, toast, useStore } from '../lib/store';
import Icon from '../components/Icon';
import { Avatar, IconButton, Modal, PanelHeader, Spinner } from '../components/ui';

const STORY_MS = 5000;
const BG_PALETTE = ['#1E293B', '#0F766E', '#1D4ED8', '#581C87', '#B45309', '#BE185D', '#047857', '#334155'];

function StoryViewer({ owner, stories, mine, onClose, onDeleted }) {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const story = stories[index];

  const next = useCallback(() => {
    setProgress(0);
    if (index + 1 < stories.length) setIndex(index + 1);
    else onClose();
  }, [index, stories.length, onClose]);
  const prev = () => {
    setProgress(0);
    setIndex((i) => Math.max(0, i - 1));
  };

  useEffect(() => {
    if (story && !mine) api.viewStatus(story.id);
  }, [story, mine]);

  useEffect(() => {
    if (paused) return undefined;
    const started = Date.now() - progress * STORY_MS;
    const t = setInterval(() => {
      const p = (Date.now() - started) / STORY_MS;
      if (p >= 1) {
        clearInterval(t);
        next();
      } else setProgress(p);
    }, 50);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart per story / pause
  }, [index, paused, next]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [next, onClose]);

  if (!story) return null;
  const image = story.type !== 'text' ? mediaUrl(story.uri) : null;

  const remove = () =>
    confirmDialog({
      title: 'Delete this status?',
      buttons: [
        {
          label: 'Delete',
          danger: true,
          onClick: async () => {
            const res = await api.deleteStatus(story.id);
            if (!res.ok) return toast(res.error, 'error');
            onDeleted();
            onClose();
          },
        },
      ],
    });

  return (
    <div className="story" role="dialog" aria-label={`${owner.name}'s status`}>
      <div className="story-bars">
        {stories.map((s, i) => (
          <span key={s.id}>
            <i style={{ width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` }} />
          </span>
        ))}
      </div>
      <header className="story-head">
        <Avatar id={owner.id} name={owner.name} color={owner.color} url={owner.avatarUrl} size={40} />
        <span>
          <b>{owner.name}</b>
          <small>{listTime(story.created_at)}</small>
        </span>
        <span className="spacer" />
        <IconButton icon={paused ? 'play' : 'pause'} label={paused ? 'Play' : 'Pause'} onClick={() => setPaused((p) => !p)} />
        {mine && <IconButton icon="trash" label="Delete status" onClick={remove} />}
        <IconButton icon="x" label="Close" onClick={onClose} />
      </header>
      <div className="story-stage" style={{ background: story.type === 'text' ? safeColor(story.bgGradient, '#1E293B') : '#000' }}>
        <button type="button" className="story-nav left" onClick={prev} aria-label="Previous" />
        {image ? <img src={image} alt={story.caption || 'Status'} referrerPolicy="no-referrer" /> : <p className="story-text">{story.caption}</p>}
        {image && story.caption && <p className="story-caption">{story.caption}</p>}
        <button type="button" className="story-nav right" onClick={next} aria-label="Next" />
      </div>
      {mine && (
        <footer className="story-foot">
          <Icon name="eye" size={16} /> {story.viewsCount || 0} {story.viewsCount === 1 ? 'view' : 'views'}
        </footer>
      )}
    </div>
  );
}

function NewTextStatus({ onClose, onPosted }) {
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BG_PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const res = await api.postStatus({ type: 'text', caption: text.trim(), bg_gradient: bg });
    setBusy(false);
    if (!res.ok) return toast(res.error, 'error');
    onPosted();
    onClose();
  };
  return (
    <Modal title="Text status" onClose={onClose} width={440}>
      <div className="status-compose" style={{ background: bg }}>
        <textarea value={text} maxLength={700} placeholder="Type a status" onChange={(e) => setText(e.target.value)} autoFocus />
      </div>
      <div className="swatches">
        {BG_PALETTE.map((c) => (
          <button key={c} type="button" aria-label={c} className={`swatch${c === bg ? ' on' : ''}`} style={{ background: c }} onClick={() => setBg(c)} />
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!text.trim() || busy} onClick={post}>
          {busy ? <Spinner size={16} /> : 'Post'}
        </button>
      </div>
    </Modal>
  );
}

export default function StatusPanel({ onClose }) {
  const me = useStore((s) => s.me);
  const version = useStore((s) => s.statusVersion);
  const [feed, setFeed] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [writing, setWriting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [seen, setSeen] = useState(() => new Set());
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    const res = await api.getStatusFeed();
    setFeed(res.ok ? res.data : { my_statuses: [], contact_statuses: [], error: res.error });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)load the feed
    load();
  }, [load, version]);

  const postPhoto = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadPhoto(await preparePhoto(file));
      const res = await api.postStatus({ type: 'image', media_url: url });
      if (!res.ok) throw new Error(res.error);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
    setUploading(false);
  };

  const mine = feed?.my_statuses || [];
  const myOwner = { id: me.id, name: 'My status', color: me.avatar_color, avatarUrl: me.avatar_url };

  return (
    <div className="side-panel">
      <PanelHeader title="Status" onBack={onClose}>
        <IconButton icon="type" label="Text status" onClick={() => setWriting(true)} />
        <IconButton icon="image" label="Photo status" onClick={() => fileRef.current?.click()} />
      </PanelHeader>
      <input ref={fileRef} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => {
        postPhoto(e.target.files?.[0]);
        e.target.value = '';
      }} />
      <div className="status-list">
        <button
          type="button"
          className="person-row"
          onClick={() => (mine.length ? setViewing({ owner: myOwner, stories: [...mine].reverse(), mine: true }) : setWriting(true))}
        >
          <span className={`status-ring${mine.length ? ' mine' : ''}`}>
            <Avatar id={me.id} name={me.username} color={me.avatar_color} url={me.avatar_url} size={44} />
          </span>
          <span className="person-text">
            <span className="person-name">My status</span>
            <span className="person-sub">{uploading ? 'Posting…' : mine.length ? `${mine.length} update${mine.length > 1 ? 's' : ''} · ${listTime(mine[0].created_at)}` : 'Add a status update'}</span>
          </span>
        </button>
        <h4 className="pad muted small">Recent updates</h4>
        {!feed ? (
          <div className="list-empty">
            <Spinner />
          </div>
        ) : !feed.contact_statuses.length ? (
          <p className="picker-note">{feed.error || 'No updates from your contacts yet.'}</p>
        ) : (
          feed.contact_statuses.map((c) => (
            <button
              type="button"
              key={c.contactId}
              className="person-row"
              onClick={() => {
                setSeen((s) => new Set(s).add(c.contactId));
                setViewing({
                  owner: { id: c.contactId, name: c.userName, color: c.avatarColor, avatarUrl: c.avatarUrl },
                  stories: [...c.stories].reverse(),
                  mine: false,
                });
              }}
            >
              <span className={`status-ring${seen.has(c.contactId) ? ' seen' : ''}`}>
                <Avatar id={c.contactId} name={c.userName} color={c.avatarColor} url={c.avatarUrl} size={44} />
              </span>
              <span className="person-text">
                <span className="person-name">{c.userName}</span>
                <span className="person-sub">{listTime(c.stories[0]?.created_at)}</span>
              </span>
            </button>
          ))
        )}
        <p className="muted small pad center">
          <Icon name="clock" size={12} /> Status updates disappear after 24 hours.
        </p>
      </div>
      {viewing && <StoryViewer {...viewing} onClose={() => setViewing(null)} onDeleted={load} />}
      {writing && <NewTextStatus onClose={() => setWriting(false)} onPosted={load} />}
    </div>
  );
}
