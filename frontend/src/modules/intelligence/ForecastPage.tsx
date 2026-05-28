import React from 'react';

function SkeletonBar({ w }: { w: string }): React.JSX.Element {
  return <div className={`h-4 rounded bg-gray-100 animate-pulse ${w}`} />;
}

export default function ForecastPage(): React.JSX.Element {
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Prévisions</h1>
        <p className="mt-1 text-sm text-gray-500">Projections de revenus et occupation sur 30/90 jours</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <SkeletonBar w="w-1/2" />
            <div className="h-36 rounded bg-gray-100 animate-pulse" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <SkeletonBar w="w-24" />
            <div className="flex-1 h-4 rounded bg-gray-100 animate-pulse" />
            <SkeletonBar w="w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
