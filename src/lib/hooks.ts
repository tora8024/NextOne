import { useEffect } from 'react';

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · NextOne 維修台` : 'NextOne 維修台';
  }, [title]);
}
