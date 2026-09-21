import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { appendTranscript, Segmenter, wavBlob } from '../src/audio';
import { commitSegment, deleteNote, getAudio, getNotes, getSegments, newNote, recoverNotes, saveAudio, saveNote, saveSegment } from '../src/storage';

describe('speech boundaries', () => {
  it('removes overlap at forced boundaries, preserving legitimate repetition elsewhere', () => {
    expect(appendTranscript('Remember the green garden.', 'green garden is quiet.', true)).toBe('Remember the green garden. is quiet.');
    expect(appendTranscript('हाँ ठीक है', 'ठीक है हम चलें', true)).toBe('हाँ ठीक है हम चलें');
    expect(appendTranscript('very', 'very good', false)).toBe('very very good');
    expect(appendTranscript('', ' hello ', false)).toBe('hello');
  });
  it('skips silence and flushes a short final spoken phrase', () => {
    const chunks: Float32Array[] = [];
    const segmenter = new Segmenter((chunk) => chunks.push(chunk));
    for (let i = 0; i < 40; i++) segmenter.push(new Float32Array(1600));
    expect(chunks).toHaveLength(0);
    segmenter.push(new Float32Array(8000).fill(.1)); segmenter.flush();
    expect(chunks).toHaveLength(1);
  });
  it('uses overlap only after splitting continuous speech', () => {
    const overlaps: boolean[] = [];
    const segmenter = new Segmenter((_, overlap) => overlaps.push(overlap));
    for (let i = 0; i < 150; i++) segmenter.push(new Float32Array(1600).fill(.1));
    segmenter.flush();
    expect(overlaps).toEqual([false, true]);
  });
  it('produces a playable 16 kHz mono PCM WAV', async () => {
    const view = new DataView(await wavBlob([new Float32Array([-1, 0, 1])]).arrayBuffer());
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(32767);
  });
});

describe('durable notes and recovery', () => {
  beforeEach(async () => { for (const note of await getNotes()) await deleteNote(note.id); });
  it('recovers interrupted audio and commits a transcript atomically with its segment', async () => {
    const note = { ...newNote('hi'), status: 'recording' as const };
    await saveNote(note);
    await saveAudio({ noteId: note.id, index: 0, samples: new Float32Array(16000) });
    const segment = { id: 'segment-1', noteId: note.id, index: 0, samples: new Float32Array(16000), overlap: false, status: 'pending' as const };
    await saveSegment(segment);
    const [recovered] = await recoverNotes();
    expect(recovered.status).toBe('interrupted'); expect(recovered.duration).toBe(1);
    await commitSegment({ ...segment, text: 'नमस्ते' }, { ...recovered, text: 'नमस्ते' });
    expect((await getNotes())[0].text).toBe('नमस्ते');
    expect((await getSegments(note.id))[0].status).toBe('done');
    expect((await getSegments(note.id))[0].samples.length).toBe(0);
    await deleteNote(note.id);
    expect(await getNotes()).toHaveLength(0); expect(await getAudio(note.id)).toHaveLength(0); expect(await getSegments(note.id)).toHaveLength(0);
  });
  it('does not delete another note’s audio or change completed notes on recovery', async () => {
    const a = newNote(), b = { ...newNote(), status: 'saved' as const };
    await saveNote(a); await saveNote(b); await saveAudio({ noteId: b.id, index: 0, samples: new Float32Array(1600) });
    await deleteNote(a.id);
    expect((await recoverNotes())[0].status).toBe('saved'); expect(await getAudio(b.id)).toHaveLength(1);
  });
});
