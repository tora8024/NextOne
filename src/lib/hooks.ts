import { useEffect, useState } from 'react';

const TECH_KEY = 'nextone-technician';

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · NextOne 維修台` : 'NextOne 維修台';
  }, [title]);
}

export function useTechnician(): [string, (value: string) => void] {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(TECH_KEY) || '林可恩';
    } catch {
      return '林可恩';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(TECH_KEY, name);
    } catch {
      // Ignore storage failures; the name still applies to this session.
    }
  }, [name]);

  return [name, setName];
}
