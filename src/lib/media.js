/** Photos and voice notes: resized / recorded in the browser, then uploaded like the phone does. */
import * as api from './api';
import { API_BASE, MAX_UPLOAD_BYTES } from './config';
import { formatDuration } from './format';

// Stored in messages as full URLs, like the phone app does after uploading
const absolute = (path) => (String(path || '').startsWith('/') ? `${API_BASE}${path}` : path);

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
// 1280 px at 0.72: sharp on any screen and about 150-250 KB, so photos still go through on a
// slow connection (same size as the phone app sends)
const MAX_SIDE = 1280;
const JPEG_QUALITY = 0.72;

const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Checks and shrinks a picked photo (max 1280 px, JPEG). GIFs are sent as they are. */
export async function preparePhoto(file) {
  if (!file || !IMAGE_TYPES.includes(file.type)) throw new Error('Choose a JPG, PNG, GIF or WebP photo.');
  if (file.size > MAX_UPLOAD_BYTES * 2) throw new Error('That photo is too large (max 10 MB).');
  if (file.type === 'image/gif') {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('That GIF is too large (max 10 MB).');
    return { blob: file, ext: 'gif', preview: URL.createObjectURL(file) };
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
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Couldn’t read that photo.');
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That photo is too large (max 10 MB).');
  return { blob, ext: 'jpg', preview: URL.createObjectURL(blob) };
}

// Answers that mean "this won't work no matter how often it's tried": stop and say why
const FINAL = new Set([401, 413, 429]);

/**
 * Sends the file itself (a third smaller than base64). A dropped connection is tried once more;
 * if the server won't take a file (an older server), the base64 form is sent instead.
 */
async function uploadBlob(blob, sendFile, sendBase64) {
  let res = await sendFile();
  if (!res.ok && res.status === 0) res = await sendFile(); // network blip / timeout: once more
  if (!res.ok && res.status !== 0 && !FINAL.has(res.status) && res.status < 500) {
    res = await sendBase64(await readAsDataUrl(blob));
  }
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

export async function uploadPhoto(prepared) {
  const data = await uploadBlob(
    prepared.blob,
    () => api.uploadImageFile(prepared.blob, prepared.ext),
    (dataUrl) => api.uploadImage(dataUrl, prepared.ext),
  );
  return absolute(data.media_url || data.url);
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
  const data = await uploadBlob(
    blob,
    () => api.uploadAudioFile(blob, seconds),
    (dataUrl) => api.uploadAudio(dataUrl, seconds),
  );
  return { media_url: absolute(data.media_url || data.url), duration: formatDuration(seconds), seconds };
}
