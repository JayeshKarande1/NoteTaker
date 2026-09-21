export type Language = 'en' | 'hi';
export interface Note {
  id: string;
  title: string;
  text: string;
  language: Language;
  createdAt: number;
  updatedAt: number;
  duration: number;
  status: 'draft' | 'recording' | 'processing' | 'saved' | 'interrupted';
  starred: boolean;
}
export interface AudioChunk { id?: number; noteId: string; index: number; samples: Float32Array; }
export interface Segment {
  id: string; noteId: string; index: number; samples: Float32Array;
  overlap: boolean; status: 'pending' | 'done'; text?: string;
}
export type WorkerRequest =
  | { type: 'prepare'; download: boolean }
  | { type: 'transcribe'; sessionId: string; segmentId: string; samples: Float32Array; language: Language }
  | { type: 'cancel'; sessionId: string };
export type WorkerResponse =
  | { type: 'progress'; progress: number; detail: string }
  | { type: 'ready' }
  | { type: 'result'; sessionId: string; segmentId: string; text: string }
  | { type: 'error'; message: string; sessionId?: string; segmentId?: string };
