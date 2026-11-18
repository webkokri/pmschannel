import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Wordmark } from '@/assets/logo';
import { useAuth } from '@/lib/auth';
import { useProperty } from '@/lib/property';
import { AiAssistant } from './AiAssistant';

const NAV_GROUPS: { label: string | null; items: { to: string; label: string; icon: string; end?: boolean }[] }[] = [
  {
    label: null,
    items: [
      { to: '/', label: 'Dashboard', icon: '▚', end: true },
      { to: '/channels', label: 'Channels', icon: '⇄' },
      { to: '/calendar', label: 'Calendar / ARI', icon: '▦' },
      { to: '/bookings', label: 'Bookings', icon: '☑' },
      { to: '/conflicts', label: 'Conflicts', icon: '⚠' },
      { to: '/sync', label: 'Sync Logs', icon: '⟳' },
      { to: '/simulator', label: 'Simulator', icon: '⚙' },
    ],
  },
  {
    label: 'Property ops',
    items: [
      { to: '/properties', label: 'Properties', icon: '⌂' },
      { to: '/pms', label: 'Front desk (PMS)', icon: '🛎' },
      { to: '/rms', label: 'Pricing (RMS)', icon: '📈' },
      { to: '/packages', label: 'Packages', icon: '🎁' },
      { to: '/finance', label: 'Finance', icon: '$' },
      { to: '/accelerator', label: 'Accelerator', icon: '🚀' },
      { to: '/reports', label: 'Reports', icon: '▤' },
      { to: '/seo', label: 'Website & booking page', icon: '🌐' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { to: '/staff', label: 'Staff', icon: '👤' },
      { to: '/settings', label: 'Settings', icon: '⚑' },
    ],
  },
];

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('cm.theme') !== 'light';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('cm.theme', dark ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function Layout() {
  const { user, logout } = useAuth();
  const { properties, selected, selectedId, setSelectedId, locked } = useProperty();
  const { dark, toggle } = useTheme();
  const navGroups = locked ? NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => n.to !== '/staff') })) : NAV_GROUPS;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-4 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="px-2 pb-4">
          <Wordmark className="text-[15px]" />
        </div>
        <nav className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {navGroups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`
                    }
                  >
                    <span className="w-4 text-center text-slate-400">{n.icon}</span>
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <button onClick={toggle} className="btn-ghost mt-2 justify-start">
          {dark ? '☀ Light mode' : '☾ Dark mode'}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {user?.impersonated && (
          <div className="bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white">
            You're viewing this account as support (impersonating). Sign out to return to your own account.
          </div>
        )}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          {locked ? (
            <span className="input max-w-xs cursor-default select-none !bg-slate-50 text-slate-600 dark:!bg-slate-800/60 dark:text-slate-300">
              {selected ? `${selected.name} · ${selected.country}` : 'Loading…'}
            </span>
          ) : (
            <select
              className="input max-w-xs"
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
            >
              {properties.length === 0 && <option>No properties</option>}
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.country}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 dark:text-slate-400 sm:inline">
              {user?.name} · <span className="capitalize">{user?.role}</span>
            </span>
            <button className="btn-ghost !py-1.5" onClick={logout}>
              Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          <Outlet />
        </main>
      </div>

      <AiAssistant />
    </div>
  );
}
