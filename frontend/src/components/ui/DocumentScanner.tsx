import React, { useRef, useState } from 'react';
import { api } from '../../utils/api';

type ScanType = 'vehicle' | 'technical-control' | 'maintenance' | 'invoice';

interface DocumentScannerProps {
  type: ScanType;
  onResult: (data: Record<string, unknown>) => void;
  label?: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';

export function DocumentScanner({ type, onResult, label = 'Scanner' }: DocumentScannerProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ isPdf: boolean; name: string } | null>(null);

  const handleFile = async (file: File): Promise<void> => {
    setScanning(true);
    setError(null);
    const isPdf = file.type === 'application/pdf';
    setPreview({ isPdf, name: file.name });
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post<{ success: boolean; data: Record<string, unknown>; isPdf?: boolean }>(
        `/scan/${type}`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      if (res.data.success) {
        onResult(res.data.data);
      }
    } catch {
      setError('Erreur lors de la lecture — réessayez avec une image plus nette ou un PDF de meilleure qualité');
    } finally {
      setScanning(false);
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        capture="environment"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={scanning}
        className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-[#01696e] hover:text-[#01696e] transition-colors disabled:opacity-50"
      >
        {scanning ? (
          <>
            <span className="inline-block animate-spin">⟳</span>
            Lecture en cours...
          </>
        ) : (
          <>{preview?.isPdf ? '📄' : '📷'} {label}</>
        )}
      </button>
      {preview?.isPdf && !scanning && (
        <p className="mt-1 text-xs text-gray-400">
          PDF : {preview.name} — seule la première page a été analysée
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
