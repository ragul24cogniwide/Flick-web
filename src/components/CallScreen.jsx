import { useEffect, useRef, useState } from 'react';
import { acceptCall, declineCall, hangUp, toggleCamera, toggleMute } from '../lib/calls';
import { formatDuration } from '../lib/format';
import { useStore } from '../lib/store';
import Icon from './Icon';
import { Avatar } from './ui';

function Video({ stream, muted, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function RemoteAudio({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream || null;
      ref.current.play?.().catch(() => {});
    }
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function Timer({ startedAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{formatDuration((now - startedAt) / 1000)}</span>;
}

export default function CallScreen() {
  const call = useStore((s) => s.call);
  if (!call) return null;

  const { phase, video, name, color, avatarUrl, peerId, localStream, remoteStream, muted, cameraOff, remoteCameraOff, label } = call;
  const showRemoteVideo = video && remoteStream && phase === 'active' && !remoteCameraOff;

  if (phase === 'incoming') {
    return (
      <div className="call-incoming" role="alertdialog" aria-label={`Incoming call from ${name}`}>
        <Avatar id={peerId} name={name} color={color} url={avatarUrl} size={64} />
        <div className="call-incoming-text">
          <b>{name}</b>
          <span>
            <Icon name={video ? 'video' : 'phone'} size={14} /> {label}
          </span>
        </div>
        <button type="button" className="call-btn decline" onClick={declineCall} aria-label="Decline">
          <Icon name="phoneOff" size={22} />
        </button>
        <button type="button" className="call-btn accept" onClick={acceptCall} aria-label="Accept">
          <Icon name={video ? 'video' : 'phone'} size={22} />
        </button>
      </div>
    );
  }

  return (
    <div className={`call-screen${showRemoteVideo ? ' has-video' : ''}`} role="dialog" aria-label={`Call with ${name}`}>
      <RemoteAudio stream={remoteStream} />
      {showRemoteVideo && <Video stream={remoteStream} muted className="call-remote" />}
      {!showRemoteVideo && (
        <div className="call-center">
          <Avatar id={peerId} name={name} color={color} url={avatarUrl} size={128} />
          <h2>{name}</h2>
          <p>
            {phase === 'active' && !label ? <Timer startedAt={call.startedAt} /> : label}
            {phase === 'active' && remoteCameraOff && video && <span className="muted"> · camera off</span>}
          </p>
        </div>
      )}
      {showRemoteVideo && (
        <div className="call-top">
          <b>{name}</b> {label || (call.startedAt ? <Timer startedAt={call.startedAt} /> : null)}
        </div>
      )}
      {video && localStream && !cameraOff && <Video stream={localStream} muted className="call-local" />}
      <div className="call-controls">
        <button type="button" className={`call-ctrl${muted ? ' on' : ''}`} onClick={toggleMute} disabled={phase === 'ended'} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}>
          <Icon name={muted ? 'micOff' : 'mic'} size={22} />
        </button>
        {video && (
          <button type="button" className={`call-ctrl${cameraOff ? ' on' : ''}`} onClick={toggleCamera} disabled={phase === 'ended'} aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'} title={cameraOff ? 'Turn camera on' : 'Turn camera off'}>
            <Icon name={cameraOff ? 'videoOff' : 'video'} size={22} />
          </button>
        )}
        <button type="button" className="call-btn decline" onClick={() => hangUp()} disabled={phase === 'ended'} aria-label="End call" title="End call">
          <Icon name="phoneOff" size={24} />
        </button>
      </div>
      <p className="call-lock">
        <Icon name="lock" size={12} /> End-to-end encrypted
      </p>
    </div>
  );
}
