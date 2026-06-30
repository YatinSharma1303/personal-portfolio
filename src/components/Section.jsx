// Shared section wrapper + heading.
export default function Section({ id, kicker, title, children, className = '' }) {
  return (
    <section id={id} className={`relative max-w-5xl mx-auto px-5 py-24 ${className}`}>
      {(kicker || title) && (
        <div className="reveal mb-12">
          {kicker && (
            <div className="font-mono text-xs tracking-[0.3em] uppercase mb-3" style={{ color: 'var(--accent)' }}>
              {kicker}
            </div>
          )}
          {title && <h2 className="text-4xl md:text-5xl font-extrabold" style={{ color: 'var(--ink)' }}>{title}</h2>}
        </div>
      )}
      {children}
    </section>
  );
}
