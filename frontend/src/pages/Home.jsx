import { useState } from 'react'
import { ArrowRight, Layers, Palette, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, Input, Loader, Modal } from '../components/ui'

const pillars = [
  { icon: Layers, title: 'Modular structure', text: 'Components, pages, services and styles are cleanly separated.' },
  { icon: Palette, title: 'Design tokens', text: 'One palette and spacing scale powers every screen.' },
  { icon: ShieldCheck, title: 'Ready to extend', text: 'Router and API client are wired up for the next phases.' },
]

function Home() {
  const [modalOpen, setModalOpen] = useState(false)
  const [name, setName] = useState('')

  return (
    <>
      <section className="hero">
        <span className="badge">Component library</span>
        <h1 className="hero__title">
          Never fall <span className="text-accent">behind</span> again.
        </h1>
        <p className="hero__text">
          NO_ARREAR is a clean, focused home for keeping everything that&apos;s due under control.
        </p>
        <div className="hero__actions">
          <Link to="/dashboard">
            <Button size="lg">
              Open dashboard <ArrowRight size={18} />
            </Button>
          </Link>
          <Button size="lg" variant="outline" onClick={() => setModalOpen(true)}>
            Preview modal
          </Button>
        </div>
      </section>

      <section className="grid grid--3">
        {pillars.map(({ icon: Icon, title, text }) => (
          <Card key={title}>
            <span className="icon-tile">
              <Icon size={20} />
            </span>
            <h3 className="card__title">{title}</h3>
            <p className="muted">{text}</p>
          </Card>
        ))}
      </section>

      <section className="grid grid--2 section">
        <Card title="Buttons" subtitle="Variants and sizes">
          <div className="stack-row">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button size="sm" loading>
              Loading
            </Button>
            <Button disabled>Disabled</Button>
          </div>
        </Card>
        <Card title="Inputs & loader" subtitle="Form controls and feedback">
          <div className="stack">
            <Input
              label="Your name"
              placeholder="Type here…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              hint="This is a helper message."
            />
            <Input label="With error" defaultValue="oops" error="This field is invalid." />
            <Loader size="sm" />
          </div>
        </Card>
      </section>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Welcome to NO_ARREAR"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setModalOpen(false)}>Got it</Button>
          </>
        }
      >
        <p>This reusable modal supports Escape, backdrop click, and focus restore.</p>
      </Modal>
    </>
  )
}

export default Home
