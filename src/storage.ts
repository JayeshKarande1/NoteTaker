import { openDB, type DBSchema } from 'idb';
import type { Note, AudioChunk, Segment } from './types';

interface NotesDB extends DBSchema {
  notes: { key: string; value: Note };
  audio: { key: number; value: AudioChunk; indexes: { 'by-note': string } };
  segments: { key: string; value: Segment; indexes: { 'by-note': string } };
}
const dbPromise = openDB<NotesDB>('stillnote', 1, {
  upgrade(db) {
    db.createObjectStore('notes', { keyPath: 'id' });
    db.createObjectStore('audio', { keyPath: 'id', autoIncrement: true }).createIndex('by-note', 'noteId');
    db.createObjectStore('segments', { keyPath: 'id' }).createIndex('by-note', 'noteId');
  },
});
export async function getNotes() { return (await (await dbPromise).getAll('notes')).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function saveNote(note: Note) { await (await dbPromise).put('notes', note); }
export async function saveAudio(chunk: AudioChunk) { await (await dbPromise).add('audio', chunk); }
export async function saveSegment(segment: Segment) { await (await dbPromise).put('segments', segment); }
export async function getSegments(noteId: string) { return (await (await dbPromise).getAllFromIndex('segments', 'by-note', noteId)).sort((a, b) => a.index - b.index); }
export async function getAudio(noteId: string) { return (await (await dbPromise).getAllFromIndex('audio', 'by-note', noteId)).sort((a, b) => a.index - b.index); }
export async function commitSegment(segment: Segment, note: Note) {
  const tx = (await dbPromise).transaction(['notes', 'segments'], 'readwrite');
  await tx.objectStore('segments').put({ ...segment, samples: new Float32Array(0), status: 'done' });
  await tx.objectStore('notes').put(note);
  await tx.done;
}
export async function deleteNote(id: string) {
  const tx = (await dbPromise).transaction(['notes', 'audio', 'segments'], 'readwrite');
  for (const store of ['audio', 'segments'] as const) {
    let cursor = await tx.objectStore(store).index('by-note').openCursor(id);
    while (cursor) { await cursor.delete(); cursor = await cursor.continue(); }
  }
  await tx.objectStore('notes').delete(id);
  await tx.done;
}
export async function recoverNotes() {
  const notes = await getNotes();
  for (const note of notes) {
    if (note.status === 'recording' || note.status === 'processing') {
      note.status = 'interrupted';
      const audio = await getAudio(note.id);
      note.duration = audio.reduce((n, c) => n + c.samples.length / 16000, 0);
      await saveNote(note);
    }
  }
  return notes;
}
export function newNote(language: Note['language'] = 'en'): Note {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: 'Untitled note', text: '', language, createdAt: now, updatedAt: now, duration: 0, status: 'draft', starred: false };
}
