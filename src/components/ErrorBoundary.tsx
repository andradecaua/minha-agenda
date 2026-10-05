import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Opcional: render alternativo. */
  fallback?: (reset: () => void, error: Error) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Captura erros de render descendentes. Sem isso, qualquer throw
 * dentro de uma página tela a aplicação inteira em branco.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log mínimo para diagnóstico — em produção, enviaria para Sentry/etc.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught:', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return this.props.fallback(this.reset, error)
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="max-w-md rounded-xl border bg-background p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-lg font-semibold">Algo deu errado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ocorreu um erro inesperado nesta tela. Tente recarregar — se o
            problema persistir, entre em contato.
          </p>
          <p className="mt-3 break-words rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
            {error.message}
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={this.reset} variant="outline">
              <RefreshCcw className="h-4 w-4" />
              Tentar de novo
            </Button>
            <Button onClick={() => window.location.reload()}>
              Recarregar página
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
