export type AutoplayAction =
  | { key: 'z' | 'x' | 'up' | 'down'; why?: string }
  | { say: string; why?: string }
  | { hold: 'left' | 'right' | 'up' | 'down'; ms: number; why?: string }
  | { wait: number; why?: string }
  | { done: true; why?: string };

export interface AutoplayMemory {
  picked: Set<string>;
  failed: Set<number>;
  visited: Set<string>;
  skipped: Set<string>;
  endingSeen: boolean;
  seen: {
    chests: Array<{ chapter: number; id: string }>;
    buys: Array<{ chapter: number; id: string; cost: number; coins: number }>;
    skills: Array<{ chapter: number; skill: string; hp: number }>;
    replies: Array<{ chapter: number; who: string; reply: string }>;
    downs: Array<{ chapter: number; boss: boolean; where?: string; t: number }>;
    wakes: number;
    posts: Array<{ chapter: number; id: string }>;
    stages: Set<string>;
    battles: Array<{ chapter: number; creature: string; boss: boolean }>;
    tracks: Set<string>;
    chapterSeconds: Array<{ chapter: number; seconds: number }>;
    bossTry: Record<number, number>;
    bossRun: Array<{ key: string; chapter: number; attempt: number; outcome: string }>;
  };
}

export function createAutoplay(opts?: { failBoss?: number[]; lowHp?: number; buysPerVisit?: number; neverTalk?: boolean; skipTalk?: boolean; pickOnly?: boolean; loseBossAlways?: boolean }): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  next(s: any): AutoplayAction;
  mem: AutoplayMemory;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zSignature(s: any): string;
