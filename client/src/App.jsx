import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { dict } from './i18n.js';
import { voiceRoute } from './voice.js';
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
      <nav><Link to="/">{t('home')}</Link><Link to="/help">{t('help')}</Link><Link to="/schemes">Schemes</Link><Link to="/complaints">{t('complaints')}</Link>{user?.role === 'DOCTOR' && <Link to="/doctor">Dashboard</Link>}{user?.role === 'HOSPITAL_ADMIN' && <Link to="/hospital">Dashboard</Link>}{user?.role === 'PATIENT' && <Link to="/appointments">Appointments</Link>}{user && <><Link to="/settings">Settings</Link><Link to="/saved">Saved</Link><Link to="/notifications">Alerts</Link></>}<Link to="/place">Area</Link><Link to="/offline-data">Offline</Link>{user && ['GOVERNMENT_ADMIN', 'SUPER_ADMIN'].includes(user.role) && <Link to="/admin">{t('admin')}</Link>}</nav>
      <VoiceButton /><select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: 'auto' }}><option value="en">English</option><option value="hi">हिन्दी</option></select>
      <label style={{ margin: 0, display: 'flex', gap: '.3rem', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={low} onChange={(e) => setLow(e.target.checked)} />{t('lowdata')}</label>
      {user ? <button className="b" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); nav('/'); }}>{t('logout')}</button> : <Link to="/login">{t('login')}</Link>}
    </header><main>{children}</main><footer style={{ maxWidth: '64rem', margin: '0 auto', padding: '1rem' }}><nav className="row"><Link to="/about">About</Link><Link to="/how-it-works">How it works</Link><Link to="/emergency-info">Emergency information</Link><Link to="/services">Services</Link></nav><p className="stale">HealthConnect gives information to help you find care. It does not diagnose or prescribe. In an emergency call 108 or 112.</p></footer></>;
}

const Freshness = ({ at, fromCache }) => { const { t } = useApp(); const old = fromCache || Date.now() - new Date(at) > 6 * 36e5; return <span className={old ? 'stale' : ''}>{t('updated')}: {new Date(at).toLocaleString()}{old && ` — ${t('stale')}`}</span>; };
const locate = () => new Promise((res) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { timeout: 8000 }) : res(null));

function Home() {
  const { t } = useApp();
  return <div className="grid">
    <Link className="big sos" to="/emergency">{t('emergency')}</Link>
    <Link className="big" to="/hospitals">{t('hospital')}</Link><Link className="big" to="/doctors">{t('doctor')}</Link>
    <Link className="big" to="/hospitals?beds=true">{t('bed')}</Link><Link className="big" to="/blood">{t('blood')}</Link>
    <Link className="big" to="/ambulance">{t('ambulance')}</Link><Link className="big" to="/complaints">{t('report')}</Link><Link className="big" to="/schemes">Government schemes</Link></div>;
}

function Schemes() {
  const [items, setItems] = useState([]), [error, setError] = useState('');
  useEffect(() => { cachedGet('/schemes').then((r) => setItems(r.data)).catch((e) => setError(e.message)); }, []);
  return <><h2>Government healthcare schemes</h2><p className="card stale">Scheme information is demonstration data unless published by an authorized source. Check eligibility and details with the official program.</p>{error && <p className="err" role="alert">{error}</p>}{items.map((s) => <article className="card" key={s._id}><h3>{s.title}</h3>{s.region && <span className="tag">{s.region}</span>}<p>{s.body}</p></article>)}{!items.length && !error && <p>No schemes have been published yet.</p>}</>;
}

function HospitalList({ query, showAsk }) {
  const { t } = useApp(), [state, setState] = useState(null), [err, setErr] = useState('');
  useEffect(() => { cachedGet('/hospitals?' + query).then(setState).catch((e) => setErr(e.message)); }, [query]);
  if (err) return <p className="err">{err}</p>; if (!state) return <p>…</p>; if (!state.data.length) return <p>No facilities found. Try a wider area.</p>;
  return <>{state.fromCache && <p className="card stale">Availability could not be verified. Please contact the facility before travelling.</p>}{showAsk && <p>{t('matching')}</p>}{state.data.map((h) => <article className="card" key={h._id}>
    <h3>{h.name}</h3><span className="tag">{h.verified ? t('verified') : t('unverified')}</span><span className="tag">{h.type}</span>{h.emergency && <span className="tag">Emergency</span>}
    <p>{h.area} {h.city}</p>
    <p>{Object.entries(h.beds || {}).map(([k, b]) => <span key={k} className={`tag ${b.status}`}>{k}: {b.status}</span>)}</p>
    <Freshness at={Object.values(h.beds || {})[0]?.updatedAt || Date.now()} fromCache={state.fromCache || h.bedsStale} />
    <div className="row" style={{ marginTop: '.5rem' }}>{(h.emergencyPhone || h.phone) && <a className="big" href={`tel:${h.emergencyPhone || h.phone}`}>{t('call')}</a>}
      <a className="big" href={`https://www.google.com/maps/dir/?api=1&destination=${h.location.coordinates[1]},${h.location.coordinates[0]}`} target="_blank" rel="noreferrer">{t('directions')}</a>
      <Link className="big" to={`/hospitals/${h._id}`}>Details</Link><Link className="big" to={`/complaints?hospital=${h._id}`}>{t('report')}</Link></div></article>)}</>;
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
    {err && <p className="err" role="alert">{err}</p>}<button className="b">{t('submit')}</button>{mode === 'login' && <p><Link to="/register">{t('register')}</Link> · <Link to="/otp">Phone code</Link> · <Link to="/forgot">Forgot password?</Link></p>}</form>;
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
    try { const r = await api('/complaints', { method: 'POST', form: out }); setMsg(`${r.complaintId} — ${r.status}`); e.target.reset(); load(); } catch (x) {
      const files = fd.getAll('evidence').filter((f) => f.size);
      if (!files.length && (!navigator.onLine || x instanceof TypeError)) {
        const body = Object.fromEntries([...out.entries()].filter(([, v]) => typeof v === 'string'));
        const queued = await queuedPost('/complaints', body).catch(() => null);
        setMsg(queued?.queued ? 'Complaint saved on this device. It will be sent when you are online.' : x.message);
      } else setMsg(!navigator.onLine ? 'Evidence files cannot be queued offline. Connect and submit again.' : x.message);
    }
  };
  return <><h2>{t('report')}</h2><form className="card" onSubmit={submit}><label htmlFor="cat">Type of problem</label><select id="cat" name="category" defaultValue={new URLSearchParams(location.search).get('category') || ''} required><option value="" disabled>Choose…</option>{cats.map((c) => <option key={c} value={c}>{c.replaceAll('_', ' ').toLowerCase()}</option>)}</select>
    <label htmlFor="d">What happened?</label><textarea id="d" name="description" rows="4" minLength="10" required /><label htmlFor="w">Date and time</label><input id="w" name="incidentAt" type="datetime-local" />
    <label htmlFor="ev">Evidence (photo, video, audio, PDF)</label><input id="ev" name="evidence" type="file" multiple accept="image/*,video/*,audio/*,application/pdf" /><button className="b">{t('submit')}</button>{msg && <p role="status">{msg}</p>}</form>
    <h3>{t('track')}</h3>{list.map((c) => <article className="card" key={c._id}><b>{c.complaintId}</b> <span className="tag">{c.status.replace('_', ' ')}</span><p>{c.history.map((h) => `${h.status} (${new Date(h.at).toLocaleDateString()})`).join(' → ')}</p></article>)}</>;
}

function Admin() {
  const [stats, setStats] = useState({}), [bars, setBars] = useState({}), [cs, setCs] = useState([]);
  const load = () => { api('/admin/analytics').then((a) => { setStats(a.totals); setBars({ ...a.complaintsByStatus, ...Object.fromEntries(Object.entries(a.appointmentsByStatus).map(([k, v]) => ['appt ' + k, v])) }); }); api('/admin/complaints').then(setCs); }; useEffect(load, []);
  const set = async (id, status) => { await api('/admin/complaints/' + id, { method: 'PATCH', body: { status } }); load(); };
  return <><h2>Admin dashboard</h2><Link className="big" to="/admin/tools">Verification, users, reviews, prices, audit log</Link><div className="grid">{Object.entries(stats).map(([k, v]) => <div className="card" key={k}><b style={{ fontSize: '1.8rem' }}>{v}</b><br />{k}</div>)}</div>
    <h3>Complaints and appointments by status</h3><div className="card" role="img" aria-label="Bar chart">{Object.entries(bars).map(([k, v]) => <div key={k} style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><span style={{ width: '9rem' }}>{k}</span><div style={{ background: 'var(--teal)', height: '1rem', width: Math.max(4, v * 20) + 'px', maxWidth: '60%' }} /><b>{v}</b></div>)}</div><a className="big" href="/api/admin/report.csv" download>Download report (CSV)</a><h3>Complaints</h3>{cs.map((c) => <article className="card" key={c._id}><b>{c.complaintId}</b> · {c.category} <span className="tag">{c.status}</span><p>{c.description}</p><label htmlFor={c._id}>Update status</label><select id={c._id} value="" onChange={(e) => set(c._id, e.target.value)}><option value="">Choose…</option>{['UNDER_REVIEW', 'ASSIGNED', 'INVESTIGATION', 'RESOLVED', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}</select></article>)}</>;
}

function Place() {
  const [path, setPath] = useState([]), [items, setItems] = useState([]);
  useEffect(() => { cachedGet('/locations?path=' + encodeURIComponent(path.join('>'))).then((s) => setItems(s.data.items)).catch(() => {}); }, [path]);
  const labels = ['Continent', 'Country', 'State', 'City', 'Area'], last = path.length >= 5 || (path.length && !items.length);
  return <><h2>Choose your area</h2><p className="stale">Sample location data for demonstration.</p><p>{path.join(' → ')}</p>
    {!last ? <><label>{labels[path.length]}</label><div className="grid">{items.map((i) => <button className="big" key={i} onClick={() => setPath([...path, i])}>{i}</button>)}</div></> : <HospitalList query={`area=${encodeURIComponent(path[path.length - 1])}&city=${encodeURIComponent(path[path.length - 2] || '')}`} />}
    {path.length > 0 && <button className="b" onClick={() => setPath(path.slice(0, -1))}>Back</button>}</>;
}
function Saved() {
  const [s, setS] = useState(null); useEffect(() => { cachedGet('/saved').then(setS).catch(() => setS({ data: { hospitals: [], doctors: [] } })); }, []);
  if (!s) return <p>…</p>;
  return <><h2>Saved facilities</h2>{s.fromCache && <p className="stale">Offline copy. It may be out of date.</p>}{s.data.hospitals.map((h) => <div className="card" key={h._id}><b>{h.name}</b> · {h.city}{h.emergencyPhone && <p><a href={`tel:${h.emergencyPhone}`}>Call {h.emergencyPhone}</a></p>}</div>)}{s.data.doctors.map((d) => <div className="card" key={d._id}><b>{d.user?.name}</b> · {d.specialization}</div>)}</>;
}
function Notifications() {
  const [l, setL] = useState([]); useEffect(() => { api('/notifications').then(setL).catch(() => {}); }, []);
  return <><h2>Notifications</h2>{!l.length && <p>No notifications yet.</p>}{l.map((n) => <div className="card" key={n._id}><b>{n.title}</b><p>{n.body}</p></div>)}</>;
}
function OfflineData() {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('c:')), [n, setN] = useState(0); const { pending } = useApp();
  return <><h2>Offline data</h2><p>{keys.length} saved pages on this device. Waiting to send: {pending}.</p>{keys.map((k) => <div className="card" key={k}>{k.slice(2)}<br /><span className="stale">Saved {new Date(JSON.parse(localStorage[k]).at).toLocaleString()}</span></div>)}<button className="b" onClick={() => { keys.forEach((k) => localStorage.removeItem(k)); setN(n + 1); }}>Clear saved pages</button></>;
}
function Forgot() {
  const [f, setF] = useState({}), [step, setStep] = useState(0), [m, setM] = useState('');
  const go = async (e) => { e.preventDefault(); try { await api(step ? '/auth/password/reset' : '/auth/password/forgot', { method: 'POST', body: f }); setM(step ? 'Password changed. You can log in now.' : 'If the account exists, a code was sent.'); setStep(1); } catch (x) { setM(x.message); } };
  return <form className="card" onSubmit={go}><h2>Reset password</h2><label htmlFor="fi">Email or phone</label><input id="fi" required onChange={(e) => setF({ ...f, identifier: e.target.value })} />
    {step === 1 && <><label htmlFor="fc">6-digit code</label><input id="fc" inputMode="numeric" maxLength="6" required onChange={(e) => setF({ ...f, code: e.target.value })} /><label htmlFor="fp">New password</label><input id="fp" type="password" minLength="8" required onChange={(e) => setF({ ...f, password: e.target.value })} /></>}<button className="b">Continue</button><p role="status">{m}</p></form>;
}
function OtpLogin() {
  const { setUser } = useApp(), nav = useNavigate(), [f, setF] = useState({}), [sent, setSent] = useState(false), [m, setM] = useState('');
  const go = async (e) => { e.preventDefault(); try { if (!sent) { await api('/auth/otp/request', { method: 'POST', body: f }); setSent(true); setM('Code sent.'); } else { setUser(await api('/auth/otp/verify', { method: 'POST', body: f })); nav('/'); } } catch (x) { setM(x.message); } };
  return <form className="card" onSubmit={go}><h2>Log in with phone code</h2><label htmlFor="op">Phone number</label><input id="op" required inputMode="tel" onChange={(e) => setF({ ...f, identifier: e.target.value })} />{sent && <><label htmlFor="oc">6-digit code</label><input id="oc" inputMode="numeric" maxLength="6" required onChange={(e) => setF({ ...f, code: e.target.value })} /></>}<button className="b">{sent ? 'Verify' : 'Send code'}</button><p role="status">{m}</p></form>;
}
function DoctorDash() {
  const [p, setP] = useState({}), [apps, setApps] = useState([]), [m, setM] = useState('');
  const load = () => { api('/doctors/me').then((d) => d && setP(d)).catch(() => {}); api('/appointments/mine').then(setApps).catch(() => {}); }; useEffect(load, []);
  const save = async (e) => { e.preventDefault(); const { _id, user, verified, rating, ratingCount, createdAt, updatedAt, __v, ...d } = p; await api('/doctors/me', { method: 'PUT', body: d }); setM('Saved. A government admin must verify your licence before the Verified badge shows.'); };
  const act = async (id, status) => { await api('/appointments/' + id, { method: 'PATCH', body: { status } }); load(); };
  const F = (k, l, type = 'text') => <><label htmlFor={k}>{l}</label><input id={k} type={type} value={p[k] ?? ''} onChange={(e) => setP({ ...p, [k]: type === 'number' ? +e.target.value : e.target.value })} /></>;
  return <><h2>Doctor dashboard</h2><p><span className="tag">{p.verified ? 'Verified Doctor' : 'Verification pending'}</span></p>
    <form className="card" onSubmit={save}>{F('qualification', 'Qualification')}{F('specialization', 'Specialization')}{F('licenseNo', 'Medical registration number')}{F('experience', 'Experience (years)', 'number')}{F('fee', 'Consultation fee', 'number')}<button className="b">Save profile</button><p role="status">{m}</p></form>
    <h3>Appointment requests</h3>{apps.map((a) => <div className="card" key={a._id}>{new Date(a.when).toLocaleString()} <span className="tag">{a.status}</span>{a.status === 'PENDING' && <><button className="b" onClick={() => act(a._id, 'ACCEPTED')}>Accept</button><button className="b" onClick={() => act(a._id, 'REJECTED')}>Reject</button></>}{a.status === 'ACCEPTED' && <><button className="b" onClick={() => act(a._id, 'COMPLETED')}>Mark completed</button><ChatBox id={a._id} /></>}</div>)}<DoctorFeedback id={p._id} /></>;
}
function HospitalDash() {
  const [d, setD] = useState(null), [none, setNone] = useState(false), [f, setF] = useState({ type: 'PRIVATE' }), [m, setM] = useState('');
  const load = () => api('/hospital/me').then(setD).catch((e) => e.status === 404 && setNone(true)); useEffect(() => { load(); }, []);
  const setBed = async (k, v) => { await api(`/hospitals/${d.hospital._id}/beds`, { method: 'PATCH', body: { [k]: v } }); load(); };
  const claim = async (e) => { e.preventDefault(); try { await api('/hospital/claim', { method: 'POST', body: { ...f, lat: +f.lat, lng: +f.lng } }); setNone(false); load(); } catch (x) { setM(x.message); } };
  if (none) return <form className="card" onSubmit={claim}><h2>Register your hospital</h2>{['name', 'city', 'area', 'phone', 'lat', 'lng'].map((k) => <div key={k}><label htmlFor={k}>{k}</label><input id={k} required={k !== 'area' && k !== 'phone'} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>)}<label htmlFor="ty2">Type</label><select id="ty2" onChange={(e) => setF({ ...f, type: e.target.value })}><option value="PRIVATE">Private</option><option value="GOVERNMENT">Government</option></select><button className="b">Submit for verification</button><p className="err">{m}</p></form>;
  if (!d) return <p>…</p>;
  return <><h2>{d.hospital.name}</h2><span className="tag">{d.hospital.verified ? 'Verified' : 'Verification pending'}</span>
    <h3>Bed availability</h3>{['general', 'icu', 'emergency', 'pediatric', 'maternity'].map((k) => <div className="card" key={k}><b>{k}</b> <span className={`tag ${d.hospital.beds?.[k]?.status || 'FULL'}`}>{d.hospital.beds?.[k]?.status || 'NOT SET'}</span><br />{['AVAILABLE', 'LIMITED', 'FULL'].map((v) => <button key={v} className="b" onClick={() => setBed(k, v)}>{v}</button>)}</div>)}
    <PriceEditor key={'p' + (d.hospital.prices?.length || 0)} id={d.hospital._id} prices={d.hospital.prices || []} done={load} /><HospitalProfile h={d.hospital} done={load} /><h3>Complaints about this hospital</h3>{d.complaints.map((c) => <div className="card" key={c.complaintId}>{c.complaintId} · {c.category} <span className="tag">{c.status}</span></div>)}
    <h3>Doctors</h3>{d.doctors.map((x) => <div className="card" key={x._id}>{x.user?.name} · {x.specialization}</div>)}</>;
}

function ChatBox({ id }) {
  const [d, setD] = useState({ open: false, messages: [] }), [text, setText] = useState(''), [err, setErr] = useState('');
  const load = () => api(`/appointments/${id}/messages`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [id]);
  const send = async (e) => { e.preventDefault(); try { await api(`/appointments/${id}/messages`, { method: 'POST', body: { text } }); setText(''); setErr(''); load(); } catch (x) { setErr(x.message); } };
  return <div className="card" aria-live="polite"><b>Messages</b> <span className="tag">{d.open ? 'Doctor available now' : 'Outside consultation hours'}</span>
    {d.messages.map((m) => <p key={m._id}>{m.text}<br /><span className="stale">{new Date(m.createdAt).toLocaleString()}</span></p>)}
    <form onSubmit={send}><label htmlFor={'m' + id}>Write a message</label><textarea id={'m' + id} rows="2" maxLength="1000" value={text} onChange={(e) => setText(e.target.value)} required /><button className="b" disabled={!d.open}>Send</button></form>
    {err && <p className="err" role="alert">{err}</p>}<p className="stale">Do not use chat for emergencies. Call 108 or 112.</p></div>;
}
function ReviewForm({ id, done }) {
  const keys = ['communication', 'waiting', 'facilities', 'transparency', 'overall'], [sc, setSc] = useState(Object.fromEntries(keys.map((k) => [k, 5]))), [text, setText] = useState(''), [m, setM] = useState('');
  const go = async (e) => { e.preventDefault(); try { await api('/reviews', { method: 'POST', body: { appointment: id, text, scores: sc } }); setM('Thank you for your feedback.'); done(); } catch (x) { setM(x.message); } };
  return <form className="card" onSubmit={go}><b>Rate this visit</b>{keys.map((k) => <div key={k}><label htmlFor={k + id}>{k}</label><select id={k + id} value={sc[k]} onChange={(e) => setSc({ ...sc, [k]: +e.target.value })}>{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select></div>)}
    <label htmlFor={'t' + id}>Comments (optional)</label><textarea id={'t' + id} maxLength="1000" value={text} onChange={(e) => setText(e.target.value)} /><button className="b">Submit feedback</button><p role="status">{m}</p></form>;
}
function Appointments() {
  const [l, setL] = useState(null), [open, setOpen] = useState(null); const load = () => api('/appointments/mine').then(setL).catch(() => setL([])); useEffect(() => { load(); }, []);
  if (!l) return <p>…</p>;
  return <><h2>My appointments</h2>{!l.length && <p>No appointments yet. <Link to="/doctors">Find a doctor</Link></p>}{l.map((a) => <article className="card" key={a._id}><b>{new Date(a.when).toLocaleString()}</b> <span className="tag">{a.status}</span><p>{a.doctor?.specialization}</p>
    {a.status === 'ACCEPTED' && <button className="b" onClick={() => setOpen(open === a._id ? null : a._id)}>Messages</button>}{open === a._id && <ChatBox id={a._id} />}{a.status === 'COMPLETED' && <ReviewForm id={a._id} done={load} />}</article>)}</>;
}
function DoctorFeedback({ id }) {
  const [l, setL] = useState([]), [t, setT] = useState({}); const load = () => api(`/doctors/${id}/reviews`).then(setL).catch(() => {}); useEffect(() => { id && load(); }, [id]);
  const reply = async (rid) => { await api(`/reviews/${rid}/reply`, { method: 'POST', body: { text: t[rid] } }); load(); };
  return <><h3>Patient feedback</h3>{!l.length && <p>No feedback yet.</p>}{l.map((r) => <div className="card" key={r._id}>Overall {r.scores?.overall}/5 · {r.text}{r.reply ? <p><b>Your reply:</b> {r.reply.text}</p> : <><label htmlFor={'r' + r._id}>Reply</label><input id={'r' + r._id} onChange={(e) => setT({ ...t, [r._id]: e.target.value })} /><button className="b" onClick={() => reply(r._id)}>Post reply</button></>}</div>)}</>;
}
function Settings() {
  const { user, lang, setLang, low, setLow, t } = useApp(), [m, setM] = useState('');
  return <><h2>Settings</h2><div className="card"><p>Signed in as <b>{user.name}</b> ({user.role})</p>
    <label htmlFor="sl">Language</label><select id="sl" value={lang} onChange={(e) => setLang(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी</option></select>
    <label><input type="checkbox" style={{ width: 'auto' }} checked={low} onChange={(e) => setLow(e.target.checked)} /> {t('lowdata')}</label>
    <button className="b" onClick={async () => { await api('/auth/logout-all', { method: 'POST' }); setM('Logged out on all devices. Please log in again.'); setTimeout(() => location.assign('/login'), 1200); }}>Log out from all devices</button><p role="status">{m}</p></div></>;
}
function VoiceButton() {
  const { lang } = useApp(), nav = useNavigate(), [msg, setMsg] = useState(''), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const listen = () => { const r = new SR(); r.lang = lang === 'hi' ? 'hi-IN' : 'en-IN'; r.onresult = (e) => { const to = voiceRoute(e.results[0][0].transcript); to ? nav(to) : setMsg('Sorry, I did not understand.'); }; r.onerror = () => setMsg('Voice not available.'); r.start(); setMsg('Listening…'); };
  return <><button className="b" onClick={listen} aria-label="Voice navigation">🎤</button><span role="status">{msg}</span></>;
}

function AdminTools() {
  const [tab, setTab] = useState('verify'), [d, setD] = useState({}), [q, setQ] = useState(''), [msg, setMsg] = useState('');
  const load = () => {
    if (tab === 'verify') api('/admin/queue').then(setD);
    if (tab === 'users') api('/admin/users?q=' + encodeURIComponent(q)).then((u) => setD({ users: u }));
    if (tab === 'reviews') api('/admin/reviews').then((r) => setD({ reviews: r }));
    if (tab === 'prices') api('/admin/price-outliers').then((p) => setD({ prices: p }));
    if (tab === 'audit') api('/admin/audit').then((a) => setD({ audit: a }));
  };
  useEffect(() => { setD({}); load(); }, [tab]);
  const act = async (fn) => { try { await fn(); setMsg('Done'); load(); } catch (e) { setMsg(e.message); } };
  const verify = (kind, id, v) => act(() => api(`/admin/verify/${kind}/${id}`, { method: 'PATCH', body: { verified: v } }));
  return <><h2>Admin tools</h2><div className="row" role="tablist">{[['verify', 'Verification'], ['users', 'Users'], ['reviews', 'Flagged reviews'], ['prices', 'Price monitoring'], ['audit', 'Audit log']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className="b" onClick={() => setTab(k)}>{l}</button>)}</div><p role="status">{msg}</p>
    {tab === 'verify' && <><h3>Doctors waiting</h3>{d.doctors?.map((x) => <div className="card" key={x._id}><b>{x.user?.name}</b> · {x.specialization} · Licence {x.licenseNo || 'not given'}<br /><button className="b" onClick={() => act(async () => setMsg(JSON.stringify((await api(`/admin/doctors/${x._id}/check-license`, { method: 'POST' })).notice)))}>Check licence (demo)</button><button className="b" onClick={() => verify('doctor', x._id, true)}>Verify</button></div>)}
      <h3>Hospitals waiting</h3>{d.hospitals?.map((x) => <div className="card" key={x._id}><b>{x.name}</b> · {x.city} · {x.type}<br /><button className="b" onClick={() => verify('hospital', x._id, true)}>Verify</button></div>)}</>}
    {tab === 'users' && <><label htmlFor="uq">Search name</label><input id="uq" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />{d.users?.map((u) => <div className="card" key={u._id}><b>{u.name}</b> · {u.email || u.phone} <span className="tag">{u.role}</span>{u.suspended && <span className="tag FULL">Suspended</span>}<br /><button className="b" onClick={() => confirm('Change account status?') && act(() => api(`/admin/users/${u._id}/suspend`, { method: 'PATCH', body: { suspended: !u.suspended } }))}>{u.suspended ? 'Reinstate' : 'Suspend'}</button></div>)}</>}
    {tab === 'reviews' && (d.reviews?.length ? d.reviews.map((r) => <div className="card" key={r._id}>{r.text || '(no text)'}<br /><button className="b" onClick={() => act(() => api(`/admin/reviews/${r._id}`, { method: 'PATCH', body: { hidden: true } }))}>Hide</button><button className="b" onClick={() => act(() => api(`/admin/reviews/${r._id}`, { method: 'PATCH', body: { hidden: false } }))}>Keep</button></div>) : <p>Nothing flagged.</p>)}
    {tab === 'prices' && <><p className="stale">Prices far above the median for the same service. This is a reason to look closer, not a finding of wrongdoing.</p>{d.prices?.map((p, i) => <div className="card" key={i}>{p.hospital}: {p.service} ₹{p.amount} (median ₹{p.median})</div>)}</>}
    {tab === 'audit' && d.audit?.map((a) => <div className="card" key={a._id}><b>{a.action}</b> · {a.target} <span className="stale">{new Date(a.createdAt).toLocaleString()}</span></div>)}</>;
}

function HospitalDetail() {
  const { id } = useParams(), { t, user } = useApp(), [s, setS] = useState(null), [m, setM] = useState('');
  useEffect(() => { cachedGet('/hospitals/' + id).then(setS).catch(() => setS({ data: null })); }, [id]);
  if (!s) return <p>…</p>; const h = s.data; if (!h) return <p>Hospital not found, or you are offline and have not opened it before.</p>;
  const save = async () => { try { await api(`/saved/hospital/${id}`, { method: 'PUT' }); setM('Saved'); } catch (e) { setM(e.message); } };
  return <><h2>{h.name}</h2><span className="tag">{h.verified ? t('verified') : t('unverified')}</span><span className="tag">{h.type}</span>{s.fromCache && <p className="card stale">Availability could not be verified. Please contact the facility before travelling.</p>}
    <div className="card"><p>{h.address} {h.area} {h.city} {h.pincode}</p><p>Hours: {h.hours || 'Not provided'}</p>{h.phone && <a className="big" href={`tel:${h.phone}`}>{t('call')} {h.phone}</a>}
      {h.departments?.length > 0 && <p><b>Departments:</b> {h.departments.join(', ')}</p>}{h.facilities?.length > 0 && <p><b>Facilities:</b> {h.facilities.join(', ')}</p>}{h.schemes?.length > 0 && <p><b>Government schemes:</b> {h.schemes.join(', ')}</p>}
      <p>{Object.entries(h.beds || {}).map(([k, b]) => <span key={k} className={`tag ${b.status}`}>{k}: {b.status}</span>)}</p>{h.beds?.general && <Freshness at={h.beds.general.updatedAt} fromCache={s.fromCache} />}</div>
    <h3>Declared prices</h3><div className="card">{h.prices?.length ? <table style={{ width: '100%' }}><thead><tr><th align="left">Service</th><th align="right">Price</th><th align="left">Rule</th><th align="left">Updated</th><th align="left">Status</th></tr></thead><tbody>{h.prices.map((p, i) => <tr key={i}><td>{p.service}</td><td align="right">₹{p.amount}</td><td>{p.rule || '—'}</td><td>{new Date(p.updatedAt).toLocaleDateString()}</td><td>{p.verified ? 'Verified' : 'Declared by hospital'}</td></tr>)}</tbody></table> : <p>This hospital has not published prices yet.</p>}
      <p className="stale">Prices are declared by the hospital and may change. If you were charged differently, you can tell the authorities.</p><Link className="big" to={`/complaints?hospital=${id}&category=EXCESSIVE_CHARGE`}>{t('pricing')}</Link></div>
    <div className="row">{user && <button className="b" onClick={save}>Save hospital</button>}<a className="big" href={`https://www.google.com/maps/dir/?api=1&destination=${h.location.coordinates[1]},${h.location.coordinates[0]}`} target="_blank" rel="noreferrer">{t('directions')}</a></div><p role="status">{m}</p></>;
}
function PriceEditor({ id, prices, done }) {
  const [rows, setRows] = useState(prices.map(({ service, amount, rule }) => ({ service, amount, rule: rule || '' }))), [m, setM] = useState('');
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => { try { await api(`/hospitals/${id}/prices`, { method: 'PUT', body: rows.filter((r) => r.service).map((r) => ({ service: r.service, amount: +r.amount, ...(r.rule && { rule: r.rule }) })) }); setM('Published. Shown as "Declared by hospital" until verified.'); done(); } catch (e) { setM(e.message); } };
  return <><h3>Published prices</h3><div className="card">{rows.map((r, i) => <div className="row" key={i}><input aria-label="Service" placeholder="Service" value={r.service} onChange={(e) => set(i, 'service', e.target.value)} /><input aria-label="Price in rupees" type="number" min="0" placeholder="₹" value={r.amount} onChange={(e) => set(i, 'amount', e.target.value)} /><input aria-label="Government rule or scheme" placeholder="Rule / scheme (optional)" value={r.rule} onChange={(e) => set(i, 'rule', e.target.value)} /></div>)}
    <button className="b" onClick={() => setRows([...rows, { service: '', amount: '', rule: '' }])}>Add row</button><button className="b" onClick={save}>Publish prices</button><p role="status">{m}</p></div></>;
}
function HospitalProfile({ h, done }) {
  const [f, setF] = useState({ phone: h.phone || '', emergencyPhone: h.emergencyPhone || '', hours: h.hours || '', departments: (h.departments || []).join(', '), facilities: (h.facilities || []).join(', '), schemes: (h.schemes || []).join(', '), emergency: !!h.emergency }), [m, setM] = useState('');
  const list = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const save = async (e) => { e.preventDefault(); try { await api('/hospital/me', { method: 'PUT', body: { ...f, departments: list(f.departments), facilities: list(f.facilities), schemes: list(f.schemes) } }); setM('Saved'); done(); } catch (x) { setM(x.message); } };
  const T = (k, l) => <><label htmlFor={'hp' + k}>{l}</label><input id={'hp' + k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></>;
  return <><h3>Hospital profile</h3><form className="card" onSubmit={save}>{T('phone', 'Phone')}{T('emergencyPhone', 'Emergency phone')}{T('hours', 'Working hours')}{T('departments', 'Departments (comma separated)')}{T('facilities', 'Facilities (comma separated)')}{T('schemes', 'Government schemes accepted (comma separated)')}
    <label><input type="checkbox" style={{ width: 'auto' }} checked={f.emergency} onChange={(e) => setF({ ...f, emergency: e.target.checked })} /> Emergency services available</label><button className="b">Save profile</button><p role="status">{m}</p></form></>;
}
const PAGES = {
  about: ['About HealthConnect', ['HealthConnect helps you find hospitals, doctors, beds, blood and ambulances near you, see declared prices, and report problems.', 'It is an information and coordination platform. It does not diagnose illness or prescribe medicine.', 'Hospitals and doctors show a Verified badge only after a government administrator has checked them.']],
  how: ['How it works', ['1. Choose what help you need, or press Emergency.', '2. See matching facilities with the time their information was last updated.', '3. Call the facility to confirm before you travel. Availability can change quickly.', '4. After a visit, rate it. If something went wrong, report it with evidence and track the complaint.']],
  emergencyinfo: ['Emergency information', ['Call 108 (ambulance), 112 (unified emergency) or 102 (ambulance) now if someone is seriously ill or injured.', 'Do not wait for a website to load. Use the Emergency button for nearby hospitals.', 'This app cannot judge how serious a medical problem is. Emergency staff can.']],
  services: ['Healthcare services', ['Hospitals and clinics, doctor consultations, blood banks, ambulances, diagnostic tests, child and women\'s healthcare, and government healthcare schemes.']],
};
function Info({ page }) { const [title, lines] = PAGES[page]; return <><h2>{title}</h2>{lines.map((l) => <p className="card" key={l}>{l}</p>)}{page === 'emergencyinfo' && <div className="grid"><a className="big sos" href="tel:108">Call 108</a><a className="big" href="tel:112">Call 112</a></div>}</>; }

export default function App() {
  return <Provider><Layout><Routes>
    <Route path="/" element={<Home />} /><Route path="/emergency" element={<Emergency />} /><Route path="/hospitals" element={<Hospitals />} /><Route path="/doctors" element={<Doctors />} />
    <Route path="/blood" element={<Blood />} /><Route path="/ambulance" element={<Ambulance />} /><Route path="/help" element={<Guided />} /><Route path="/schemes" element={<Schemes />} />
    <Route path="/login" element={<Auth mode="login" />} /><Route path="/forgot" element={<Forgot />} /><Route path="/otp" element={<OtpLogin />} /><Route path="/place" element={<Place />} /><Route path="/offline-data" element={<OfflineData />} />
    <Route path="/saved" element={<Guard><Saved /></Guard>} /><Route path="/notifications" element={<Guard><Notifications /></Guard>} /><Route path="/doctor" element={<Guard roles={['DOCTOR']}><DoctorDash /></Guard>} /><Route path="/hospital" element={<Guard roles={['HOSPITAL_ADMIN']}><HospitalDash /></Guard>} />
    <Route path="/appointments" element={<Guard roles={['PATIENT']}><Appointments /></Guard>} /><Route path="/settings" element={<Guard><Settings /></Guard>} />
    <Route path="/admin/tools" element={<Guard roles={['GOVERNMENT_ADMIN']}><AdminTools /></Guard>} />
    <Route path="/hospitals/:id" element={<HospitalDetail />} /><Route path="/about" element={<Info page="about" />} /><Route path="/how-it-works" element={<Info page="how" />} /><Route path="/emergency-info" element={<Info page="emergencyinfo" />} /><Route path="/services" element={<Info page="services" />} />
    <Route path="/register" element={<Auth mode="register" />} />
    <Route path="/complaints" element={<Guard><Complaints /></Guard>} /><Route path="/admin" element={<Guard roles={['GOVERNMENT_ADMIN']}><Admin /></Guard>} />
  </Routes></Layout></Provider>;
}
