import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

const icons = { error: AlertCircle, success: CheckCircle2, info: Info }

function Alert({ variant = 'error', children }) {
  if (!children) return null
  const Icon = icons[variant]
  return (
    <div className={`alert alert--${variant}`} role={variant === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <span>{children}</span>
    </div>
  )
}

export default Alert
