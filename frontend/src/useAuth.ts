import { useEffect, useState } from 'react';
import { auth } from './api';

/** Hook đồng bộ trạng thái đăng nhập với store auth. */
export function useAuth() {
  const [, force] = useState(0);
  useEffect(() => {
    const unsub = auth.subscribe(() => force(n => n + 1));
    return () => { unsub(); };
  }, []);
  return { loggedIn: auth.loggedIn, user: auth.user };
}
