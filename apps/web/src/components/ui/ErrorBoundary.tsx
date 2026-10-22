import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './Button';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((props: { error: Error; reset: () => void }) => ReactNode);
  sectionName?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error(`[ErrorBoundary] Caught error in ${this.props.sectionName || 'application'}:`, error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
    this.props.onReset?.();
  };

  handleNavigateHome = (): void => {
    this.handleReset();
    if (typeof window !== 'undefined') {
      window.location.hash = '#opportunities';
    }
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    const { hasError, error, errorInfo, showDetails } = this.state;
    const { children, fallback, sectionName } = this.props;

    if (hasError && error) {
      if (typeof fallback === 'function') {
        return fallback({ error, reset: this.handleReset });
      }
      if (fallback) {
        return fallback;
      }

      return (
        <div className="w-full my-6 p-6 md:p-8 rounded-2xl bg-[#141414] border border-rose-500/30 shadow-2xl space-y-5 animate-in fade-in duration-200">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                  Runtime Error Isolated
                </span>
                {sectionName && (
                  <span className="text-xs font-mono text-neutral-400">
                    in {sectionName}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-white tracking-tight">
                Something went wrong rendering this section
              </h3>
              <p className="text-xs text-neutral-300 leading-relaxed max-w-2xl">
                The view encountered an unexpected error while processing data. Your session and existing records remain safe. You can reload this view or return to opportunities.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              onClick={this.handleReset}
              className="gap-2 cursor-pointer font-bold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Try Again</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={this.handleNavigateHome}
              className="gap-2 cursor-pointer"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Return to Opportunities</span>
            </Button>
            <button
              type="button"
              onClick={this.toggleDetails}
              className="text-xs text-neutral-400 hover:text-white inline-flex items-center gap-1 transition-colors ml-auto cursor-pointer"
            >
              <span>{showDetails ? 'Hide Technical Details' : 'Show Technical Details'}</span>
              {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {showDetails && (
            <div className="p-4 rounded-xl bg-black/60 border border-white/10 space-y-2 text-xs font-mono text-neutral-300 overflow-x-auto">
              <div className="font-bold text-rose-400">
                {error.name}: {error.message}
              </div>
              {error.stack && (
                <pre className="text-[11px] text-neutral-400 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
                  {error.stack}
                </pre>
              )}
              {errorInfo?.componentStack && (
                <div className="pt-2 border-t border-white/10">
                  <span className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">
                    Component Stack
                  </span>
                  <pre className="text-[11px] text-neutral-400 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
                    {errorInfo.componentStack}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    return children;
  }
}
