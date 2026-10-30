/**
 * Voice and video calls in the browser (WebRTC), compatible with the phone app.
 *
 * Audio / video go directly between the two devices, encrypted (DTLS-SRTP); the server only
 * relays the setup messages. Same protocol as the phone: the offer and answer go over HTTP,
 * network candidates over the socket (only after the server knows the call).
 *
 * State lives in the app store as `call`:
 *   { phase: 'incoming' | 'outgoing' | 'connecting' | 'active' | 'ended', callId, peerId, name,
 *     color, avatarUrl, video, muted, cameraOff, remoteCameraOff, label, startedAt,
 *     localStream, remoteStream }
 */
import * as api from './api';
import { showNotification, startRing, stopRing } from './notify';
import { socket } from './socket';
import { getState, setState, toast } from './store';

const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const NO_ANSWER_MS = 45000;
const POLL_MS = 3000;

let pc = null;
let localStream = null;
let pendingRemote = []; // candidates that arrived before the other side's description
let outgoingCandidates = [];
let signalingReady = false;
let offerSdp = null;
let pollTimer = null;
let noAnswerTimer = null;
let iceCache = { servers: null, until: 0 };
let incomingNote = null;
let ending = false;

const call = () => getState().call;
const setCall = (patch) => setState((s) => (s.call ? { call: { ...s.call, ...patch } } : null));
const newCallId = () => `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function getIceServers() {
  if (iceCache.servers && Date.now() < iceCache.until) return iceCache.servers;
  const res = await api.iceServers();
  if (res.ok && res.data?.ice_servers?.length) {
    iceCache = { servers: res.data.ice_servers, until: Date.now() + Math.max(60, (res.data.ttl || 3600) - 300) * 1000 };
    return res.data.ice_servers;
  }
  return FALLBACK_ICE;
}

async function openMedia(video) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t make calls.');
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } : false,
  });
  setCall({ localStream });
  return localStream;
}

function sendCandidate(candidate) {
  const c = call();
  if (!c) return;
  socket.send({ type: 'call_ice_candidate', data: { call_id: c.callId, receiver_id: c.peerId, candidate } });
}

async function createPeer() {
  const iceServers = await getIceServers();
  pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    const cand = e.candidate.toJSON();
    if (signalingReady) sendCandidate(cand);
    else outgoingCandidates.push(cand);
  };
  pc.ontrack = (e) => {
    const stream = e.streams?.[0];
    if (stream) setCall({ remoteStream: stream });
  };
  pc.onconnectionstatechange = () => {
    const st = pc?.connectionState;
    if (st === 'connected') {
      const c = call();
      if (c && c.phase !== 'active') setCall({ phase: 'active', label: '', startedAt: Date.now() });
    } else if (st === 'disconnected') {
      setCall({ label: 'Reconnecting…' });
    } else if (st === 'failed') {
      hangUp('Connection lost');
    }
  };
  return pc;
}

function setReady() {
  signalingReady = true;
  outgoingCandidates.splice(0).forEach(sendCandidate);
}

async function addRemoteCandidate(candidate) {
  if (!candidate) return;
  if (!pc || !pc.remoteDescription) {
    pendingRemote.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch {
    /* stale candidate */
  }
}

async function flushRemote() {
  const queued = pendingRemote.splice(0);
  for (const c of queued) await addRemoteCandidate(c);
}

function cleanup() {
  stopRing();
  clearInterval(pollTimer);
  clearTimeout(noAnswerTimer);
  incomingNote?.close?.();
  incomingNote = null;
  try {
    pc?.close();
  } catch {
    /* closed */
  }
  pc = null;
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  pendingRemote = [];
  outgoingCandidates = [];
  signalingReady = false;
  offerSdp = null;
}

/** Shows the end state for a moment, then closes the call screen. */
function finish(label) {
  const c = call();
  if (!c || ending) return;
  // A call I never picked up just stops ringing: no full-screen "call ended" page over the chats
  if (c.phase === 'incoming') {
    cleanup();
    setState({ call: null });
    const kind = c.video ? 'video' : 'voice';
    const note = {
      'Missed call': `Missed ${kind} call from ${c.name}`,
      'Answered on another device': `${c.name}’s ${kind} call was answered on another device`,
    }[label]; // declining it yourself needs no note
    if (note) toast(note);
    return;
  }
  ending = true;
  cleanup();
  setCall({ phase: 'ended', label, localStream: null, remoteStream: null });
  setTimeout(() => {
    setState({ call: null });
    ending = false;
  }, 1500);
}

function peerCard(chatId) {
  const chat = getState().chats[chatId];
  return { name: chat?.name || 'Flick user', color: chat?.avatar_color, avatarUrl: chat?.avatar_url || null };
}

/* ---------------- outgoing ---------------- */

export async function startCall(chatId, video) {
  if (call()) {
    toast('You’re already in a call.');
    return;
  }
  const callId = newCallId();
  setState({
    call: { phase: 'outgoing', callId, peerId: chatId, ...peerCard(chatId), video: !!video, muted: false, cameraOff: false, label: 'Calling…', outgoing: true },
  });
  try {
    await openMedia(video);
    await createPeer();
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: !!video });
    await pc.setLocalDescription(offer);
    const res = await api.callOffer({ call_id: callId, receiver_id: chatId, video: !!video, sdp: offer.sdp });
    if (!res.ok) return finish(res.error || 'Couldn’t start the call');
    setReady();
  } catch (e) {
    return finish(mediaError(e, video));
  }
  if (!call() || call().callId !== callId) return;
  setCall({ label: 'Ringing…' });
  startRing(false);
  // Safety net if a socket message is missed
  pollTimer = setInterval(async () => {
    const c = call();
    if (!c || c.callId !== callId || c.phase === 'ended') return;
    const st = await api.callStatus(callId);
    if (!st.ok) return;
    if (st.data.status === 'answered' && st.data.sdp) applyAnswer(callId, st.data.sdp);
    else if (st.data.status === 'rejected') finish('Call declined');
    else if (st.data.status === 'ended' || st.data.status === 'unknown') finish('Call ended');
    if (st.data.status === 'answered') clearInterval(pollTimer);
  }, POLL_MS);
  noAnswerTimer = setTimeout(() => {
    const c = call();
    if (c && c.callId === callId && c.phase === 'outgoing') {
      api.callEnd({ call_id: callId, receiver_id: chatId, duration: 0 });
      finish('No answer');
    }
  }, NO_ANSWER_MS);
}

async function applyAnswer(callId, sdp) {
  const c = call();
  if (!c || c.callId !== callId || !pc || pc.remoteDescription) return;
  stopRing();
  clearTimeout(noAnswerTimer);
  setCall({ phase: 'connecting', label: 'Connecting…' });
  try {
    await pc.setRemoteDescription({ type: 'answer', sdp });
    await flushRemote();
  } catch {
    hangUp('Call failed');
  }
}

/* ---------------- incoming ---------------- */

function onOffer(data) {
  const current = call();
  if (current) {
    if (current.callId === data.call_id) return; // re-sent offer
    api.callReject({ call_id: data.call_id, receiver_id: data.caller_id, reason: 'busy' });
    return;
  }
  const chatId = data.caller_id;
  const card = peerCard(chatId);
  offerSdp = data.sdp || null;
  setState({
    call: {
      phase: 'incoming',
      callId: data.call_id,
      peerId: chatId,
      name: getState().chats[chatId]?.name || data.caller_name || card.name,
      color: card.color || data.caller_color,
      avatarUrl: card.avatarUrl || data.caller_avatar_url || null,
      video: !!data.video,
      muted: false,
      cameraOff: false,
      label: data.video ? 'Incoming video call' : 'Incoming voice call',
      outgoing: false,
    },
  });
  startRing(true);
  incomingNote = showNotification(
    data.caller_name || card.name || 'Flick',
    data.video ? '📹 Incoming video call' : '📞 Incoming voice call',
    { tag: `call-${data.call_id}`, requireInteraction: true },
  );
  // The caller may give up while this is ringing
  pollTimer = setInterval(async () => {
    const c = call();
    if (!c || c.callId !== data.call_id || c.phase !== 'incoming') return;
    const st = await api.callStatus(data.call_id);
    if (st.ok && ['ended', 'rejected', 'unknown'].includes(st.data.status)) finish('Missed call');
    else if (st.ok && !offerSdp && st.data.sdp) offerSdp = st.data.sdp;
  }, POLL_MS * 2);
}

export async function acceptCall() {
  const c = call();
  if (!c || c.phase !== 'incoming') return;
  stopRing();
  clearInterval(pollTimer);
  incomingNote?.close?.();
  setCall({ phase: 'connecting', label: 'Connecting…' });
  try {
    if (!offerSdp) {
      const st = await api.callStatus(c.callId);
      if (!st.ok || st.data.status !== 'ringing' || !st.data.sdp) return finish('Call ended');
      offerSdp = st.data.sdp;
    }
    await openMedia(c.video);
    await createPeer();
    signalingReady = true; // the server already knows this call
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await flushRemote();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const res = await api.callAnswer({ call_id: c.callId, receiver_id: c.peerId, sdp: answer.sdp });
    if (!res.ok) return finish(res.error || 'Couldn’t connect the call');
  } catch (e) {
    api.callReject({ call_id: c.callId, receiver_id: c.peerId, reason: 'declined' });
    finish(mediaError(e, c.video));
  }
}

export function declineCall() {
  const c = call();
  if (!c) return;
  api.callReject({ call_id: c.callId, receiver_id: c.peerId, reason: 'declined' });
  finish('Call declined');
}

/* ---------------- during the call ---------------- */

export function hangUp(label = 'Call ended') {
  const c = call();
  if (!c || c.phase === 'ended') return;
  if (c.phase === 'incoming') return declineCall();
  const duration = c.startedAt ? Math.round((Date.now() - c.startedAt) / 1000) : 0;
  api.callEnd({ call_id: c.callId, receiver_id: c.peerId, duration });
  finish(label);
}

export function toggleMute() {
  const c = call();
  if (!c || !localStream) return;
  const muted = !c.muted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  setCall({ muted });
  socket.send({ type: 'call_media_state', data: { call_id: c.callId, audio_enabled: !muted, video_enabled: !c.cameraOff } });
}

export function toggleCamera() {
  const c = call();
  if (!c || !localStream || !c.video) return;
  const cameraOff = !c.cameraOff;
  localStream.getVideoTracks().forEach((t) => (t.enabled = !cameraOff));
  setCall({ cameraOff });
  socket.send({ type: 'call_media_state', data: { call_id: c.callId, audio_enabled: !c.muted, video_enabled: !cameraOff } });
}

function mediaError(e, video) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return video ? 'Allow camera and microphone in your browser to call' : 'Allow the microphone in your browser to call';
  }
  if (name === 'NotFoundError') return video ? 'No camera or microphone found' : 'No microphone found';
  return e?.message && e.message.length < 80 ? e.message : 'Call failed';
}

/* ---------------- signaling frames ---------------- */

export function handleCallFrame({ type, data }) {
  if (!data?.call_id) return;
  if (type === 'call_offer') return onOffer(data);
  const c = call();
  if (!c || c.callId !== data.call_id || c.phase === 'ended') return;
  switch (type) {
    case 'call_answer':
      if (data.sdp) applyAnswer(c.callId, data.sdp);
      break;
    case 'call_ice_candidate':
      addRemoteCandidate(data.candidate);
      break;
    case 'call_media_state':
      setCall({ remoteCameraOff: data.video_enabled === false });
      break;
    case 'call_reject':
      finish(data.reason === 'busy' ? 'User busy' : 'Call declined');
      break;
    case 'call_end':
      finish(c.phase === 'incoming' ? 'Missed call' : 'Call ended');
      break;
    case 'call_claimed':
      // Picked up / declined on my phone: stop ringing here (unless this browser answered)
      if (c.phase === 'incoming') finish(data.action === 'answered' ? 'Answered on another device' : 'Call declined');
      break;
    case 'call_error':
      if (['call_offer', 'call_answer'].includes(data.frame)) finish(data.reason || 'Call failed');
      break;
    default:
  }
}

if (typeof window !== 'undefined') {
  // Closing the tab mid-call hangs up instead of leaving the other side waiting
  window.addEventListener('pagehide', () => {
    const c = call();
    if (!c || c.phase === 'ended') return;
    if (c.phase === 'incoming') api.callReject({ call_id: c.callId, receiver_id: c.peerId, reason: 'declined' }, true);
    else api.callEnd({ call_id: c.callId, receiver_id: c.peerId, duration: 0 }, true);
  });
}
