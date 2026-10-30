import { useCallback, useEffect, useRef, useState } from 'react';
import { pollLink, startLink } from '../lib/api';
import { saveSession } from '../lib/session';
import Icon from './Icon';
import { Spinner } from './ui';

const POLL_MS = 2000;

/**
 * Linking this browser: shows a one-time code that you type on your phone
 * (⋮ → Linked devices → Link a device). A new code is fetched when it expires.
 */
export default function LinkScreen() {
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [persist, setPersist] = useState(true);
  const [copied, setCopied] = useState(false);
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  const fetchCode = useCallback(async () => {
    setError('');
    setLink(null);
    const res = await startLink();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLink({ ...res.data, expiresAt: Date.now() + res.data.expires_in * 1000 });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the first code on mount
    fetchCode();
  }, [fetchCode]);

  // Countdown, then a fresh code
  useEffect(() => {
    if (!link) return undefined;
    const tick = () => {
      const left = Math.max(0, Math.round((link.expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) fetchCode();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [link, fetchCode]);

  // Wait for the phone to approve
  useEffect(() => {
    if (!link) return undefined;
    let stopped = false;
    let timer;
    const poll = async () => {
      const res = await pollLink(link.link_id, link.poll_secret);
      if (stopped) return;
      if (res.ok && res.data?.status === 'approved' && res.data.token) {
        saveSession({ token: res.data.token, user: res.data.user, persist: persistRef.current });
        return;
      }
      if (res.ok && res.data?.status === 'expired') {
        fetchCode();
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [link, fetchCode]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.code.replace('-', ''));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="link-page">
      <header className="link-top">
        <span className="brand-mark" aria-hidden>
          F
        </span>
        <span className="brand-name">Flick Web</span>
      </header>
      <main className="link-card">
        <div className="link-steps">
          <h1>Use Flick on your computer</h1>
          <ol>
            <li>
              Open <b>Flick</b> on your phone
            </li>
            <li>
              Tap <b>⋮</b> on the Chats screen, then <b>Linked devices</b>
            </li>
            <li>
              Tap <b>Link a device</b> and enter the code shown here
            </li>
          </ol>
          <label className="keep-signed">
            <input type="checkbox" checked={persist} onChange={(e) => setPersist(e.target.checked)} />
            <span>
              Keep me signed in on this browser
              <small>Untick on a shared or public computer</small>
            </span>
          </label>
        </div>
        <div className="link-code-box">
          {error ? (
            <div className="link-error">
              <Icon name="alert" size={28} />
              <p>{error}</p>
              <button type="button" className="btn primary" onClick={fetchCode}>
                Try again
              </button>
            </div>
          ) : !link ? (
            <Spinner size={36} />
          ) : (
            <>
              <p className="link-code-label">Your code</p>
              <button type="button" className="link-code" onClick={copy} title="Copy code" aria-label={`Code ${link.code}`}>
                {link.code.split('').map((ch, i) => (
                  <span key={i} className={ch === '-' ? 'sep' : ''}>
                    {ch}
                  </span>
                ))}
              </button>
              <p className="link-code-hint">
                {copied ? 'Copied' : `New code in ${secondsLeft}s`}
                <span className="waiting">
                  <Spinner size={12} /> Waiting for your phone…
                </span>
              </p>
            </>
          )}
        </div>
      </main>
      <footer className="link-foot">
        <Icon name="lock" size={14} /> Your messages stay private. Only your phone can link a browser, and you can log it out any time from
        your phone.
      </footer>
    </div>
  );
}
