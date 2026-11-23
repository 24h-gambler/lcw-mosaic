import React, { useState } from 'react';
import type { TalkItem } from '../core/plan.js';
import type { Engine, Snapshot } from '../engine.js';
import { Speak } from './Speak.js';
import { S } from './strings.js';

/** A04: one TALK in its mode — say (🎤/⌨), build (word pieces), spell (letter pieces or typing), pick (three replies). */
export function TalkPanel({ engine, snap, item, help }: { engine: Engine; snap: Snapshot; item: TalkItem; help: boolean }) {
  // tries and the last result live in the engine (R2734: Z reads them too — "Next" after the stars is one key away)
  const result = snap.battle?.talk.result ?? null;
  const [picked, setPicked] = useState<number[]>([]);

  const done = Boolean(result && result.pass && result.stars > 0);
  const attempt = (a: { mode: 'voice' | 'typed' | 'pick' | 'spell'; transcripts?: string[]; answer?: string }) => {
    engine.talkAttempt(a);
  };

  const head =
    item.mode === 'say' ? S.saySentence : item.mode === 'build' ? S.buildSentence : item.mode === 'spell' ? S.spellWord : S.pickReply;

  const listenBtn = (text: string, rate?: number) => (
    <button type="button" className="btn" onClick={() => engine.speakModel(text, rate)} data-testid="adv-listen">
      🔊 {S.listen.en}
      {help && <span className="ko">{S.listen.ko}</span>}
    </button>
  );

  const tiles = item.tiles ?? [];
  const answer = picked.map((i) => tiles[i]!).join(item.mode === 'spell' ? '' : ' ');

  return (
    <div className="card" data-testid="adv-talk" data-mode={item.mode}>
      <div style={{ fontWeight: 700 }}>
        {head.en}
        {help && <div className="ko">{head.ko}</div>}
      </div>

      {item.mode === 'say' && (
        <div className="target" data-testid="adv-target">
          {item.target}
          {help && item.ko && <span className="ko">{item.ko}</span>}
        </div>
      )}
      {item.mode === 'build' && help && item.ko && <div className="ko">{item.ko}</div>}
      {item.mode === 'spell' && (
        <div className="target" style={{ textAlign: 'center', fontSize: 40 }}>
          {item.emoji ?? '✨'}
          {help && item.ko && <span className="ko">{item.ko.replace(/^[^=]+= /, '')}</span>}
        </div>
      )}
      {item.mode === 'pick' && item.prompt && (
        <div className="target" style={{ fontSize: 18 }}>
          “{item.prompt.en}”{help && <span className="ko">{item.prompt.ko}</span>}
        </div>
      )}

      <div className="row">
        {item.mode === 'spell' ? listenBtn(item.target, 0.8) : item.mode === 'pick' ? null : listenBtn(item.target)}
      </div>

      {!done && item.mode === 'say' && (
        <Speak help={help} placeholder={S.typeHere.en} onAnswer={(t, mode) => attempt({ mode, transcripts: t })} />
      )}

      {!done && (item.mode === 'build' || item.mode === 'spell') && (
        <>
          <div className="answer" aria-label="answer" data-testid="adv-answer">
            {picked.map((ti, k) => (
              <button key={`${ti}-${k}`} type="button" className="tile" onClick={() => setPicked(picked.filter((_, j) => j !== k))}>
                {tiles[ti]}
              </button>
            ))}
          </div>
          <div className="tiles">
            {tiles.map((t, i) => (
              <button
                key={i}
                type="button"
                className={`tile ${picked.includes(i) ? 'used' : ''}`}
                disabled={picked.includes(i)}
                onClick={() => setPicked([...picked, i])}
                data-testid="adv-tile"
                data-tile={t}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => setPicked([])}>
              {S.clear.en}
            </button>
            <button
              type="button"
              className="btn primary"
              data-primary
              disabled={!picked.length}
              onClick={() => {
                // word pieces put in order count as a pick; letters as spelling (english-day contract modes)
                attempt({ mode: item.mode === 'build' ? 'pick' : 'spell', answer });
                setPicked([]);
              }}
              data-testid="adv-check"
            >
              {S.check.en}
            </button>
          </div>
          {item.mode === 'spell' && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const v = (new FormData(e.currentTarget).get('w') as string | null) ?? '';
                if (v.trim()) attempt({ mode: 'spell', answer: v });
                e.currentTarget.reset();
              }}
            >
              <input name="w" className="type" placeholder={S.typeWord.en} aria-label={S.typeWord.en} autoComplete="off" autoCapitalize="none" spellCheck={false} data-testid="adv-spell-type" />
              <button type="submit" className="btn">
                {S.check.en}
              </button>
            </form>
          )}
        </>
      )}

      {!done && item.mode === 'pick' && (
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {(item.choices ?? []).map((c, i) => (
            <button
              key={c}
              type="button"
              tabIndex={-1}
              className={`btn ${snap.cursor === i ? 'sel' : ''}`}
              aria-current={snap.cursor === i}
              onPointerEnter={(e) => {
                if (e.pointerType === 'mouse') engine.setCursor(i);
              }}
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                engine.setCursor(i);
                attempt({ mode: 'pick', answer: c });
              }}
              data-testid="adv-choice"
              data-index={i}
            >
              {snap.cursor === i ? '▸ ' : ''}
              {c}
            </button>
          ))}
        </div>
      )}

      {result && (
        <div role="status" data-testid="adv-result" data-stars={result.stars}>
          <div className="stars">{'★'.repeat(result.stars) + '☆'.repeat(3 - result.stars)}</div>
          <div style={{ fontWeight: 700 }}>
            {S.result[result.stars].en}
            {help && <div className="ko">{S.result[result.stars].ko}</div>}
          </div>
          {!done && result.missed.length > 0 && (
            <div className="ko">
              {S.missedWords.en}: {result.missed.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="row">
        {done ? (
          <button type="button" className="btn go" data-primary onClick={() => engine.talkDone(result!)} data-testid="adv-talk-next">
            {S.next.en} ▶{help && <span className="ko">{S.next.ko}</span>}
          </button>
        ) : (
          <button type="button" className="btn ghost" onClick={() => engine.talkSkip()} data-testid="adv-talk-skip">
            {S.skip.en}
            {help && <span className="ko">{S.skip.ko}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
