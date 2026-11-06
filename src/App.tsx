/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import ApplyPage from './pages/ApplyPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  const [currentPath, setCurrentPath] = useState(() => {
    return window.location.pathname.startsWith('/admin') ? '/admin' : '/';
  });

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname.startsWith('/admin') ? '/admin' : '/');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path.startsWith('/admin') ? '/admin' : '/');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {currentPath === '/admin' ? (
        <AdminPage onNavigateToApply={() => navigateTo('/')} />
      ) : (
        <ApplyPage onNavigateToAdmin={() => navigateTo('/admin')} />
      )}
    </>
  );
}
