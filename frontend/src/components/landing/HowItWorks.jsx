const steps = [
  { title: 'Create your account', text: 'Sign up with your email, course, department and semester.' },
  { title: 'Verify your email', text: 'Enter the 6-digit code we send to confirm it’s really you.' },
  { title: 'Start preparing', text: 'Log in and get to work on the papers that matter.' },
]

function HowItWorks() {
  return (
    <section className="lsection" id="how">
      <p className="eyebrow eyebrow--dark">How it works</p>
      <h2 className="lsection__title">Up and running in three steps</h2>
      <ol className="steps">
        {steps.map((s, i) => (
          <li className="step" key={s.title}>
            <span className="step__num">{i + 1}</span>
            <h3>{s.title}</h3>
            <p className="muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default HowItWorks
