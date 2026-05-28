import React from 'react';

function SkeletonBar({ w }: { w: string }): React.JSX.Element {
  return <div className={`h-4 rounded bg-gray-100 animate-pulse ${w}`} />;
}

export default function PerformancePage(): React.JSX.Element {
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Performance</h1>
        <p className="mt-1 text-sm text-gray-500">Taux d'utilisation, revenus et KPIs flotte</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <SkeletonBar w="w-1/2" />
            <SkeletonBar w="w-3/4" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <SkeletonBar w="w-1/3" />
        <div className="h-48 rounded bg-gray-100 animate-pulse" />
      </div>
    </div>
  );
}
