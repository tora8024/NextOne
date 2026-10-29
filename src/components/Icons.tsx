import type { ReactNode } from 'react';

type IconProps = { className?: string };

function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'icon'} aria-hidden="true">
      {children}
    </svg>
  );
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconHome() {
  return (
    <Icon>
      <path {...stroke} d="M4 11.5 12 4l8 7.5" />
      <path {...stroke} d="M7 10.5V20h10v-9.5" />
    </Icon>
  );
}

export function IconClipboard() {
  return (
    <Icon>
      <rect {...stroke} x="6" y="4" width="12" height="16" rx="2" />
      <path {...stroke} d="M9 4.5h6v2H9zM9 11h6M9 15h4" />
    </Icon>
  );
}

export function IconPlus() {
  return (
    <Icon>
      <circle {...stroke} cx="12" cy="12" r="8" />
      <path {...stroke} d="M12 8.5v7M8.5 12h7" />
    </Icon>
  );
}

export function IconPeople() {
  return (
    <Icon>
      <circle {...stroke} cx="9" cy="9" r="2.4" />
      <path {...stroke} d="M4.8 18c.6-2.4 2.2-3.6 4.2-3.6s3.6 1.2 4.2 3.6" />
      <circle {...stroke} cx="16.2" cy="9.2" r="1.8" />
      <path {...stroke} d="M15 14.5c1.6.2 2.8 1.1 3.4 3" />
    </Icon>
  );
}

export function IconDevice() {
  return (
    <Icon>
      <rect {...stroke} x="4" y="5" width="16" height="11" rx="1.6" />
      <path {...stroke} d="M8 19.5h8M12 16v3.5" />
    </Icon>
  );
}

export function IconSearch() {
  return (
    <Icon>
      <circle {...stroke} cx="11" cy="11" r="5.5" />
      <path {...stroke} d="m15.5 15.5 3.5 3.5" />
    </Icon>
  );
}
