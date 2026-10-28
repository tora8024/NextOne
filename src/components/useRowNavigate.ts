import { useNavigate } from 'react-router-dom';
import type { KeyboardEvent } from 'react';

export function useRowNavigate() {
  const navigate = useNavigate();
  return (to: string, label: string) => ({
    className: 'click-row',
    tabIndex: 0,
    'aria-label': label,
    onClick: () => navigate(to),
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigate(to);
      }
    },
  });
}
