import { useEffect, useRef, useState } from 'react';
import { initialsOf, mediaUrl, memberColor, safeColor } from '../lib/format';
import { dismissToast, setState, useStore } from '../lib/store';
import Icon from './Icon';

/* ---------------- avatar ---------------- */

export function Avatar({ name, color, url, size = 48, id, group, online, ring }) {
  const [broken, setBroken] = useState(false);
  const src = !broken ? mediaUrl(url) : null;
  const bg = safeColor(color, id ? memberColor(id) : '#3B82F6');
  return (
    <span className={`avatar${ring ? ' avatar-ring' : ''}`} style={{ width: size, height: size, background: src ? undefined : bg }}>
      {src ? (
        <img src={src} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" draggable={false} />
      ) : (
        <span className="avatar-initials" style={{ fontSize: Math.max(10, size * 0.38) }}>
          {initialsOf(name)}
        </span>
      )}
      {group && size >= 40 && (
        <span className="avatar-badge" aria-hidden>
          <Icon name="users" size={11} stroke={2.5} />
        </span>
      )}
      {online && <span className="avatar-online" aria-label="Online" />}
    </span>
  );
}

/** Overlapping avatars of everyone typing (up to 3, then "+N"). */
export function TypingAvatars({ typers, size = 22 }) {
  if (!typers?.length) return null;
  const shown = typers.slice(0, 3);
  const extra = typers.length - shown.length;
  return (
    <span className="typing-avatars">
      {shown.map((t, i) => (
        // first typer on top, like the phone app
        <span key={t.id} className="typing-avatar" style={{ zIndex: 10 - i }}>
          <Avatar id={t.id} name={t.name} url={t.avatar_url} color={memberColor(t.id)} size={size} ring />
        </span>
      ))}
      {extra > 0 && (
        <span className="avatar avatar-ring typing-extra" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

export const TypingDots = () => (
  <span className="typing-dots" aria-hidden>
    <i />
    <i />
    <i />
  </span>
);

/* ---------------- buttons / spinner ---------------- */

export function IconButton({ icon, label, onClick, active, className = '', size = 20, disabled, ...rest }) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? ' active' : ''} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export const Spinner = ({ size = 22 }) => <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;

/* ---------------- dropdown menu ---------------- */

export function Menu({ items, onClose, align = 'right', anchor }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !anchor?.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchor]);
  return (
    <div className={`menu menu-${align}`} ref={ref} role="menu">
      {items.filter(Boolean).map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={`menu-item${it.danger ? ' danger' : ''}`}
          onClick={() => {
            onClose();
            it.onClick();
          }}
        >
          {it.icon && <Icon name={it.icon} size={17} />}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- modal + confirm dialog ---------------- */

export function Modal({ title, onClose, children, width = 420, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector('input, textarea, button.primary, button');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${className}`} style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        {title && <h2 className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function DialogHost() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  const close = () => setState({ dialog: null });
  return (
    <Modal title={dialog.title} onClose={close} width={400}>
      {dialog.body && <p className="modal-body">{dialog.body}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={close}>
          {dialog.cancelLabel}
        </button>
        {dialog.buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            className={`btn ${b.danger ? 'danger' : 'primary'}`}
            onClick={() => {
              close();
              b.onClick();
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------------- toasts ---------------- */

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast(t.id);
                t.action.onClick();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- side panel shell ---------------- */

export function PanelHeader({ title, onBack, children }) {
  return (
    <header className="panel-header">
      <IconButton icon="back" label="Back" onClick={onBack} />
      <h2>{title}</h2>
      {children}
    </header>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`toggle-row${disabled ? ' disabled' : ''}`}>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle" aria-hidden />
    </label>
  );
}
