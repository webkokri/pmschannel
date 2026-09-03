export function Logo({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-brand-500" />
      <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M8 11h9" />
        <path d="M15 21h9" />
      </g>
      <g fill="#fff">
        <circle cx="21" cy="11" r="3.1" />
        <circle cx="11" cy="21" r="3.1" />
      </g>
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <Logo />
      <span>
        Channel<span className="text-brand-400">Manager</span>
      </span>
    </span>
  );
}
