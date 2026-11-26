import { Bookmark, FileText, Sparkles, Star } from 'lucide-react'

const features = [
  { icon: FileText, title: 'Previous-year papers', text: 'Browse question papers organised by university, regulation, semester and subject.' },
  { icon: Star, title: 'Important questions', text: 'Focus on the questions that keep coming back instead of reading everything twice.' },
  { icon: Sparkles, title: 'AI-assisted answers', text: 'Get structured answers to revise from, generated for the questions you pick.' },
  { icon: Bookmark, title: 'Saved question sets', text: 'Keep your own revision sets, return to them anytime and share them with friends.' },
]

function Features() {
  return (
    <section className="lsection" id="features">
      <p className="eyebrow eyebrow--dark">Features</p>
      <h2 className="lsection__title">Everything you need to clear your papers</h2>
      <div className="feature-grid">
        {features.map(({ icon: Icon, title, text }) => (
          <article className="feature" key={title}>
            <span className="icon-tile"><Icon size={20} /></span>
            <h3>{title}</h3>
            <p className="muted">{text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default Features
