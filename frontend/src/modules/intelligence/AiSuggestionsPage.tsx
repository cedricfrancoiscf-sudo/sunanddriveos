import React from 'react';

function SkeletonBar({ w }: { w: string }): React.JSX.Element {
  return <div className={`h-4 rounded bg-gray-100 animate-pulse ${w}`} />;
}

export default function AiSuggestionsPage(): React.JSX.Element {
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Suggestions IA</h1>
        <p className="mt-1 text-sm text-gray-500">Recommandations automatiques basées sur votre activité</p>
      </div>

      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 space-y-2">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-gray-100 animate-pulse" />
              <SkeletonBar w="w-1/3" />
            </div>
            <SkeletonBar w="w-full" />
            <SkeletonBar w="w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
