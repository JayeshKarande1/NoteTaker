import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, CloudOff, FileText, Headphones, Leaf, LoaderCircle, LockKeyhole, Menu, Mic, MoreHorizontal, Pause, Plus, Search, ShieldCheck, Sparkles, Square, Star, Trash2, WifiOff, X } from 'lucide-react';
import { noteStore } from './store';
import type { Language, Note } from './types';

const duration = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const dateLabel = (time: number) => new Date(time).toLocaleDateString('en', { month: 'short', day: 'numeric' });
const fullDate = (time: number) => new Date(time).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' });
const titleOf = (note: Note) => note.title.trim() || 'Untitled note';
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Logo({ small = false }: { small?: boolean }) {
  return <span className={`logo ${small ? 'small' : ''}`}><AudioLines strokeWidth={2.3} /></span>;
}
function Waveform({ active = false, level = 0 }: { active?: boolean; level?: number }) {
  return <div className={`waveform ${active ? 'active' : ''}`} aria-hidden="true">{Array.from({ length: 53 }, (_, i) => {
    const envelope = Math.sin((i / 52) * Math.PI);
    const height = 5 + envelope * (12 + Math.abs(Math.sin(i * 1.74)) * 42);
    return <span key={i} style={{ height: `${height * (active ? 0.55 + level * 1.8 : 1)}px`, animationDelay: `${i * -0.09}s` }} />;
  })}</div>;
}
export function App() {
  const state = useSyncExternalStore(noteStore.subscribe, noteStore.snapshot);
  const [language, setLanguage] = useState<Language>('en');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'starred'>('all');
  const [sidebar, setSidebar] = useState(false);
  const [modal, setModal] = useState<'setup' | 'privacy' | 'delete' | 'retry' | null>(null);
  const [menu, setMenu] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [installEvent, setInstallEvent] = useState<Event & { prompt: () => Promise<void> } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const transcriptRef = useRef<HTMLTextAreaElement>(null);
  const selected = state.notes.find((n) => n.id === state.selected);
  const busy = !!state.recording || state.starting || !!state.processing;
  const locked = selected?.id === state.recording || selected?.id === state.processing;
  const notes = state.notes.filter((n) => (filter !== 'starred' || n.starred) && `${n.title} ${n.text}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const handle = (promise: Promise<unknown>) => { void promise.catch((error) => setUiError(error instanceof Error ? error.message : String(error))); };

  useEffect(() => { void noteStore.init(); }, []);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    const install = (event: Event) => { event.preventDefault(); setInstallEvent(event as typeof installEvent); };
    window.addEventListener('online', on); window.addEventListener('offline', on); window.addEventListener('beforeinstallprompt', install);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); window.removeEventListener('beforeinstallprompt', install); };
  }, []);
  useEffect(() => { if (modal) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [modal]);
  useEffect(() => { setAudioUrl(null); setMenu(false); }, [selected?.id]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => {
    if (locked && transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [selected?.text, locked]);
  const openNote = (id: string) => { handle(noteStore.select(id)); setSidebar(false); };
  const showLibrary = (view: 'all' | 'starred') => { setFilter(view); handle(noteStore.select(null)); setSidebar(false); };
  const record = () => { if (state.setup !== 'ready') setModal('setup'); else handle(noteStore.start(language)); };
  const openAudio = async () => {
    if (!selected) return;
    setAudioLoading(true);
    try { setAudioUrl(URL.createObjectURL(await noteStore.audioBlob(selected.id))); } finally { setAudioLoading(false); }
  };
  const downloadText = () => { if (selected) download(new Blob([`${titleOf(selected)}\n${fullDate(selected.createdAt)}\n\n${selected.text}\n`], { type: 'text/plain;charset=utf-8' }), `${titleOf(selected).replace(/[^\p{L}\p{N}\s-]/gu, '') || 'note'}.txt`); setMenu(false); };
  const recordingControls = <>
    <div className="recording-live"><span className={state.paused ? 'status-dot paused' : 'status-dot recording'} />{state.paused ? 'Paused' : 'Listening'}<span className="recording-timer">{duration(state.elapsed)}</span></div>
    <Waveform active={!state.paused} level={state.level} />
    <div className="recording-buttons"><button className="secondary-button" onClick={noteStore.pause} disabled={state.stopping}><Pause size={16} />{state.paused ? 'Resume' : 'Pause'}</button><button className="primary-button" onClick={() => handle(noteStore.stop())} disabled={state.stopping}>{state.stopping ? <LoaderCircle className="spin" size={16} /> : <Square size={14} fill="currentColor" />}{state.stopping ? 'Saving…' : 'Finish note'}</button></div>
  </>;
  return <div className="app-shell">
    {sidebar && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
      <a className="brand" href="#" onClick={(e) => { e.preventDefault(); showLibrary('all'); }}><Logo /><span>stillnote<span className="brand-period">.</span></span></a>
      <div className="workspace-label"><span className="workspace-avatar">M</span><div>My workspace<small>A space of your own</small></div><LockKeyhole size={13} /></div>
      <button className="new-note-button" aria-label="New note" onClick={() => handle(noteStore.create(language))} disabled={busy || !state.loaded}><Plus size={18} />New note<span>+</span></button>
      <div className="nav-label">YOUR SPACE</div>
      <nav aria-label="Notes navigation">
        <button className={`nav-item ${filter === 'all' && !selected ? 'selected' : ''}`} onClick={() => showLibrary('all')}><FileText size={18} />All notes<span>{state.notes.length}</span></button>
        <button className={`nav-item ${filter === 'starred' && !selected ? 'selected' : ''}`} onClick={() => showLibrary('starred')}><Star size={18} />Starred<span>{state.notes.filter((n) => n.starred).length}</span></button>
      </nav>
      <div className="sidebar-recent"><div className="nav-label">RECENT NOTES</div>{state.notes.slice(0, 5).map((note) => <button key={note.id} className={`recent-note ${selected?.id === note.id ? 'current' : ''}`} onClick={() => openNote(note.id)}><span className="note-dot" /><span>{titleOf(note)}</span>{note.id === state.recording && <span className="status-dot recording" />}</button>)}{!state.notes.length && <p className="sidebar-empty">Your next thought belongs here.</p>}</div>
      <div className="sidebar-bottom"><div className="private-card"><span className="private-icon"><ShieldCheck size={19} /></span><strong>Your thoughts. Yours only.</strong><p>Stored on this device.<br />Never sent to the cloud.</p><button onClick={() => setModal('privacy')}>A little peace of mind <ArrowRight size={13} /></button></div><button className="sidebar-settings" onClick={() => setModal('setup')}><span className={`status-dot ${state.setup === 'ready' ? 'ready' : ''}`} />{state.setup === 'ready' ? 'Offline ready' : 'Offline setup'}<ChevronRight size={15} /></button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open sidebar" onClick={() => setSidebar(true)}><Menu size={20} /></button><span>My workspace</span><ChevronRight size={14} /><strong>{selected ? 'Note' : filter === 'starred' ? 'Starred' : 'All notes'}</strong></div><div className="topbar-actions"><span className="local-badge"><span className="status-dot ready" />{online ? 'Private by nature' : 'You’re offline'}</span><button className="icon-button" aria-label="About privacy and local storage" onClick={() => setModal('privacy')}><CircleHelp size={18} /></button><span className="profile-avatar" title="Your local workspace">M</span></div></header>
      <main>
        {(state.error || uiError) && <div className="error-banner" role="alert"><span>{uiError || state.error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => { setUiError(null); noteStore.clearError(); }}><X size={17} /></button></div>}
        {!selected ? <div className="home-content">
          <section className="welcome"><div className="eyebrow"><span /> A CLEARER MIND STARTS HERE</div><h1>A little room for<br /><em>everything on your mind.</em></h1><p>Say it out loud. We’ll keep it safe.</p><div className="hero-doodle" aria-hidden="true"><Leaf /><span className="doodle-circle" /><span className="doodle-spark">✳</span></div></section>
          <section className={`capture-card ${state.recording ? 'is-recording' : ''}`} aria-label="Voice recording">
            <div className="capture-heading"><span><span className="tiny-mic"><Mic size={16} /></span>YOUR NEXT THOUGHT</span><span className="pill"><LockKeyhole size={11} />Only on your device</span></div>
            {state.recording ? <div className="capture-body">{recordingControls}<button className="text-button" onClick={() => openNote(state.recording!)}>Open live transcript <ArrowRight size={14} /></button></div> : <div className="capture-body"><Waveform /><h2>Good ideas don’t wait.</h2><p>A passing thought, a big idea, or a little reminder.<br />Just press record and make some space.</p><button className="primary-button record-button" onClick={record} disabled={state.starting || !!state.processing || !state.loaded}>{state.starting ? <LoaderCircle size={19} className="spin" /> : <Mic size={19} />}{state.starting ? 'Opening microphone…' : 'Start recording'}<span className="button-arrow"><ArrowRight size={16} /></span></button><div className="record-options"><label><span className="language-glyph">अ<span>A</span></span><select aria-label="Recording language" value={language} onChange={(e) => setLanguage(e.target.value as Language)}><option value="en">English</option><option value="hi">Hindi · हिन्दी</option></select><ChevronDown size={12} /></label><span className="option-divider" /><span>Let your thoughts flow</span></div></div>}
            <div className="capture-footer"><span><Check size={13} />{state.setup === 'ready' ? 'Works offline' : 'Works offline after setup'}</span><span><Check size={13} />English & Hindi</span><span><Check size={13} />No account needed</span></div>
          </section>
          {state.setup !== 'ready' && <div className="setup-strip"><span className="setup-icon"><ArrowDownToLine size={18} /></span><div><strong>{state.setup === 'loading' ? 'Making room for offline magic…' : 'Your voice, without the internet.'}</strong><p>{state.setup === 'loading' ? state.setupDetail : 'Download the speech engine once. Keep your thoughts close, always.'}</p>{state.setup === 'loading' && <progress max="100" value={state.progress} aria-label="Speech model download" />}</div><button onClick={() => setModal('setup')}>{state.setup === 'loading' ? `${Math.round(state.progress)}%` : 'Set up offline'}<ArrowRight size={15} /></button></div>}
          <section className="notes-section"><div className="section-heading"><div><h2>{filter === 'starred' ? 'Your favorites' : 'Your notes'}<span>{notes.length}</span></h2><p>{filter === 'starred' ? 'The thoughts you want to keep close.' : 'Little moments. Bigger possibilities.'}</p></div><label className="search-field"><Search size={16} /><input aria-label="Search notes" placeholder="Find a thought…" value={search} onChange={(e) => setSearch(e.target.value)} />{search && <button className="icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label></div>
            {!state.loaded ? <div className="empty-notes"><LoaderCircle className="spin" /><p>Opening your workspace…</p></div> : notes.length ? <div className="notes-grid">{notes.map((note) => <article className="note-card" key={note.id}><button className="note-card-main" onClick={() => openNote(note.id)}><div className="note-card-top"><span className="note-type-icon">{note.duration ? <AudioLines size={18} /> : <FileText size={18} />}</span><span>{dateLabel(note.createdAt)}</span></div><h3>{titleOf(note)}</h3><p lang={note.language}>{note.text || (note.status === 'recording' ? 'Your thoughts are taking shape…' : 'A fresh page, ready for your thoughts.')}</p><div className="note-card-bottom"><span>{note.duration ? <><Clock3 size={12} />{duration(note.duration)}</> : 'Written note'}</span><span>{note.language === 'hi' ? 'हिन्दी' : 'English'}<ChevronRight size={13} /></span></div></button><button className={`note-star icon-button ${note.starred ? 'is-starred' : ''}`} aria-label={note.starred ? `Unstar ${titleOf(note)}` : `Star ${titleOf(note)}`} onClick={() => noteStore.edit(note.id, { starred: !note.starred })}><Star size={15} fill={note.starred ? 'currentColor' : 'none'} /></button></article>)}</div> : <div className="empty-notes"><div className="empty-note-icon"><FileText size={25} /><span><Plus size={11} /></span></div><h3>{search ? 'No matching thoughts' : filter === 'starred' ? 'Keep the good ones close.' : 'Every great idea starts somewhere.'}</h3><p>{search ? 'Try another word or clear your search.' : filter === 'starred' ? 'Star a note and it will be waiting here.' : 'Record your first thought, or start with a blank page.'}</p>{!search && filter === 'all' && <button className="text-button" onClick={() => handle(noteStore.create(language))} disabled={busy}>Write a note instead <ArrowRight size={14} /></button>}</div>}
          </section>
          <footer className="workspace-footer"><Leaf size={14} /><span>A quieter place for a busy mind.</span><span className="footer-right">Made for your train of thought.</span></footer>
        </div> : <div className="editor-content"><div className="editor-toolbar"><button className="text-button back-button" onClick={() => handle(noteStore.select(null))}><ArrowLeft size={16} />All notes</button><div className="editor-actions"><span className="saved-label">{state.saving ? <LoaderCircle size={14} className="spin" /> : <CheckCheck size={15} />}{state.saving ? 'Saving…' : 'Saved on this device'}</span><button className={`icon-button ${selected.starred ? 'is-starred' : ''}`} aria-label={selected.starred ? 'Unstar note' : 'Star note'} onClick={() => noteStore.edit(selected.id, { starred: !selected.starred })}><Star size={18} fill={selected.starred ? 'currentColor' : 'none'} /></button><div className="menu-wrap"><button className="icon-button" aria-label="Note actions" aria-expanded={menu} onClick={() => setMenu(!menu)}><MoreHorizontal size={20} /></button>{menu && <><button className="menu-dismiss" aria-label="Close note actions" onClick={() => setMenu(false)} /><div className="dropdown-menu"><button onClick={downloadText}><ArrowDownToLine size={15} />Download text</button>{selected.duration > 0 && <button onClick={() => { handle(noteStore.audioBlob(selected.id).then((blob) => download(blob, `${titleOf(selected)}.wav`))); setMenu(false); }}><Headphones size={15} />Download audio</button>}<button disabled={locked || busy || !selected.duration} onClick={() => { setModal('retry'); setMenu(false); }}><AudioLines size={15} />Transcribe again</button><button className="danger-text" disabled={locked} onClick={() => { setModal('delete'); setMenu(false); }}><Trash2 size={15} />Delete note</button></div></>}</div></div></div>
          <article className="editor-paper"><div className="eyebrow"><span />{selected.duration || locked ? 'A THOUGHT, CAPTURED' : 'A LITTLE SPACE TO THINK'}</div><input className="note-title" aria-label="Note title" readOnly={locked} value={selected.title} placeholder="Untitled note" maxLength={200} onChange={(e) => noteStore.edit(selected.id, { title: e.target.value })} /><div className="note-meta"><span>{fullDate(selected.createdAt)}</span><span>·</span><span>{selected.language === 'hi' ? 'हिन्दी' : 'English'}</span>{selected.duration > 0 && <><span>·</span><span><Clock3 size={13} />{duration(selected.duration)}</span></>}</div>
            {selected.status === 'interrupted' && !locked && <div className="recovery-banner"><span>This session was interrupted. Your saved audio is still here.</span><button onClick={() => setModal('retry')}>Recover transcript <ArrowRight size={14} /></button></div>}
            <textarea ref={transcriptRef} className="transcript" lang={selected.language} aria-label="Note transcript" placeholder={locked ? 'Take a breath. Start anywhere.\nYour words will appear here as you speak…' : 'What’s on your mind?\nThis space is yours.'} value={selected.text} readOnly={locked} onChange={(e) => noteStore.edit(selected.id, { text: e.target.value })} />
            <div className="editor-paper-footer"><span>{selected.text.trim() ? selected.text.trim().split(/\s+/).length : 0} words</span><span><LockKeyhole size={12} />Just between you and this device</span><button className="text-button" disabled={!selected.text} onClick={() => { handle(navigator.clipboard.writeText(selected.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })); }}>{copied ? 'Copied!' : 'Copy text'}</button></div>
          </article>
          {state.recording === selected.id ? <section className="editor-recorder" aria-label="Active recording">{recordingControls}</section> : state.processing === selected.id ? <div className="processing-panel" role="status"><LoaderCircle className="spin" size={21} /><div><strong>Your words are taking shape.</strong><p>{state.pending} {state.pending === 1 ? 'segment' : 'segments'} remaining. You can browse other notes while we finish.</p></div></div> : <div className="editor-bottom"><div className="audio-section">{selected.duration > 0 ? audioUrl ? <audio controls src={audioUrl} aria-label="Saved recording" /> : <button className="secondary-button" onClick={() => handle(openAudio())} disabled={audioLoading}>{audioLoading ? <LoaderCircle className="spin" size={17} /> : <Headphones size={17} />}Listen to recording<span>{duration(selected.duration)}</span></button> : <span className="soft-caption"><Leaf size={15} />One thought at a time.</span>}</div><button className="primary-button" onClick={record} disabled={busy}><Mic size={17} />New voice note</button></div>}
          {locked && <p className="processing-caption" role="status">{state.pending > 0 ? `${state.pending} speech ${state.pending === 1 ? 'segment' : 'segments'} processing on your device. Text appears with a short delay.` : 'Listening for your next thought. Text appears after a short pause.'}</p>}
        </div>}
      </main>
      {state.recording && state.selected !== state.recording && <button className="floating-recording" onClick={() => openNote(state.recording!)}><span className="status-dot recording" />Recording · {duration(state.elapsed)}<ArrowRight size={15} /></button>}
    </div>
    <dialog ref={dialogRef} className="modal" onCancel={() => setModal(null)} onClick={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
      <div className="modal-inner"><button className="icon-button modal-close" aria-label="Close dialog" onClick={() => setModal(null)}><X size={20} /></button>
        {modal === 'setup' && <><span className="modal-symbol"><CloudOff size={27} /></span><div className="eyebrow">A ONE-TIME HELLO TO THE INTERNET</div><h2>{state.setup === 'ready' ? 'Ready when you are.' : 'Your voice. Staying local.'}</h2><p>Download the English & Hindi speech engine once. After that, your recordings become text right here on your device—even without a connection.</p><div className="setup-facts"><span><ShieldCheck size={17} />No audio leaves your device</span><span><AudioLines size={17} />English & Hindi, with original audio</span><span><ArrowDownToLine size={17} />About 160 MB · one-time download</span></div>{state.setup === 'loading' || state.setup === 'checking' ? <div className="download-progress" role="status"><div><LoaderCircle size={16} className="spin" /><span>{state.setupDetail}</span><strong>{Math.round(state.progress)}%</strong></div><progress value={state.progress} max="100" /></div> : state.setup === 'ready' ? <div className="ready-message"><Check size={19} />Offline transcription is ready</div> : <button className="primary-button full-width" onClick={() => handle(noteStore.prepare())}><ArrowDownToLine size={17} />{state.setup === 'error' ? 'Retry offline setup' : 'Set up offline transcription'}<ArrowRight size={17} /></button>}{state.setup === 'error' && <p className="setup-error" role="alert">{state.error}</p>}<p className="modal-footnote">First-time setup needs internet. Keep this tab open while downloading. Your notes stay in this browser.</p>{state.setup === 'ready' && <button className="text-button centered" onClick={() => setModal(null)}>Back to your thoughts <ArrowRight size={14} /></button>}</>}
        {modal === 'privacy' && <><span className="modal-symbol"><ShieldCheck size={28} /></span><div className="eyebrow">A SPACE OF YOUR OWN</div><h2>Private by nature.</h2><p>Your notes and audio live in this browser on this device. Speech recognition runs locally. There are no accounts, cloud uploads, or tracking.</p><div className="privacy-detail"><LockKeyhole size={19} /><div><strong>Keep a copy of what matters.</strong><p>Clearing your browser’s site data removes your notes and speech files. Download important notes and recordings from the note’s menu.</p></div></div><div className="privacy-detail"><WifiOff size={19} /><div><strong>A little setup. A lot of freedom.</strong><p>After the initial speech download, you can record, write, and revisit notes offline. Desktop Chrome and Edge work best.</p></div></div>{installEvent && <button className="primary-button full-width" onClick={() => handle(installEvent.prompt().then(() => setInstallEvent(null)))}><ArrowDownToLine size={17} />Install Stillnote</button>}<button className="secondary-button full-width" onClick={() => setModal(null)}>Sounds good <Check size={16} /></button></>}
        {modal === 'delete' && selected && <><span className="modal-symbol danger"><Trash2 size={25} /></span><h2>Let this thought go?</h2><p>“{titleOf(selected)}” and its recording will be permanently removed from this device.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>Keep note</button><button className="danger-button" onClick={() => { handle(noteStore.remove(selected.id)); setModal(null); }}>Delete note</button></div></>}
        {modal === 'retry' && selected && <><span className="modal-symbol"><AudioLines size={26} /></span><h2>A fresh listen.</h2><p>Transcribe the full saved recording again. This replaces the current transcript, including any edits. Download the text first if you want to keep it.</p><div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>Keep transcript</button><button className="primary-button" onClick={() => { handle(noteStore.retry(selected.id)); setModal(null); }}>Transcribe again</button></div></>}
      </div>
    </dialog>
  </div>;
}
