import { useEffect, useMemo, useState } from 'react';
import * as api from './api';
import { useStore } from './store';

/**
 * People you can chat with: your phone contacts who are on Flick (the phone app reports which
 * accounts they are, with their Flick names) plus everyone you already have a chat with.
 */
export const usePeople = () => {
  const chats = useStore((s) => s.chats);
  const [contacts, setContacts] = useState(null); // null while loading
  useEffect(() => {
    let alive = true;
    api.contactsOnFlick().then((res) => {
      if (alive) setContacts(res.ok && Array.isArray(res.data) ? res.data : []);
    });
    return () => {
      alive = false;
    };
  }, []);
  const people = useMemo(() => {
    const byId = new Map();
    (contacts || []).forEach((c) => byId.set(c.id, { ...c, phone: c.phone_number }));
    Object.values(chats)
      .filter((c) => !c.is_group && !c.isAgent)
      .forEach((c) => byId.set(c.id, { ...byId.get(c.id), ...c }));
    return [...byId.values()];
  }, [chats, contacts]);
  return { people, loading: contacts === null, noContacts: contacts !== null && contacts.length === 0 };
};
