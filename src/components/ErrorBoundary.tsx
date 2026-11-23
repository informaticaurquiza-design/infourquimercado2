import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'Ocurrió un error inesperado al cargar la aplicación.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string };
      if (parsed && parsed.error) {
        readable = `Error de permisos o datos (${parsed.operationType ?? 'consulta'}): ${parsed.error}`;
      }
    } catch {
      // Keep original message
    }
    return { hasError: true, errorMessage: readable };
  }

  componentDidCatch(error: Error): void {
    console.error('Infourqui Mercado ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-zinc-200 rounded-xl p-8">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-lg font-semibold text-zinc-950">
                No pudimos completar la operación
              </h1>
            </div>
            <p className="text-sm text-zinc-600 leading-relaxed mb-6">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-zinc-950 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Reintentar
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
