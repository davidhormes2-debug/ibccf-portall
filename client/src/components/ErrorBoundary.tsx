import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // Best-effort: ship the error to the server so we can read it in
    // deployment logs without asking non-technical users to open
    // devtools. Fire-and-forget — never let a reporting failure cascade.
    try {
      const payload = JSON.stringify({
        message: error?.message ?? String(error),
        stack: error?.stack ?? "",
        componentStack: errorInfo?.componentStack ?? "",
        url: typeof window !== "undefined" ? window.location.href : "",
      });
      fetch("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // ignore
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleGoHome = (): void => {
    window.location.href = "/";
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg shadow-lg" data-testid="error-boundary-card">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-600" />
              </div>
              <CardTitle className="text-xl text-slate-900">Something went wrong</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-slate-600">
                We encountered an unexpected error. Please try refreshing the page or go back to the home page.
              </p>
              {this.state.error && (
                <div className="bg-slate-100 rounded-lg p-3 text-left">
                  <p className="text-sm font-mono text-red-600 break-words">
                    {this.state.error.message}
                  </p>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button 
                onClick={this.handleReset} 
                variant="outline"
                data-testid="error-retry-button"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Try Again
              </Button>
              <Button 
                onClick={this.handleGoHome} 
                variant="secondary"
                data-testid="error-home-button"
              >
                <Home className="w-4 h-4 mr-2" />
                Go Home
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

interface ErrorAlertProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  showRetry?: boolean;
}

export function ErrorAlert({ 
  title = "Error", 
  message, 
  onRetry, 
  onDismiss,
  showRetry = true 
}: ErrorAlertProps) {
  return (
    <div 
      className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3"
      data-testid="error-alert"
    >
      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <h4 className="text-sm font-medium text-red-900">{title}</h4>
        <p className="text-sm text-red-700 mt-1">{message}</p>
        {(showRetry && onRetry) || onDismiss ? (
          <div className="flex gap-2 mt-3">
            {showRetry && onRetry && (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={onRetry}
                data-testid="error-alert-retry"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Retry
              </Button>
            )}
            {onDismiss && (
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={onDismiss}
                data-testid="error-alert-dismiss"
              >
                Dismiss
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface InlineErrorProps {
  message: string;
}

export function InlineError({ message }: InlineErrorProps) {
  return (
    <div className="flex items-center gap-2 text-red-600 text-sm" data-testid="inline-error">
      <AlertTriangle className="w-4 h-4" />
      <span>{message}</span>
    </div>
  );
}

interface ErrorPageProps {
  code?: string | number;
  title?: string;
  message?: string;
  showHomeButton?: boolean;
}

export function ErrorPage({ 
  code = "Error",
  title = "Something went wrong", 
  message = "We're sorry, but something unexpected happened.",
  showHomeButton = true
}: ErrorPageProps) {
  return (
    <div 
      className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4"
      data-testid="error-page"
    >
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl font-bold text-red-600">{code}</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-slate-600 mb-6">{message}</p>
        {showHomeButton && (
          <Button onClick={() => window.location.href = "/"} data-testid="error-page-home">
            <Home className="w-4 h-4 mr-2" />
            Return to Home
          </Button>
        )}
      </div>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <ErrorPage 
      code="404"
      title="Page Not Found"
      message="The page you're looking for doesn't exist or has been moved."
    />
  );
}

export default ErrorBoundary;
