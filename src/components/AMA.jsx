import { useEffect, useState } from 'react';
import site from '../config/siteConfig';
import Section from './Section';
import { db, auth, googleProvider, firebaseEnabled, ADMIN_EMAIL } from '../firebase';
import {
  collection, addDoc, getDocs, query, orderBy, doc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';

const COL = site.ama.collection;
const todayKey = () => `ama_used_${new Date().toISOString().slice(0, 10)}`;

// Safe date for sorting (handles Firestore Timestamp | string | undefined)
const toMillis = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  const d = new Date(t).getTime();
  return Number.isNaN(d) ? 0 : d;
};

export default function AMA() {
  const [name, setName] = useState('');
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState('');
  const [answered, setAnswered] = useState([]);
  const [used, setUsed] = useState(() => Number(localStorage.getItem(todayKey()) || 0));
  const [admin, setAdmin] = useState(null);
  const [adminItems, setAdminItems] = useState([]);
  const limitReached = used >= site.ama.dailyLimit;

  // Public answered questions — NO composite index needed (filter/sort in JS).
  const loadAnswered = async () => {
    if (!firebaseEnabled) return;
    try {
      const snap = await getDocs(collection(db, COL));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const list = all
        .filter((q) => q.answered === true && q.answer)
        .sort((a, b) => toMillis(b.answeredAt) - toMillis(a.answeredAt))
        .slice(0, 30);
      setAnswered(list);
    } catch (e) {
      console.error('loadAnswered failed:', e);
    }
  };
  useEffect(() => { loadAnswered(); }, []);
  useEffect(() => {
    if (!firebaseEnabled) return;
    return onAuthStateChanged(auth, (u) =>
      setAdmin(u && u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? u : null)
    );
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (site.ama.mode === 'formspree') return submitFormspree();
    if (!firebaseEnabled) return setStatus('Backend not configured yet — add your Firebase keys in .env.');
    if (!name.trim() || !question.trim()) return setStatus('Name and question are required.');
    if (limitReached) return setStatus('Daily limit reached. Come back tomorrow!');
    try {
      await addDoc(collection(db, COL), {
        name: name.trim().slice(0, 60),
        question: question.trim().slice(0, 280),
        answer: '',
        answered: false,
        createdAt: serverTimestamp(),
      });
      const n = used + 1; setUsed(n); localStorage.setItem(todayKey(), n);
      setQuestion(''); setStatus('Sent! I’ll answer it soon.');
      if (admin) loadAdmin();
    } catch (err) {
      console.error(err);
      setStatus('Could not send — check your Firestore rules.');
    }
  };

  const submitFormspree = async () => {
    try {
      await fetch(import.meta.env.VITE_FORMSPREE_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, question, email: site.email }),
      });
      setQuestion(''); setStatus('Sent!');
    } catch { setStatus('Could not send.'); }
  };

  // Admin
  const login = async () => { try { await signInWithPopup(auth, googleProvider); } catch (e) { console.error(e); } };
  const loadAdmin = async () => {
    try {
      const snap = await getDocs(query(collection(db, COL), orderBy('createdAt', 'desc')));
      setAdminItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      // Fallback if createdAt missing on some docs
      const snap = await getDocs(collection(db, COL));
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      setAdminItems(all);
    }
  };
  useEffect(() => { if (admin) loadAdmin(); }, [admin]);

  const saveAnswer = async (id, answer) => {
    if (!answer.trim()) return { ok: false, msg: 'Write an answer first.' };
    try {
      await updateDoc(doc(db, COL, id), {
        answer: answer.trim().slice(0, 1000),
        answered: true,
        answeredAt: serverTimestamp(),
      });
      await loadAdmin();
      await loadAnswered();
      return { ok: true, msg: 'Saved & published' };
    } catch (e) {
      console.error('saveAnswer failed:', e);
      return { ok: false, msg: 'Save failed — check console / rules.' };
    }
  };

  return (
    <Section id="contact" kicker="Ask Me Anything" title="Got a question?">
      <p className="reveal text-lg mb-8 max-w-xl" style={{ color: 'var(--muted)' }}>
        Drop a question, collab idea, or project request. I read every one.
      </p>

      <div className="reveal card p-6 md:p-8" style={{ background: 'var(--surface2)' }}>
        <form onSubmit={submit} className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
                 className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
                 style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Your question…" rows={3} maxLength={280}
                    className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none"
                    style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
          <div className="flex items-center justify-between flex-wrap gap-3">
            <span className="font-mono text-xs" style={{ color: 'var(--dim)' }}>Used {used}/{site.ama.dailyLimit} today</span>
            <button type="submit" disabled={limitReached}
                    className="btn-pill px-6 py-2.5 text-sm font-semibold"
                    style={{ background: 'var(--ink)', color: 'var(--bg)', opacity: limitReached ? 0.5 : 1 }}>
              Send
            </button>
          </div>
          {status && <div className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{status}</div>}
        </form>
      </div>

      {/* Answered questions (public) */}
      {answered.length > 0 && (
        <div className="reveal mt-8 space-y-3">
          <div className="font-mono text-xs tracking-[0.2em] uppercase mb-2" style={{ color: 'var(--dim)' }}>
            Answered
          </div>
          {answered.map((q) => (
            <div key={q.id} className="card p-5" style={{ background: 'var(--surface2)' }}>
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>Q: {q.question}</div>
              <div className="font-mono text-[11px] mb-2" style={{ color: 'var(--dim)' }}>— {q.name}</div>
              <div className="text-sm" style={{ color: 'var(--muted)' }}>{q.answer}</div>
            </div>
          ))}
        </div>
      )}

      {/* Owner controls */}
      {firebaseEnabled && (
        <div className="mt-10 border-t pt-6" style={{ borderColor: 'var(--line)' }}>
          {!admin ? (
            <button onClick={login} className="font-mono text-xs" style={{ color: 'var(--dim)' }}>owner? sign in →</button>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>Signed in as {admin.email}</span>
                <button onClick={() => signOut(auth)} className="tag">Logout</button>
              </div>
              {adminItems.length === 0 && (
                <div className="font-mono text-xs" style={{ color: 'var(--dim)' }}>No questions yet.</div>
              )}
              <div className="space-y-3">
                {adminItems.map((q) => (
                  <AdminItem key={q.id} q={q} onSave={saveAnswer} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function AdminItem({ q, onSave }) {
  const [val, setVal] = useState(q.answer || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const handleSave = async () => {
    setSaving(true); setMsg('');
    const res = await onSave(q.id, val);
    setSaving(false);
    setMsg(res.msg);
  };

  return (
    <div className="card p-4" style={{ background: 'var(--surface)' }}>
      <div className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>{q.question}</div>
      <div className="font-mono text-[11px] mb-2" style={{ color: 'var(--dim)' }}>
        — {q.name} {q.answered ? '· answered' : '· new'}
      </div>
      <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={2} placeholder="Write an answer…"
                className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none mb-2"
                style={{ background: 'var(--surface2)', border: '1px solid var(--line)', color: 'var(--ink)' }} />
      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="tag" style={{ opacity: saving ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save answer'}
        </button>
        {msg && <span className="font-mono text-[11px]" style={{ color: 'var(--accent)' }}>{msg}</span>}
      </div>
    </div>
  );
}
