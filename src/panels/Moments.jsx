/**
 * Moments: our shared scrapbook, same as the phone app's Moments tab.
 *   On this day / latest photo, Our story (milestones kept on the server), and shared photos
 *   from our chat (load more goes further back in the chat).
 */
import { useEffect, useMemo, useState } from 'react';
import { formatDay, isoDay, partnerChatId, partnerChatIn, partnerFirstName, updateCouple, useCouple } from '../lib/couple';
import { mediaUrl } from '../lib/format';
import { loadHistory, loadOlder, openChat, useStore } from '../lib/store';
import Icon from '../components/Icon';
import { IconButton, Modal, PanelHeader, Spinner } from '../components/ui';

const DOTS = ['#E11D48', '#B45309', '#7C3AED', '#0F766E', '#BE185D'];

export default function MomentsPanel({ onClose, onStatus }) {
  const couple = useCouple();
  const paired = couple?.status === 'paired';
  const chatId = useStore((s) => (paired ? partnerChatIn(s.chats, couple) : null));
  const [viewer, setViewer] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (paired && !chatId) partnerChatId(couple);
  }, [paired, chatId, couple]);
  const box = useStore((s) => (chatId ? s.messages[chatId] : null));
  useEffect(() => {
    if (chatId && (!box || (!box.loaded && !box.loading))) loadHistory(chatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const photos = useMemo(
    () =>
      (box?.list || [])
        .filter((m) => m.metadata?.type === 'image' && !m.metadata?.is_flash && !m.metadata?.view_once)
        .map((m) => ({ id: m.id, src: mediaUrl(m.metadata.media_url || m.metadata.uri), ts: m.ts, caption: m.metadata.caption || '' }))
        .filter((p) => p.src)
        .sort((a, b) => b.ts - a.ts),
    [box]
  );

  const memory = useMemo(() => {
    const now = new Date();
    const same = photos.find((p) => {
      const d = new Date(p.ts);
      return d.getMonth() === now.getMonth() && d.getDate() === now.getDate() && d.getFullYear() < now.getFullYear();
    });
    if (same) {
      const years = now.getFullYear() - new Date(same.ts).getFullYear();
      return { ...same, label: `On this day · ${years} ${years === 1 ? 'year' : 'years'} ago` };
    }
    return photos[0] ? { ...photos[0], label: 'Our latest photo' } : null;
  }, [photos]);

  const story = useMemo(() => {
    if (!paired) return [];
    const items = (couple.milestones || []).map((m) => ({ ...m, editable: true }));
    if (couple.anniversary) items.push({ id: '_first', title: 'Our first day', date: couple.anniversary });
    if (couple.paired_at) items.push({ id: '_paired', title: 'Paired on Flick', date: couple.paired_at.slice(0, 10) });
    return items.sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
  }, [paired, couple]);

  const more = async () => {
    setLoadingMore(true);
    await loadOlder(chatId);
    setLoadingMore(false);
  };

  return (
    <div className="side-panel moments-panel">
      <PanelHeader title="Moments" onBack={onClose}>
        <IconButton icon="status" label="Status updates" onClick={onStatus} />
        {paired && <IconButton icon="plus" label="Add to our story" onClick={() => setEditing({ id: null, title: '', date: '', note: '' })} />}
      </PanelHeader>
      <div className="us-scroll">
        {!couple ? (
          <div className="us-loading">
            <Spinner />
          </div>
        ) : !paired ? (
          <section className="us-card raised center">
            <span className="big-emoji">📸</span>
            <h3>Your story starts here</h3>
            <p className="us-hint">Pair with your person on Us. Your photos and milestones gather here.</p>
          </section>
        ) : (
          <>
            <section className="us-card raised memory">
              {memory ? (
                <button type="button" className="memory-photo" onClick={() => setViewer(memory)} aria-label={memory.label}>
                  <img src={memory.src} alt={memory.caption || 'Photo'} referrerPolicy="no-referrer" />
                  <span className="memory-badge">{memory.label}</span>
                </button>
              ) : (
                <div className="memory-empty">
                  <span className="big-emoji">💌</span>
                  <p className="us-hint">Share a photo in your chat and it will live here.</p>
                </div>
              )}
              <div className="memory-foot">
                <span className="hand">{memory?.caption || (memory ? formatDay(isoDay(new Date(memory.ts))) : 'Our memories')}</span>
                <button type="button" className="heart-btn" onClick={() => chatId && openChat(chatId)} aria-label={`Open chat with ${partnerFirstName(couple)}`}>
                  ♥
                </button>
              </div>
            </section>

            <h3 className="us-section">Our story</h3>
            {story.length === 0 ? (
              <p className="us-hint">Add your first date, first trip or the day you said “I love you”.</p>
            ) : (
              <ol className="timeline">
                {story.map((m, i) => (
                  <li key={m.id}>
                    <span className="tl-dot" style={{ background: DOTS[i % DOTS.length] }} />
                    <button type="button" className="tl-body" disabled={!m.editable} onClick={() => setEditing(m)}>
                      <b>{m.title}</b>
                      <small>{[m.date ? formatDay(m.date) : null, m.note].filter(Boolean).join(' · ')}</small>
                    </button>
                  </li>
                ))}
              </ol>
            )}

            <h3 className="us-section">Shared photos</h3>
            {photos.length === 0 ? (
              <p className="us-hint">Photos you send each other show up here.</p>
            ) : (
              <div className="photo-grid">
                {photos.map((p) => (
                  <button key={p.id} type="button" onClick={() => setViewer(p)} aria-label={p.caption || 'Photo'}>
                    <img src={p.src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  </button>
                ))}
              </div>
            )}
            {box?.hasMore && (
              <button type="button" className="btn ghost wide" onClick={more} disabled={loadingMore}>
                {loadingMore ? <Spinner size={16} /> : (
                  <>
                    <Icon name="arrowDown" size={16} /> Look further back
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {viewer && (
        <Modal onClose={() => setViewer(null)} width={900} className="photo-modal">
          <img src={viewer.src} alt={viewer.caption || 'Photo'} referrerPolicy="no-referrer" />
          {viewer.caption && <p className="hand">{viewer.caption}</p>}
        </Modal>
      )}
      {editing && <MilestoneModal milestone={editing} couple={couple} onClose={() => setEditing(null)} />}
    </div>
  );
}

function MilestoneModal({ milestone, couple, onClose }) {
  const [title, setTitle] = useState(milestone.title || '');
  const [date, setDate] = useState(milestone.date || '');
  const [note, setNote] = useState(milestone.note || '');
  const [error, setError] = useState('');
  const save = async (remove = false) => {
    const list = (couple.milestones || []).filter((m) => m.id !== milestone.id);
    if (!remove) list.push({ id: milestone.id || `m${Date.now().toString(36)}`, title: title.trim(), date: date || null, note: note.trim() || null });
    const res = await updateCouple({ milestones: list });
    if (!res.ok) setError(res.error);
    else onClose();
  };
  return (
    <Modal title={milestone.id ? 'Edit moment' : 'Add to our story'} onClose={onClose}>
      <form
        className="us-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save(false);
        }}
      >
        <label>
          What happened?
          <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="First date, first trip…" maxLength={80} />
        </label>
        <label>
          When?
          <input className="text-input" type="date" value={date} max={isoDay()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          A little note <small>(optional)</small>
          <input className="text-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Marina beach, cold coffee…" maxLength={120} />
        </label>
        {error && <p className="us-error">{error}</p>}
        <div className="modal-actions">
          {milestone.id && (
            <button type="button" className="btn ghost danger-text" onClick={() => save(true)}>
              Remove
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
