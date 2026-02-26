import { Component, ReactNode } from 'react';
import ErrorModal from './ErrorModal';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: string | null;
  stackTrace: string | null;
  hasRenderError: boolean;
  childKey: number;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, stackTrace: null, hasRenderError: false, childKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      error: error.message || 'Une erreur inattendue est survenue.',
      stackTrace: error.stack || null,
      hasRenderError: true,
    };
  }

  componentDidMount() {
    window.addEventListener('error', this.handleGlobalError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.handleGlobalError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  handleGlobalError = (event: ErrorEvent) => {
    this.setState({
      error: event.message || 'Une erreur inattendue est survenue.',
      stackTrace: event.error?.stack || null,
    });
  };

  handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    this.setState({
      error: reason?.message || String(reason) || 'Une erreur inattendue est survenue.',
      stackTrace: reason?.stack || null,
    });
  };

  handleClose = () => {
    this.setState((prev) => ({
      error: null,
      stackTrace: null,
      hasRenderError: false,
      childKey: prev.hasRenderError ? prev.childKey + 1 : prev.childKey,
    }));
  };

  render() {
    return (
      <>
        {this.state.hasRenderError ? null : (
          <div key={this.state.childKey}>{this.props.children}</div>
        )}
        {this.state.error && (
          <ErrorModal
            error={this.state.error}
            stackTrace={this.state.stackTrace || undefined}
            onClose={this.handleClose}
          />
        )}
      </>
    );
  }
}
