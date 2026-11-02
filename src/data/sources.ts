import type { SourceId } from '@/types/orca';

export interface SourceDef {
  id: SourceId;
  label: string;
  colour: string;
  /** Not connected → shown greyed out with "—"; never placeholder data. */
  connected: boolean;
  blurb: string;
}

export const SOURCES: SourceDef[] = [
  { id: 'boats', label: 'Whale-watch boats', colour: '#4ade80', connected: true,
    blurb: 'Live AIS of listed whale-watching boats. Boats that run out fast, then slow and stay put together, are probably watching whales.' },
  { id: 'hydrophones', label: 'Hydrophones', colour: '#60a5fa', connected: true,
    blurb: 'Underwater microphones around the Salish Sea, with OrcaHello\'s automatic call detections. A detection counts only once a moderator confirms whales, and only on a boat estimate within 10 km.' },
  { id: 'reports', label: 'Sighting reports', colour: '#facc15', connected: false,
    blurb: 'Reported sightings. No feed chosen yet.' },
  { id: 'vhf', label: 'VHF radio', colour: '#a78bfa', connected: false,
    blurb: 'Marine radio chatter. Needs a receiver and transcription.' },
  { id: 'social', label: 'Social media', colour: '#f472b6', connected: false,
    blurb: 'Public posts about sightings. Not connected.' },
];

export const sourceById = (id: SourceId) => SOURCES.find((s) => s.id === id)!;
