import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Link, Navigate, useNavigate } from 'react-router-dom';
import { dict } from './i18n.js';
import { api, cachedGet, queuedPost, pendingCount, flush } from './api.js';

const Ctx = createContext();
const useApp = () => useContext(Ctx);

function Provider({ children }) {
  const [user, setUser] = useState(null), [ready, setReady] = useState(false), [lang, setLang] = useState(localStorage.lang || 'en');
  const [low, setLow] = useState(localStorage.low === '1'), [online, setOnline] = useState(navigator.onLine), [pending, setPending] = useState(0);
  const t = (k) => dict[lang][k] || dict.en[k] || k;
  const refresh = useCallback(() => pendingCount().then(setPending), []);
  const sync = useCallback(async () => { await flush(); refresh(); }, [refresh]);
  useEffect(() => { api('/auth/me').then(setUser).catch(() => {}).finally(() => setReady(true)); refresh(); }, [refresh]);
  useEffect(() => {
    const on = () => { setOnline(true); sync(); }, off = () => setOnline(false), msg = (e) => e.data === 'sync' && sync();
    addEventListener('online', on); addEventListener('offline', off); navigator.serviceWorker?.addEventListener('message', msg);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, [sync]);
  useEffect(() => { localStorage.lang = lang; localStorage.low = low ? '1' : '0'; document.documentElement.lang = lang; document.body.className = low ? 'lowdata' : ''; }, [lang, low]);
  return <Ctx.Provider value={{ user, setUser, ready, lang, setLang, low, setLow, online, pending, refresh, t }}>{children}</Ctx.Provider>;
}

const Guard = ({ roles, children }) => { const { user, ready } = useApp(); if (!ready) return <p>…</p>; if (!user) return <Navigate to="/login" />; if (roles && !roles.includes(user.role) && user.role !== 'SUPER_ADMIN') return <Navigate to="/" />; return children; };

function Layout({ children }) {
  const { user, setUser, t, lang, setLang, low, setLow, online, pending } = useApp(), nav = useNavigate();
  return <>
    {!online && <div className="banner" role="status">{t('offline')}</div>}
    {pending > 0 && <div className="banner" role="status">{t('pending')} ({pending})</div>}
    <header className="top"><b>HealthConnect</b>
      <nav><Link to="/">{t('home')}</Link><Link to="/help">{t('help')}</Link><Link to="/complaints">{t('complaints')}</Link>{user && ['GOVERNMENT_ADMIN', 'SUPER_ADMIN'].includes(user.role) && <Link to="/admin">{t('admin')}</Link>}</nav>
      <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: 'auto' }}><option value="en">English</option><option value="hi">हिन्दी</option></select>
      <label style={{ margin: 0, display: 'flex', gap: '.3rem', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={low} onChange={(e) => setLow(e.target.checked)} />{t('lowdata')}</label>
      {user ? <button className="b" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); nav('/'); }}>{t('logout')}</button> : <Link to="/login">{t('login')}</Link>}
    </header><main>{children}</main></>;
}

const Freshness = ({ at, fromCache }) => { const { t } = useApp(); const old = fromCache || Date.now() - new Date(at) > 6 * 36e5; return <span className={old ? 'stale' : ''}>{t('updated')}: {new Date(at).toLocaleString()}{old && ` — ${t('stale')}`}</span>; };
const locate = () => new Promise((res) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 8000 }) : res(null));

function Home() {
  const { t } = useApp();
  return <div className="grid">
    <Link className="big sos" to="/emergency">{t('emergency')}</Link>
    <Link className="big" to="/hospitals">{t('hospital')}</Link><Link className="big" to="/doctors">{t('doctor')}</Link>
    <Link className="big" to="/hospitals?beds=true">{t('bed')}</Link><Link className="big" to="/blood">{t('blood')}</Link>
    <Link className="big" to="/ambulance">{t('ambulance')}</Link><Link className="big" to="/complaints">{t('report')}</Link></div>;
}

function HospitalList({ query, showAsk }) {
  const { t } = useApp(), [state, setState] = useState(null), [err, setErr] = useState('');
  useEffect(() => { cachedGet('/hospitals?' + query).then(setState).catch((e) => setErr(e.message)); }, [query]);
  if (err) return <p className="err">{err}</p>; if (!state) return <p>…</p>; if (!state.data.length) return <p>No facilities found. Try a wider area.</p>;
  return <>{showAsk && <p>{t('matching')}</p>}{state.data.map((h) => <article className="card" key={h._id}>
    <h3>{h.name}</h3><span className="tag">{h.verified ? t('verified') : t('unverified')}</span><span className="tag">{h.type}</span>{h.emergency && <span className="tag">Emergency</span>}
    <p>{h.area} {h.city}</p>
    <p>{Object.entries(h.beds || {}).map(([k, b]) => <span key={k} className={`tag ${b.status}`}>{k}: {b.status}</span>)}</p>
    <Freshness at={Object.values(h.beds || {})[0]?.updatedAt || Date.now()} fromCache={state.fromCache || h.bedsStale} />
    <div className="row" style={{ marginTop: '.5rem' }}>{(h.emergencyPhone || h.phone) && <a className="big" href={`tel:${h.emergencyPhone || h.phone}`}>{t('call')}</a>}
      <a className="big" href={`https://www.google.com/maps/dir/?api=1&destination=${h.location.coordinates[1]},${h.location.coordinates[0]}`} target="_blank" rel="noreferrer">{t('directions')}</a>
      <Link className="big" to={`/complaints?hospital=${h._id}`}>{t('report')}</Link></div></article>)}</>;
}

function Hospitals() {
  const { t } = useApp(), [f, setF] = useState({ city: '', type: '', emergency: false, beds: new URLSearchParams(location.search).get('beds') === 'true', icu: false }), [pos, setPos] = useState(null);
  const qs = new URLSearchParams({ ...(f.city && { city: f.city }), ...(f.type && { type: f.type }), ...(f.emergency && { emergency: true }), ...(f.beds && { beds: true }), ...(f.icu && { icu: true }), ...(pos || {}) }).toString();
  return <><h2>{t('hospital')}</h2><div className="card"><div className="row">
    <div><label htmlFor="c">City</label><input id="c" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
    <div><label htmlFor="ty">Type</label><select id="ty" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Any</option><option value="GOVERNMENT">Government</option><option value="PRIVATE">Private</option></select></div></div>
    {[['emergency', 'Emergency'], ['beds', 'Beds available'], ['icu', 'ICU available']].map(([k, l]) => <label key={k}><input type="checkbox" style={{ width: 'auto' }} checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {l}</label>)}
    <button className="b" onClick={async () => setPos(await locate())}>{t('locate')}</button></div><HospitalList query={qs} /></>;
}

function Emergency() {
  const { t } = useApp(), { user } = useApp(), [pos, setPos] = useState(undefined), [msg, setMsg] = useState('');
  useEffect(() => { locate().then(setPos); }, []);
  const q = pos ? `emergency=true&lat=${pos.lat}&lng=${pos.lng}` : 'emergency=true';
  const request = async () => { if (!pos) return setMsg('Location needed to send an ambulance request. Please call 108.'); const r = await queuedPost('/emergency/requests', { kind: 'AMBULANCE', ...pos }).catch((e) => ({ err: e.message })); setMsg(r.queued ? t('pending') : r.err || 'Request sent'); };
  return <><h2>{t('emergency')}</h2><div className="grid"><a className="big sos" href="tel:108">{t('call')} 108</a><a className="big" href="tel:112">{t('call')} 112</a><a className="big" href="tel:102">{t('call')} 102</a>
    {user && <button className="big" onClick={request}>{t('ambulance')}</button>}<Link className="big" to="/blood">{t('blood')}</Link></div>
    {msg && <p role="status" className="card">{msg}</p>}<h3>{t('nearest')}</h3>{pos === undefined ? <p>…</p> : <HospitalList query={q} />}
    <p className="card">This tool gives information only. It does not give medical advice.</p></>;
}

function Blood() {
  const { t } = useApp(), [group, setGroup] = useState(''), [city, setCity] = useState(''), [s, setS] = useState(null);
  useEffect(() => { cachedGet(`/blood?group=${encodeURIComponent(group)}&city=${city}`).then(setS).catch(() => setS({ data: [] })); }, [group, city]);
  return <><h2>{t('blood')}</h2><p className="card">{t('bloodNote')}</p><div className="row"><select aria-label="Blood group" value={group} onChange={(e) => setGroup(e.target.value)}><option value="">All groups</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => <option key={g}>{g}</option>)}</select><input aria-label="City" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} /></div>
    {s?.data.map((b) => <article className="card" key={b._id}><h3>{b.name}</h3>{b.inventory.map((i) => <span key={i.group} className={`tag ${i.units > 5 ? 'AVAILABLE' : i.units ? 'LIMITED' : 'FULL'}`}>{i.group}: {i.units > 5 ? 'Available' : i.units ? 'Limited' : 'None'}</span>)}<br />{b.inventory[0] && <Freshness at={b.inventory[0].updatedAt} fromCache={s.fromCache} />}{b.phone && <p><a href={`tel:${b.phone}`}>{t('call')} {b.phone}</a></p>}</article>)}</>;
}

function Ambulance() {
  const { t } = useApp(), [s, setS] = useState(null);
  useEffect(() => { locate().then((p) => cachedGet('/ambulances' + (p ? `?lat=${p.lat}&lng=${p.lng}` : '')).then(setS).catch(() => setS({ data: [] }))); }, []);
  return <><h2>{t('ambulance')}</h2>{s?.data.map((a) => <article className="card" key={a._id}><h3>{a.vehicleId} · {a.type}</h3><p>{a.agency}</p><Freshness at={a.updatedAt} fromCache={s.fromCache} /><p><a className="big" href={`tel:${a.phone}`}>{t('call')} {a.phone}</a></p></article>)}</>;
}

function Guided() {
  const { t } = useApp(), [need, setNeed] = useState(null), [pos, setPos] = useState(null);
  const opts = { 'Emergency treatment': 'emergency=true', 'Hospital bed': 'beds=true', 'Child healthcare': 'dept=Pediatrics', "Women's healthcare": 'dept=Gynecology', 'Government healthcare scheme': 'scheme=Ayushman%20Bharat', 'Doctor consultation': '', 'General healthcare': '', 'Diagnostic test': 'dept=Diagnostics' };
  return <><h2>{t('help')}</h2><div className="grid">{Object.keys(opts).map((o) => <button key={o} className="big" onClick={async () => { setPos(await locate()); setNeed(o); }}>{o}</button>)}<Link className="big" to="/blood">Blood</Link><Link className="big" to="/ambulance">Ambulance</Link></div>
    {need && <><h3>{need}</h3><HospitalList showAsk query={opts[need] + (pos ? `&lat=${pos.lat}&lng=${pos.lng}` : '')} /></>}</>;
}

function Doctors() {
  const [sp, setSp] = useState(''), [s, setS] = useState(null);
  useEffect(() => { cachedGet('/doctors?specialization=' + encodeURIComponent(sp)).then(setS).catch(() => setS({ data: [] })); }, [sp]);
  const book = async (id) => { const when = prompt('Preferred date & time (YYYY-MM-DD HH:MM)'); if (when) { const r = await queuedPost('/appointments', { doctor: id, when: new Date(when).toISOString() }).catch((e) => alert(e.message)); r && alert(r.queued ? 'Saved. Will send when online.' : 'Requested'); } };
  return <><h2>Find doctor</h2><input aria-label="Specialization" placeholder="Specialization" value={sp} onChange={(e) => setSp(e.target.value)} />
    {s?.data.map((d) => <article className="card" key={d._id}><h3>{d.user?.name}</h3><span className="tag">{d.verified ? 'Verified Doctor' : 'Not yet verified'}</span><p>{d.specialization} · {d.qualification} · {d.experience} yrs<br />{d.hospital?.name} · ★ {d.rating.toFixed(1)} ({d.ratingCount})</p><button className="b" onClick={() => book(d._id)}>Book appointment</button></article>)}</>;
}

function Auth({ mode }) {
  const { setUser, t } = useApp(), nav = useNavigate(), [f, setF] = useState({ role: 'PATIENT' }), [err, setErr] = useState('');
  const go = async (e) => { e.preventDefault(); try { const u = await api(mode === 'login' ? '/auth/login' : '/auth/register', { method: 'POST', body: mode === 'login' ? { identifier: f.identifier, password: f.password } : { name: f.name, [/@/.test(f.identifier) ? 'email' : 'phone']: f.identifier, password: f.password, role: f.role } }); setUser(u); nav('/'); } catch (x) { setErr(x.message); } };
  return <form className="card" onSubmit={go}><h2>{mode === 'login' ? t('login') : t('register')}</h2>{mode === 'register' && <><label htmlFor="n">Name</label><input id="n" required onChange={(e) => setF({ ...f, name: e.target.value })} /><label htmlFor="r">I am a</label><select id="r" onChange={(e) => setF({ ...f, role: e.target.value })}><option value="PATIENT">Patient</option><option value="DOCTOR">Doctor</option><option value="HOSPITAL_ADMIN">Hospital staff</option></select></>}
    <label htmlFor="i">Email or phone</label><input id="i" required autoComplete="username" onChange={(e) => setF({ ...f, identifier: e.target.value })} /><label htmlFor="p">Password (8+ characters)</label><input id="p" type="password" minLength={8} required autoComplete="current-password" onChange={(e) => setF({ ...f, password: e.target.value })} />
    {err && <p className="err" role="alert">{err}</p>}<button className="b">{t('submit')}</button>{mode === 'login' && <p><Link to="/register">{t('register')}</Link></p>}</form>;
}

async function compress(file) { // low-data mode: shrink images before upload
  if (!file.type.startsWith('image/')) return file; const bmp = await createImageBitmap(file), s = Math.min(1, 1280 / bmp.width), c = new OffscreenCanvas(bmp.width * s, bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.6 })], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}
function Complaints() {
  const { t, low } = useApp(), [list, setList] = useState([]), [msg, setMsg] = useState(''), [cats] = useState(['EXCESSIVE_CHARGE', 'UNEXPECTED_CHARGE', 'FACILITY_UNAVAILABLE', 'BED_ISSUE', 'DOCTOR', 'STAFF', 'EMERGENCY_SERVICE', 'AMBULANCE', 'BLOOD', 'INCORRECT_INFO', 'OTHER']);
  const load = () => api('/complaints/mine').then(setList).catch(() => {}); useEffect(() => { load(); }, []);
  const submit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target), out = new FormData(); for (const [k, v] of fd) if (k !== 'evidence' && v) out.append(k, v);
    const hid = new URLSearchParams(location.search).get('hospital'); hid && out.append('hospital', hid);
    for (const f of fd.getAll('evidence')) if (f.size) out.append('evidence', low ? await compress(f) : f);
    try { const r = await api('/complaints', { method: 'POST', form: out }); setMsg(`${r.complaintId} — ${r.status}`); e.target.reset(); load(); } catch (x) { setMsg(x.offline || !navigator.onLine ? 'You are offline. Connect and try again (files cannot be queued).' : x.message); }
  };
  return <><h2>{t('report')}</h2><form className="card" onSubmit={submit}><label htmlFor="cat">Type of problem</label><select id="cat" name="category" required>{cats.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ').toLowerCase()}</option>)}</select>
    <label htmlFor="d">What happened?</label><textarea id="d" name="description" rows="4" minLength="10" required /><label htmlFor="w">Date and time</label><input id="w" name="incidentAt" type="datetime-local" />
    <label htmlFor="ev">Evidence (photo, video, audio, PDF)</label><input id="ev" name="evidence" type="file" multiple accept="image/*,video/*,audio/*,application/pdf" /><button className="b">{t('submit')}</button>{msg && <p role="status">{msg}</p>}</form>
    <h3>{t('track')}</h3>{list.map((c) => <article className="card" key={c._id}><b>{c.complaintId}</b> <span className="tag">{c.status.replace('_', ' ')}</span><p>{c.history.map((h) => `${h.status} (${new Date(h.at).toLocaleDateString()})`).join(' → ')}</p></article>)}</>;
}

function Admin() {
  const [stats, setStats] = useState({}), [cs, setCs] = useState([]);
  const load = () => { api('/admin/stats').then(setStats); api('/admin/complaints').then(setCs); }; useEffect(load, []);
  const set = async (id, status) => { await api('/admin/complaints/' + id, { method: 'PATCH', body: { status } }); load(); };
  return <><h2>Admin dashboard</h2><div className="grid">{Object.entries(stats).map(([k, v]) => <div className="card" key={k}><b style={{ fontSize: '1.8rem' }}>{v}</b><br />{k}</div>)}</div>
    <h3>Complaints</h3>{cs.map((c) => <article className="card" key={c._id}><b>{c.complaintId}</b> · {c.category} <span className="tag">{c.status}</span><p>{c.description}</p><label htmlFor={c._id}>Update status</label><select id={c._id} value="" onChange={(e) => set(c._id, e.target.value)}><option value="">Choose…</option>{['UNDER_REVIEW', 'ASSIGNED', 'INVESTIGATION', 'RESOLVED', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}</select></article>)}</>;
}

export default function App() {
  return <Provider><Layout><Routes>
    <Route path="/" element={<Home />} /><Route path="/emergency" element={<Emergency />} /><Route path="/hospitals" element={<Hospitals />} /><Route path="/doctors" element={<Doctors />} />
    <Route path="/blood" element={<Blood />} /><Route path="/ambulance" element={<Ambulance />} /><Route path="/help" element={<Guided />} />
    <Route path="/login" element={<Auth mode="login" />} /><Route path="/register" element={<Auth mode="register" />} />
    <Route path="/complaints" element={<Guard><Complaints /></Guard>} /><Route path="/admin" element={<Guard roles={['GOVERNMENT_ADMIN']}><Admin /></Guard>} />
  </Routes></Layout></Provider>;
}
