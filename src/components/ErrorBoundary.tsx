import { Component, type ErrorInfo, type ReactNode } from "react";
import { translate } from "@/i18n";
import { getStoredLanguage } from "@/contexts/LanguageContext";

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the route) clears a previous error. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches a crash in one page so the whole app doesn't go blank:
 * shows a short message with Reload instead.
 */
class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app] page crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const lang = getStoredLanguage();
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-card">
          <p className="text-lg font-bold text-foreground">{translate(lang, "app.errorTitle")}</p>
          <p className="mt-1 text-base text-muted-foreground">{translate(lang, "app.errorDesc")}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 min-h-[52px] w-full rounded-xl bg-primary text-lg font-bold text-primary-foreground"
          >
            {translate(lang, "app.errorReload")}
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
