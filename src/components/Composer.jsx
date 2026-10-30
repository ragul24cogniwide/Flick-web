import { useEffect, useRef, useState } from 'react';
import { MAX_MESSAGE_CHARS } from '../lib/config';
import { formatDuration, previewText } from '../lib/format';
import { EMOJI } from '../lib/emoji';
import { canRecordVoice, preparePhoto, startRecording, uploadPhoto, uploadVoice } from '../lib/media';
import { getUi } from '../lib/notify';
import { socket } from '../lib/socket';
import { editMessage, sendMessage, toast } from '../lib/store';
import Icon from './Icon';
import { IconButton, Modal, Spinner } from './ui';

// Unsent text per chat; kept when the chat is closed and opened again
const drafts = new Map();


function EmojiPicker({ onPick, onClose }) {
  const [tab, setTab] = useState('Smileys');
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && !e.target.closest('.emoji-toggle') && onClose();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="emoji-picker" ref={ref}>
      <div className="emoji-tabs">
        {Object.keys(EMOJI).map((k) => (
          <button key={k} type="button" className={k === tab ? 'on' : ''} onClick={() => setTab(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {EMOJI[tab].split(' ').map((e) => (
          <button key={e} type="button" onClick={() => onPick(e)} aria-label={e}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

function PhotoSend({ prepared, onCancel, onSend }) {
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    await onSend(caption.trim());
    setBusy(false);
  };
  return (
    <Modal title="Send photo" onClose={busy ? undefined : onCancel} width={520} className="photo-modal">
      <div className="photo-preview">
        <img src={prepared.preview} alt="Selected" />
      </div>
      <input
        className="text-input"
        placeholder="Add a caption"
        value={caption}
        maxLength={1000}
        onChange={(e) => setCaption(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !busy && send()}
      />
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={send} disabled={busy}>
          {busy ? <Spinner size={16} /> : 'Send'}
        </button>
      </div>
    </Modal>
  );
}

export default function Composer({ chat, replyTo, editing, onClearReply, onClearEdit, disabled }) {
  const [text, setText] = useState(() => drafts.get(chat.id) || ''); // ChatPane is re-created per chat
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [recording, setRecording] = useState(null);
  const [recSeconds, setRecSeconds] = useState(0);
  const [sendingVoice, setSendingVoice] = useState(false);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const typingTimer = useRef(null);
  const chatId = chat.id;

  useEffect(() => {
    inputRef.current?.focus();
    return () => socket.typing(chatId, false);
  }, [chatId]);

  useEffect(() => {
    if (editing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load the message being edited
      setText(editing.text);
      inputRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Grow the box with its content (up to ~6 lines)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  useEffect(() => {
    if (!recording) return undefined;
    const t = setInterval(() => setRecSeconds(Math.round((Date.now() - recording.startedAt) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);

  const change = (value) => {
    setText(value);
    if (!editing) drafts.set(chatId, value);
    if (editing || chat.isAgent) return;
    if (value.trim()) {
      socket.typing(chatId, true);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => socket.typing(chatId, false), 3000);
    } else {
      socket.typing(chatId, false);
    }
  };

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    if (editing) {
      if (value !== editing.text && !(await editMessage(chatId, editing.id, value))) return;
      setText(drafts.get(chatId) || '');
      onClearEdit();
      return;
    }
    const reply = replyTo
      ? { id: replyTo.id, sender: replyTo.mine ? 'You' : replyTo.senderName || chat.name, text: previewText(replyTo).slice(0, 300) }
      : null;
    sendMessage(chatId, value, { replyTo: reply });
    drafts.delete(chatId);
    setText('');
    onClearReply();
    clearTimeout(typingTimer.current);
    socket.typing(chatId, false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && getUi().enterToSend) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && (editing || replyTo)) {
      e.stopPropagation(); // cancels the edit / reply; a second Esc closes the chat
      if (editing) {
        setText(drafts.get(chatId) || '');
        onClearEdit();
      } else onClearReply();
    }
  };

  const insertEmoji = (emoji) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    change(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const pickFile = async (file) => {
    if (!file) return;
    try {
      setPhoto(await preparePhoto(file));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const sendPhoto = async (caption) => {
    try {
      const url = await uploadPhoto(photo);
      sendMessage(chatId, caption || '📷 Photo', { metadata: { type: 'image', media_url: url, caption } });
      URL.revokeObjectURL(photo.preview);
      setPhoto(null);
    } catch (e) {
      toast(e.message || 'Couldn’t send the photo', 'error');
    }
  };

  // Paste a screenshot straight into the chat
  const onPaste = (e) => {
    const file = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      pickFile(file);
    }
  };

  const startVoice = async () => {
    try {
      const rec = await startRecording();
      setRecSeconds(0);
      setRecording(rec);
    } catch {
      toast('Allow the microphone in your browser to record voice messages.', 'error');
    }
  };

  const finishVoice = async (send) => {
    const rec = recording;
    setRecording(null);
    if (!rec) return;
    if (!send) {
      rec.cancel();
      return;
    }
    setSendingVoice(true);
    try {
      const result = await rec.stop();
      if (result.seconds < 1) return;
      const uploaded = await uploadVoice(result);
      sendMessage(chatId, `🎙️ Voice message (${uploaded.duration})`, { metadata: { type: 'audio', ...uploaded } });
    } catch (e) {
      toast(e.message || 'Couldn’t send the voice message', 'error');
    } finally {
      setSendingVoice(false);
    }
  };

  if (disabled) {
    return <div className="composer-disabled">{disabled}</div>;
  }

  const bar = editing || replyTo;
  return (
    <div className="composer-wrap">
      {bar && (
        <div className="composer-bar">
          <div className="composer-bar-body">
            <span className="composer-bar-title">
              {editing ? 'Edit message' : `Replying to ${replyTo.mine ? 'yourself' : replyTo.senderName || chat.name}`}
            </span>
            <span className="composer-bar-text">{previewText(editing || replyTo)}</span>
          </div>
          <IconButton
            icon="x"
            label="Cancel"
            onClick={() => {
              if (editing) {
                setText(drafts.get(chatId) || '');
                onClearEdit();
              } else onClearReply();
            }}
          />
        </div>
      )}
      {emojiOpen && <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />}
      <div className="composer">
        {recording ? (
          <>
            <IconButton icon="trash" label="Discard recording" onClick={() => finishVoice(false)} />
            <div className="recording">
              <span className="rec-dot" /> Recording {formatDuration(recSeconds)}
            </div>
            <button type="button" className="send-btn" onClick={() => finishVoice(true)} aria-label="Send voice message">
              <Icon name="send" size={20} />
            </button>
          </>
        ) : (
          <>
            <IconButton icon="smile" label="Emoji" className="emoji-toggle" active={emojiOpen} onClick={() => setEmojiOpen((v) => !v)} />
            {!editing && !chat.isAgent && <IconButton icon="paperclip" label="Attach a photo" onClick={() => fileRef.current?.click()} />}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              hidden
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <textarea
              ref={inputRef}
              className="composer-input"
              rows={1}
              placeholder={chat.isAgent ? 'Ask your AI agent…' : 'Type a message'}
              value={text}
              maxLength={MAX_MESSAGE_CHARS}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              aria-label="Message"
            />
            {text.trim() || editing || !canRecordVoice() || chat.isAgent ? (
              <button type="button" className="send-btn" onClick={submit} disabled={!text.trim()} aria-label={editing ? 'Save' : 'Send'}>
                <Icon name={editing ? 'check' : 'send'} size={20} />
              </button>
            ) : (
              <button type="button" className="send-btn" onClick={startVoice} disabled={sendingVoice} aria-label="Record a voice message">
                {sendingVoice ? <Spinner size={18} /> : <Icon name="mic" size={20} />}
              </button>
            )}
          </>
        )}
      </div>
      {photo && (
        <PhotoSend
          prepared={photo}
          onSend={sendPhoto}
          onCancel={() => {
            URL.revokeObjectURL(photo.preview);
            setPhoto(null);
          }}
        />
      )}
    </div>
  );
}
