import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import ChatPane, { EmptyPane } from './components/ChatPane';
import CallScreen from './components/CallScreen';
import LinkScreen from './components/LinkScreen';
import NavRail from './components/NavRail';
import Sidebar from './components/Sidebar';
import { DialogHost, Toasts } from './components/ui';
import * as api from './lib/api';
import { handleCallFrame, hangUp } from './lib/calls';
import { applyTheme, useUi } from './lib/notify';
import { clearSession, getSession, loadSession, onSessionChange } from './lib/session';
import { socket } from './lib/socket';
import { confirmDialog, openChat, startApp, stopApp, useStore } from './lib/store';
import CallsPanel from './panels/Calls';
import InfoPanel from './panels/InfoPanel';
import { NewChatPanel, NewGroupPanel } from './panels/NewChat';
import { ProfilePanel, SettingsPanel } from './panels/Settings';
import StatusPanel from './panels/Status';

loadSession();
const subscribeSession = (fn) => onSessionChange(fn);

function Workspace() {
  const activeId = useStore((s) => s.activeId);
  const chat = useStore((s) => (s.activeId ? s.chats[s.activeId] : null));
  const me = useStore((s) => s.me);
  const [section, setSection] = useState('chats'); // left column: chats | status | calls | settings
  const [panel, setPanel] = useState(null); // slides over it: profile | newChat | newGroup
  const [infoOpen, setInfoOpen] = useState(false);

  // Status, Calls and Settings are sections (switched from the left bar); the rest slide over
  const open = useCallback((name) => {
    if (['chats', 'status', 'calls', 'settings'].includes(name)) {
      setSection(name);
      setPanel(null);
    } else setPanel(name);
  }, []);

  useEffect(() => {
    const onOpen = (e) => openChat(e.detail);
    window.addEventListener('flick:open-chat', onOpen);
    return () => window.removeEventListener('flick:open-chat', onOpen);
  }, []);

  // Esc closes the side panel, then the info panel, then the chat
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop, .lightbox, .story, .menu, .emoji-picker, .call-screen')) return;
      if (panel) setPanel(null);
      else if (section !== 'chats') setSection('chats');
      else if (infoOpen) setInfoOpen(false);
      else if (activeId) openChat(null); // Close chat, like WhatsApp Web
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel, section, infoOpen, activeId]);

  const logout = useCallback(() => {
    confirmDialog({
      title: 'Log out of this browser?',
      body: 'Your phone stays signed in. You can link this browser again any time.',
      buttons: [
        {
          label: 'Log out',
          danger: true,
          onClick: async () => {
            hangUp();
            await api.logout();
            clearSession();
          },
        },
      ],
    });
  }, []);

  if (!me) return null;

  const close = () => setPanel(null);
  const toChats = () => setSection('chats');
  const panels = {
    profile: <ProfilePanel onClose={close} />,
    newChat: <NewChatPanel onClose={close} onNewGroup={() => setPanel('newGroup')} />,
    newGroup: <NewGroupPanel onClose={close} />,
  };
  const sections = {
    status: <StatusPanel onClose={toChats} />,
    calls: <CallsPanel onClose={toChats} />,
    settings: <SettingsPanel onClose={toChats} onLogout={logout} />,
  };

  return (
    <div className={`workspace${activeId ? ' chat-open' : ''}${infoOpen && chat ? ' info-open' : ''}`}>
      <div className="left-column">
        <NavRail section={section} onSection={open} onNewGroup={() => setPanel('newGroup')} />
        <div className="left-panels">
          <Sidebar onPanel={open} onLogout={logout} />
          {section !== 'chats' && sections[section]}
          {panel && panels[panel]}
        </div>
      </div>
      {chat ? (
        <ChatPane
          key={chat.id}
          chat={chat}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((v) => !v)}
          onBack={() => openChat(null)}
          onClose={() => {
            setInfoOpen(false);
            openChat(null);
          }}
        />
      ) : (
        <EmptyPane />
      )}
      {chat && infoOpen && <InfoPanel chat={chat} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

export default function App() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const ui = useUi();
  const token = session?.token;

  useEffect(() => applyTheme(ui.theme), [ui.theme]);

  useEffect(() => {
    const user = getSession()?.user;
    if (!token || !user?.id) return undefined;
    const offCalls = socket.on(handleCallFrame);
    startApp(user);
    return () => {
      offCalls();
      stopApp();
    };
  }, [token]);

  return (
    <>
      {session ? <Workspace /> : <LinkScreen />}
      <CallScreen />
      <DialogHost />
      <Toasts />
    </>
  );
}
