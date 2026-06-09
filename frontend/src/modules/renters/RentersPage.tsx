import React from 'react';

export default function RentersPage(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#01696e]/10">
        <svg className="h-7 w-7 text-[#01696e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-gray-900">Locataires</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-400">
        L'historique et la gestion des locataires seront disponibles ici prochainement.
      </p>
      <span className="mt-4 rounded-full bg-[#01696e]/10 px-3 py-1 text-xs font-semibold text-[#01696e]">
        Bientôt disponible
      </span>
    </div>
  );
}
