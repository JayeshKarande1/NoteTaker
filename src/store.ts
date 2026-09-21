import { registerSW } from 'virtual:pwa-register';
import { Microphone, Segmenter, appendTranscript, wavBlob } from './audio';
import * as db from './storage';
import { modelCached } from './model';
import type { Language, Note, Segment, WorkerRequest, WorkerResponse } from './types';

type Setup = 'checking' | 'needed' | 'loading' | 'ready' | 'error';
export interface State {
  notes: Note[]; selected: string | null; loaded: boolean; setup: Setup; progress: number; setupDetail: string;
  recording: string | null; paused: boolean; starting: boolean; stopping: boolean;
  level: number; elapsed: number; pending: number; processing: string | null; error: string | null; saving: boolean;
}
class NoteStore {
  state: State = { notes: [], selected: null, loaded: false, setup: 'checking', progress: 0, setupDetail: 'Checking offline files…', recording: null, paused: false, starting: false, stopping: false, level: 0, elapsed: 0, pending: 0, processing: null, error: null, saving: false };
  private listeners = new Set<() => void>();
  private worker?: Worker;
  private mic?: Microphone;
  private segmenter?: Segmenter;
  private writes = Promise.resolve();
  private queued = Promise.resolve();
  private draining = false;
  private initialized = false;
  private audioIndex = 0;
  private segmentIndex = 0;
  private workerResult?: { resolve: (text: string) => void; reject: (error: Error) => void; sessionId: string; segmentId: string };
  private prepareResult?: { resolve: () => void; reject: (error: Error) => void };
  private editTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingWrites = 0;
  private failedSessions = new Set<string>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.state;
  private patch(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); }
  private note(id: string) { return this.state.notes.find((note) => note.id === id)!; }
  private replace(note: Note) { this.patch({ notes: [note, ...this.state.notes.filter((n) => n.id !== note.id)].sort((a, b) => b.updatedAt - a.updatedAt) }); }
  private fail = (error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    this.patch({ error: detail.includes('quota') || (error instanceof DOMException && error.name === 'QuotaExceededError') ? 'Device storage is full. Recording has stopped. Download your notes before freeing space, then try again.' : detail, saving: false });
  };
  private persist(note: Note) {
    this.pendingWrites++;
    this.patch({ saving: true });
    const write = this.writes.then(() => db.saveNote(note));
    this.writes = write.catch(this.fail);
    void this.writes.then(() => { this.pendingWrites--; this.patch({ saving: this.pendingWrites > 0 || this.editTimers.size > 0 }); });
    return write;
  }
  private makeWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./transcription.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.type === 'progress') this.patch({ progress: data.progress, setupDetail: data.detail });
      if (data.type === 'ready') { this.prepareResult?.resolve(); this.prepareResult = undefined; }
      if (data.type === 'result' && data.sessionId === this.workerResult?.sessionId && data.segmentId === this.workerResult.segmentId) {
        this.workerResult.resolve(data.text); this.workerResult = undefined;
      }
      if (data.type === 'error') {
        const error = new Error(data.message);
        if (data.segmentId === this.workerResult?.segmentId) { this.workerResult?.reject(error); this.workerResult = undefined; }
        else { this.prepareResult?.reject(error); this.prepareResult = undefined; }
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The speech engine stopped. Your saved recording can be retried.');
      this.prepareResult?.reject(error); this.workerResult?.reject(error);
      this.prepareResult = undefined; this.workerResult = undefined;
      worker.terminate(); this.worker = undefined;
      this.patch({ setup: 'error' }); this.fail(error);
    };
    this.worker = worker;
    return worker;
  }
  async init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.patch({ notes: await db.recoverNotes(), loaded: true });
      if (import.meta.env.PROD) registerSW({ immediate: true, onRegisterError: () => this.fail(new Error('The offline app could not be installed. Reload to try again.')) });
      if (await modelCached()) await this.prepare(false);
      else this.patch({ setup: 'needed' });
    } catch (error) { this.patch({ loaded: true, setup: 'error' }); this.fail(error); }
    window.addEventListener('pagehide', () => { void this.flushEdits().catch(this.fail); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) void this.flushEdits().catch(this.fail); });
    window.addEventListener('beforeunload', (event) => {
      if (this.state.recording || this.state.starting || this.state.processing || this.state.saving) { event.preventDefault(); }
    });
  }
  async prepare(download = true) {
    if (this.state.setup === 'loading') return;
    this.patch({ setup: 'loading', progress: 0, setupDetail: download ? 'Preparing your private speech engine…' : 'Loading your offline speech engine…', error: null });
    try {
      if (import.meta.env.PROD) {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Offline app installation is not ready. Reload and try again.')), 45000); })]);
        } finally { clearTimeout(timeout); }
      }
      if (download) await navigator.storage?.persist?.();
      await new Promise<void>((resolve, reject) => {
        this.prepareResult = { resolve, reject };
        this.makeWorker().postMessage({ type: 'prepare', download } satisfies WorkerRequest);
      });
      this.patch({ setup: 'ready', progress: 100, setupDetail: 'Ready to work offline' });
    } catch (error) { this.patch({ setup: 'error', setupDetail: 'Setup needs another try' }); this.fail(error); }
  }
  clearError = () => this.patch({ error: null });
  select = async (id: string | null) => { await this.flushEdits(); this.patch({ selected: id }); };
  async create(language: Language = 'en') {
    await this.flushEdits();
    const note = db.newNote(language); this.replace(note); await this.persist(note); this.patch({ selected: note.id }); return note;
  }
  edit(id: string, fields: Partial<Pick<Note, 'title' | 'text' | 'starred'>>) {
    const note = { ...this.note(id), ...fields, updatedAt: Date.now() };
    this.replace(note); this.patch({ saving: true });
    clearTimeout(this.editTimers.get(id));
    this.editTimers.set(id, setTimeout(() => { this.editTimers.delete(id); void this.persist(this.note(id)).catch(this.fail); }, 300));
  }
  async flushEdits() {
    for (const [id, timer] of this.editTimers) { clearTimeout(timer); this.editTimers.delete(id); await this.persist(this.note(id)); }
    await this.writes;
  }
  async remove(id: string) {
    if (id === this.state.recording || id === this.state.processing) return;
    await this.flushEdits(); await db.deleteNote(id);
    this.patch({ notes: this.state.notes.filter((n) => n.id !== id), selected: this.state.selected === id ? null : this.state.selected });
  }
  async start(language: Language) {
    if (this.state.recording || this.state.starting || this.state.processing || this.state.setup !== 'ready') return;
    this.patch({ starting: true, error: null, elapsed: 0, pending: 0 });
    let note: Note | undefined;
    try {
      if (!await modelCached()) { this.patch({ setup: 'needed' }); throw new Error('Your speech files were cleared. Set up offline transcription again.'); }
      await this.flushEdits();
      note = await this.create(language);
      this.audioIndex = 0; this.segmentIndex = 0;
      const id = note.id;
      this.segmenter = new Segmenter((samples, overlap) => this.enqueue(id, samples, overlap));
      this.mic = new Microphone();
      await this.mic.start((samples) => {
        const chunk = { noteId: id, index: this.audioIndex++, samples };
        this.queued = this.queued.then(async () => {
          await db.saveAudio(chunk);
          let energy = 0; for (const sample of samples) energy += sample * sample;
          this.patch({ elapsed: this.state.elapsed + samples.length / 16000, level: Math.min(1, Math.sqrt(energy / samples.length) * 8) });
          this.segmenter?.push(samples);
        }).catch((error) => { this.fail(error); void this.stop(); });
      }, () => { this.fail(new Error('The microphone disconnected. Your captured audio is being saved.')); void this.stop(); });
      this.replace({ ...this.note(id), status: 'recording' });
      await this.persist(this.note(id));
      this.patch({ recording: id, paused: false });
    } catch (error) {
      await this.mic?.stop();
      if (note) { this.replace({ ...this.note(note.id), status: 'draft' }); await this.persist(this.note(note.id)).catch(this.fail); }
      this.fail(error instanceof DOMException && error.name === 'NotAllowedError' ? new Error('Microphone access was denied. Allow the microphone in your browser settings, then try again.') : error);
    } finally { this.patch({ starting: false }); }
  }
  private enqueue(noteId: string, samples: Float32Array, overlap: boolean) {
    const segment: Segment = { id: crypto.randomUUID(), noteId, index: this.segmentIndex++, samples, overlap, status: 'pending' };
    // This write is added after the audio write that produced it. Audio is always durable first.
    this.queued = this.queued.then(async () => {
      await db.saveSegment(segment);
      this.patch({ pending: this.state.pending + 1 });
      if (!this.failedSessions.has(noteId)) void this.drain(noteId);
    }).catch((error) => { this.fail(error); void this.stop(); });
  }
  private async drain(noteId: string) {
    if (this.draining || this.state.setup !== 'ready') return;
    this.draining = true; this.patch({ processing: noteId });
    try {
      while (true) {
        const segment = (await db.getSegments(noteId)).find((s) => s.status === 'pending');
        if (!segment) break;
        const text = await new Promise<string>((resolve, reject) => {
          this.workerResult = { resolve, reject, sessionId: noteId, segmentId: segment.id };
          this.makeWorker().postMessage({ type: 'transcribe', sessionId: noteId, segmentId: segment.id, samples: segment.samples, language: this.note(noteId).language } satisfies WorkerRequest);
        });
        await this.flushEdits();
        const note = { ...this.note(noteId), text: appendTranscript(this.note(noteId).text, text, segment.overlap), updatedAt: Date.now() };
        await db.commitSegment({ ...segment, text }, note);
        this.replace(note); this.patch({ pending: Math.max(0, this.state.pending - 1) });
      }
      if (this.state.recording !== noteId && this.note(noteId).status === 'processing') {
        const note = { ...this.note(noteId), status: 'saved' as const }; this.replace(note); await this.persist(note);
      }
    } catch (error) {
      this.failedSessions.add(noteId);
      const note = this.note(noteId);
      this.replace({ ...note, status: 'interrupted' }); await this.persist(this.note(noteId)).catch(this.fail);
      this.fail(error);
    } finally {
      this.draining = false; this.patch({ processing: null });
      // A segment can finish persisting while the last empty queue read is resolving.
      if (!this.failedSessions.has(noteId) && (await db.getSegments(noteId)).some((s) => s.status === 'pending')) void this.drain(noteId);
    }
  }
  pause = () => { const paused = !this.state.paused; this.mic?.setPaused(paused); this.patch({ paused, level: 0 }); };
  async stop() {
    if (!this.state.recording || this.state.stopping) return;
    const id = this.state.recording;
    this.patch({ stopping: true });
    try {
      await this.mic?.stop();
      // Await until no new segmentation write has been appended by a preceding audio write.
      let last: Promise<void>; do { last = this.queued; await last; } while (last !== this.queued);
      this.segmenter?.flush(); this.segmenter = undefined;
      await this.queued;
      const pending = (await db.getSegments(id)).filter((s) => s.status === 'pending').length;
      const note = { ...this.note(id), duration: this.state.elapsed, status: (this.state.error ? 'interrupted' : pending ? 'processing' : 'saved') as Note['status'], updatedAt: Date.now() };
      this.replace(note); await this.persist(note);
      this.patch({ recording: null, paused: false, level: 0, pending });
      if (pending && !this.state.error) void this.drain(id);
    } catch (error) { this.fail(error); this.patch({ recording: null }); }
    finally { this.patch({ stopping: false }); }
  }
  async retry(id: string) {
    if (this.state.recording || this.state.processing || this.state.starting) return;
    this.patch({ error: null });
    this.failedSessions.delete(id);
    if (this.state.setup !== 'ready') { await this.prepare(); if (this.snapshot().setup !== 'ready') return; }
    try {
      // Rebuild all segments from the durable recording so even an interrupted partial segment is recovered.
      const audio = await db.getAudio(id);
      if (!audio.length) throw new Error('There is no saved audio to transcribe.');
      this.patch({ processing: id });
      const existing = await db.getSegments(id);
      let index = existing.length;
      const segments: Segment[] = [];
      const splitter = new Segmenter((samples, overlap) => segments.push({ id: crypto.randomUUID(), noteId: id, index: index++, samples, overlap, status: 'pending' }));
      for (const chunk of audio) splitter.push(chunk.samples);
      splitter.flush();
      for (const segment of existing) await db.saveSegment({ ...segment, status: 'done', samples: new Float32Array(0) });
      for (const segment of segments) await db.saveSegment(segment);
      const note = { ...this.note(id), text: '', status: 'processing' as const, updatedAt: Date.now() };
      this.replace(note); await this.persist(note);
      this.patch({ pending: segments.length, processing: null });
      await this.drain(id);
    } catch (error) { this.patch({ processing: null }); this.fail(error); }
  }
  async audioBlob(id: string) { return wavBlob((await db.getAudio(id)).map((chunk) => chunk.samples)); }
}
export const noteStore = new NoteStore();
