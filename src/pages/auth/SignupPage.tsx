import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmEmailScreen } from '@/pages/auth/components/ConfirmEmailScreen'

type Phase = 'form' | 'already_registered' | 'success'

export function SignupPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('form')

  function resetForm() {
    setName('')
    setEmail('')
    setPassword('')
    setError(null)
    setPhase('form')
  }

  function editEmail() {
    // Volta ao form mantendo nome preenchido para o usuário só corrigir o e-mail.
    setPassword('')
    setError(null)
    setPhase('form')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    setSubmitting(true)
    try {
      const result = await signUp(email.trim(), password, name.trim())
      if (result.alreadyRegistered) {
        setPhase('already_registered')
      } else {
        setPhase('success')
      }
    } catch {
      setError('Não foi possível criar sua conta. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'already_registered') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>E-mail já cadastrado</CardTitle>
            <CardDescription>
              Já existe uma conta usando <strong>{email}</strong>. Você pode
              entrar com sua senha ou reiniciar o cadastro com outro e-mail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() =>
                navigate('/login', { state: { prefillEmail: email.trim() } })
              }
            >
              Entrar nessa conta
            </Button>
            <Button variant="outline" className="w-full" onClick={resetForm}>
              Usar outro e-mail
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Esqueceu a senha?{' '}
              <Link to="/forgot-password" className="hover:underline">
                Recuperar
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (phase === 'success') {
    return <ConfirmEmailScreen email={email.trim()} onEdit={editEmail} />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Criar conta</CardTitle>
          <CardDescription>Comece sua agenda profissional em minutos.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Mínimo de 8 caracteres.
              </p>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Criando...' : 'Criar conta'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Já tem conta?{' '}
              <Link to="/login" className="font-medium text-foreground hover:underline">
                Entrar
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
