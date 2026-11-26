function Card({ id, title, subtitle, actions, footer, variant = 'default', className = '', children }) {
  return (
    <section id={id} className={`card card--${variant} ${className}`.trim()}>
      {(title || actions) && (
        <header className="card__header">
          <div>
            {title && <h3 className="card__title">{title}</h3>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
      {footer && <footer className="card__footer">{footer}</footer>}
    </section>
  )
}

export default Card
