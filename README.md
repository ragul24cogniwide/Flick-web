# Flick Web

Flick in the browser, linked to your phone (like WhatsApp Web). It uses the same backend as the
phone app.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production files in dist/
npm run lint
```

By default it talks to the production backend (`https://pocket-backend-7lmx.onrender.com`). To use
another backend, for example a local one, set `VITE_FLICK_API` when you start or build:

```bash
VITE_FLICK_API=http://127.0.0.1:8000 npm run dev
```

## Linking a browser

1. Open Flick Web. It shows an 8-character code, for example `XQVS-NE5D`. A new code appears every 2 minutes.
2. On the phone, tap ⋮ on the Chats screen, then **Linked devices**, then **Link a device**, and type the code.
3. The phone shows which browser it is ("Chrome on macOS"). Tap **Link device** to approve. The browser opens your chats.

You can link up to 4 browsers. Each one can be logged out from the phone (Linked devices) or from
the browser itself (Settings → Log out). Logging out on the phone logs out every linked browser.
Browsers unused for 14 days are signed out automatically.

## What works

- **Chat list:** search, plus All / Unread / Groups filters, unread badges, online dots, and typing shown in the list.
- **Chats:**
  - grey and blue ticks, replies, edit, delete for me or for everyone
  - photos: send, paste a screenshot, or view full size
  - voice messages: play; recording works in browsers that can produce AAC, which the phone can play
  - emoji, `*bold*` / `_italic_` / `~strike~` / `` `code` ``, safe links
- **Groups:** create, rename, add or remove members, make admins, exit. Sender names and avatars, and the avatars of everyone typing.
- **Sync with the phone:**
  - messages sent on either device show on both
  - reading on one device clears the unread badge on the other
  - edits and deletes sync
- **Calls:** voice and video calls with the phone app or another browser (WebRTC, peer to peer). An incoming call rings on both the phone and the browser; answering on one stops the other.
- **Status:** view status updates, and post text or photo statuses.
- **Profile and settings:** name, about, photo, colour, light or dark theme, desktop notifications, sounds, read receipts, last seen, Enter to send.

## Security

- **Linking:**
  - Only the phone app can link a browser. A linked browser can't link more browsers, delete the account, or take over the phone's push notifications.
  - Link codes work once and expire after 2 minutes. Wrong codes are rate limited per account, and new codes are rate limited per network address.
  - The browser collects its token with a private secret that never leaves the browser, so seeing the code on screen isn't enough to take over the session.
- **Tokens:**
  - Each browser token names its own session, so revoking the session ends it at once, including its live connection.
  - The live connection opens with a one-time ticket that's valid for 30 seconds, never with the token in the URL.
  - Requests send the token in the `Authorization` header with no cookies, so cross-site request forgery doesn't apply.
- **Rendering:**
  - Message text is rendered as text. There is no HTML injection.
  - Links open with `rel="noopener noreferrer"`.
  - Media URLs are allowed only for `https:`, `http:`, `blob:` and `data:image/…`.
- **Production build:** it ships a strict Content-Security-Policy. Scripts load only from this site, and the network goes only to the Flick API.
- **Storage:** only the session token and profile are stored in the browser (localStorage, or sessionStorage when "Keep me signed in" is off). Messages are kept in memory only.

When you host `dist/`, also send these headers:

```
Content-Security-Policy: <same as the meta tag in dist/index.html>; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(self), microphone=(self), geolocation=()
```

Serve it over HTTPS. Browsers allow the camera and microphone only on HTTPS (or localhost).

## Code layout

```
src/lib/        config, api (REST), socket (live connection), store (app state),
                calls (WebRTC), media (photos / voice), notify (notifications, theme), format
src/components/ Sidebar, ChatPane, Message, Composer, CallScreen, LinkScreen, shared ui
src/panels/     New chat / group, group & contact info, profile & settings, status
```
# Flick-web
