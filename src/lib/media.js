/** Photos and voice notes: resized / recorded in the browser, then uploaded like the phone does. */
import * as api from './api';
import { API_BASE, MAX_UPLOAD_BYTES } from './config';
import { formatDuration } from './format';

// Stored in messages as full URLs, like the phone app does after uploading
const absolute = (path) => (String(path || '').startsWith('/') ? `${API_BASE}${path}` : path);

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_SIDE = 1600;

const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Checks and shrinks a picked photo (max 1600 px, JPEG). GIFs are sent as they are. */
export async function preparePhoto(file) {
  if (!file || !IMAGE_TYPES.includes(file.type)) throw new Error('Choose a JPG, PNG, GIF or WebP photo.');
  if (file.size > MAX_UPLOAD_BYTES * 2) throw new Error('That photo is too large (max 10 MB).');
  if (file.type === 'image/gif') {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('That GIF is too large (max 10 MB).');
    return { dataUrl: await readAsDataUrl(file), ext: 'gif', preview: URL.createObjectURL(file) };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d');
  g.fillStyle = '#FFFFFF'; // transparent PNGs get a white background, not black
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Couldn’t read that photo.');
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That photo is too large (max 10 MB).');
  return { dataUrl: await readAsDataUrl(blob), ext: 'jpg', preview: URL.createObjectURL(blob) };
}

export async function uploadPhoto(prepared) {
  const res = await api.uploadImage(prepared.dataUrl, prepared.ext);
  if (!res.ok) throw new Error(res.error);
  return absolute(res.data.media_url || res.data.url);
}

/* ---------------- voice notes ---------------- */

// The phone plays AAC (.m4a). Only offer recording where the browser can produce that.
const AUDIO_TYPE = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac'].find(
  (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t),
);
export const canRecordVoice = () => !!AUDIO_TYPE && !!navigator.mediaDevices?.getUserMedia;

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream, { mimeType: AUDIO_TYPE });
  const chunks = [];
  const startedAt = Date.now();
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(250);
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  return {
    startedAt,
    cancel() {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      stopTracks();
    },
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stopTracks();
          const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          resolve({ blob: new Blob(chunks, { type: AUDIO_TYPE }), seconds });
        };
        recorder.stop();
      }),
  };
}

export async function uploadVoice({ blob, seconds }) {
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That voice message is too long.');
  const res = await api.uploadAudio(await readAsDataUrl(blob), seconds);
  if (!res.ok) throw new Error(res.error);
  return { media_url: absolute(res.data.media_url || res.data.url), duration: formatDuration(seconds), seconds };
}
