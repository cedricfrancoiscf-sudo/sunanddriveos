import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import NotificationBell from './NotificationBell';

export default function AppLayout(): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    localStorage.getItem('sidebar_collapsed') === 'true',
  );

  function toggleCollapse(): void {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar_collapsed', String(next));
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar desktop — fixe, largeur variable */}
      <aside
        className={`hidden shrink-0 border-r border-gray-200 bg-white lg:flex lg:flex-col transition-all duration-200 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />
      </aside>

      {/* Sidebar mobile — overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Contenu principal */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Barre mobile */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-2 text-gray-500 hover:text-gray-700"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ backgroundColor: '#01696e' }}
              >
                <span className="text-xs font-bold text-white">S</span>
              </div>
              <span className="text-sm font-semibold text-gray-900">SunanddriveOS</span>
            </div>
          </div>
          <NotificationBell />
        </header>

        {/* Barre desktop */}
        <header className="hidden h-14 shrink-0 items-center justify-end border-b border-gray-200 bg-white px-6 lg:flex">
          <NotificationBell />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
