// Same backend as the phone app. Override for local testing with VITE_FLICK_API (see README).
const DEFAULT_API = 'https://pocket-backend-7lmx.onrender.com';

export const API_BASE = String(import.meta.env.VITE_FLICK_API || DEFAULT_API).replace(/\/+$/, '');
export const WS_BASE = API_BASE.replace(/^http/, 'ws');

export const AGENT_ID = 'ai_assistant';
export const BRAND = '#FFB800';

export const MAX_MESSAGE_CHARS = 8000;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const HISTORY_PAGE = 50;
