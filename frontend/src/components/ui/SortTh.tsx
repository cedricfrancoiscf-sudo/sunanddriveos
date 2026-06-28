import React from 'react';

interface SortThProps {
  label: string;
  sortKey: string;
  currentKey: string;
  direction: 'asc' | 'desc';
  onSort: (key: string) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export function SortTh({ label, sortKey, currentKey, direction, onSort, align = 'left', className }: SortThProps): React.JSX.Element {
  const active = sortKey === currentKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`cursor-pointer select-none px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 transition-colors text-${align} ${className ?? ''}`}
    >
      {label}
      <span className="ml-1 text-gray-300">{active ? (direction === 'desc' ? '↓' : '↑') : '↕'}</span>
    </th>
  );
}
