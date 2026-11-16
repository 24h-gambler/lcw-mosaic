import React from 'react';
import { ADVENTURE_CHAPTERS } from '@lcw/content';
import type { Engine, Snapshot } from '../engine.js';
import { CHAPTER_IDS } from '../core/progress.js';
import { PARENT, S } from './strings.js';

/** A06: the guardian summary, Korean (docs/22 4장). Reads this device's progress; the document gets the same results. */
export function ParentSummary({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const p = snap.progress;
  const any = CHAPTER_IDS.some((c) => p.chapters[c]?.last);
  return (
    <div className="parent" data-testid="adv-parent">
      <div className="wrap">
        <button type="button" className="btn" onClick={() => engine.toTitle()} data-testid="adv-parent-back" style={{ display: 'inline-flex' }}>
          ← {PARENT.back}
        </button>
        <h1>{PARENT.title}</h1>
        <p>{PARENT.intro}</p>
        {!any && (
          <div className="card" data-testid="adv-parent-empty">
            {PARENT.empty}
          </div>
        )}
        {CHAPTER_IDS.map((id) => {
          const ch = ADVENTURE_CHAPTERS.find((c) => c.id === id)!;
          const cp = p.chapters[id];
          const isle = snap.islands.find((i) => i.id === id);
          const a = cp?.last ?? null;
          return (
            <section key={id} className="card" style={{ marginTop: 12 }} data-testid={`adv-parent-ch${id}`}>
              <div style={{ fontWeight: 800, fontSize: 17 }}>
                {PARENT.chapter(id)} · {ch.islandKo} ({ch.islandEn})
              </div>
              {!a ? (
                <div>{isle && (isle.state === 'previous' || isle.state === 'next-day') ? `${PARENT.locked} — ${S.state[isle.state].ko}` : PARENT.notYet}</div>
              ) : (
                <>
                  <table>
                    <tbody>
                      <tr>
                        <th style={{ width: '32%' }}>{PARENT.playedOn}</th>
                        <td>{a.endedAt.slice(0, 10)}</td>
                      </tr>
                      <tr>
                        <th>{PARENT.time}</th>
                        <td>{PARENT.minutes(a.seconds)}</td>
                      </tr>
                      <tr>
                        <th>{PARENT.outcome}</th>
                        <td>
                          {PARENT.outcomes[a.extra.outcome]}
                          {cp?.clearedOn ? ` · ${PARENT.cleared}` : ''}
                        </td>
                      </tr>
                      <tr>
                        <th>{PARENT.stars}</th>
                        <td>
                          {'★'.repeat(a.stars) + '☆'.repeat(3 - a.stars)} ({a.stars}/3)
                        </td>
                      </tr>
                      <tr>
                        <th>{PARENT.level}</th>
                        <td>{a.extra.level}</td>
                      </tr>
                      {a.extra.hp_lost > 0 && (
                        <tr>
                          <th />
                          <td>{PARENT.voiceLost(a.extra.hp_lost)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {a.words.length > 0 && (
                    <div>
                      <b>{PARENT.words}</b>
                      <div className="chips" style={{ marginTop: 4 }}>
                        {a.words.map((w) => (
                          <span key={w.w} className="chip" style={{ opacity: w.ok ? 1 : 0.55 }}>
                            {w.w} {w.ok ? '✓' : ''}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {a.lines.length > 0 && (
                    <div>
                      <b>{PARENT.lines}</b>
                      <table style={{ marginTop: 4 }}>
                        <tbody>
                          {a.lines.map((l) => (
                            <tr key={`${l.mode}-${l.en}`}>
                              <td style={{ width: '58%' }}>
                                {l.en}
                                {l.ko && <div className="ko">{l.ko}</div>}
                              </td>
                              <td>
                                {PARENT.modes[l.mode]} · {l.ok ? PARENT.ok : PARENT.retry} · {PARENT.tries(l.tries)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
