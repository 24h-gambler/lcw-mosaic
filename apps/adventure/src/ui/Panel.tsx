import React from 'react';
import { ADVENTURE_CHAPTERS } from '@lcw/content';
import type { Engine, Snapshot } from '../engine.js';
import { ITEM_INFO, type ItemKey } from '../core/battle.js';
import { Speak } from './Speak.js';
import { TalkPanel } from './Talk.js';
import { S, PARENT } from './strings.js';

type L = { en: string; ko: string };

function Line({ l, help, cls }: { l: L; help: boolean; cls?: string }) {
  return (
    <div className={cls}>
      {l.en}
      {help && l.ko && <div className="ko">{l.ko}</div>}
    </div>
  );
}

function Pad({ engine }: { engine: Engine }) {
  const set = (x: number, y: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    engine.sound.unlock();
    engine.setPad(x, y);
  };
  const off = (e: React.PointerEvent) => {
    e.preventDefault();
    engine.setPad(0, 0);
  };
  const b = (x: number, y: number, label: string, area: string) => (
    <button
      type="button"
      aria-label={label}
      style={{ gridArea: area }}
      onPointerDown={set(x, y)}
      onPointerUp={off}
      onPointerCancel={off}
      onPointerLeave={off}
      data-testid={`adv-pad-${label}`}
    >
      {label === 'up' ? '▲' : label === 'down' ? '▼' : label === 'left' ? '◀' : '▶'}
    </button>
  );
  return (
    <div className="pad" style={{ gridTemplateAreas: '". u ." "l . r" ". d ."' }}>
      {b(0, -1, 'up', 'u')}
      {b(-1, 0, 'left', 'l')}
      {b(1, 0, 'right', 'r')}
      {b(0, 1, 'down', 'd')}
    </div>
  );
}

function Msg({ who, text, ko, reveal, help, onNext }: { who: string; text: string; ko: string; reveal: number; help: boolean; onNext: () => void }) {
  const full = reveal >= text.length;
  return (
    <div className="msg" onClick={onNext} data-testid="adv-msg">
      <div className="who">{who}</div>
      <div className="en">{text.slice(0, Math.max(0, Math.floor(reveal)))}</div>
      {help && full && ko && <div className="ko">{ko}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <button
          type="button"
          className="btn primary"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          data-testid="adv-next"
        >
          {S.next.en} ▶
        </button>
      </div>
    </div>
  );
}

function Title({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const help = snap.help;
  const sel = snap.islands.find((i) => i.id === snap.selected)!;
  const can = sel.state === 'open' || sel.state === 'cleared';
  const ch = ADVENTURE_CHAPTERS.find((c) => c.id === sel.id)!;
  return (
    <>
      <Line l={S.tagline} help={help} cls="hintline" />
      {snap.dayNote === 'document' && engine.day && (
        <div className="card" data-testid="adv-day">
          <div style={{ fontWeight: 700 }}>
            {S.dayWords.en}
            {help && <span className="ko"> · {S.dayWords.ko}</span>}
          </div>
          <div className="chips">
            {engine.day.words.slice(0, 6).map((w) => (
              <span key={w} className="chip">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}
      {snap.dayNote === 'document-failed' && <Line l={S.dayFailed} help={help} cls="hintline" />}
      <div className="isles" data-testid="adv-isles">
        {snap.islands.map((i) => {
          const locked = i.state === 'previous' || i.state === 'next-day';
          const st = S.state[i.state];
          return (
            <button
              key={i.id}
              type="button"
              className={`btn isle ${locked ? 'locked' : ''} ${snap.selected === i.id ? 'sel' : ''}`}
              onClick={() => engine.selectIsland(i.id)}
              aria-pressed={snap.selected === i.id}
              data-testid={`adv-isle-${i.id}`}
              data-state={i.state}
            >
              <span>
                {i.id}. {i.en}
              </span>
              {help && <span className="ko">{i.ko}</span>}
              <span className="st">
                {locked ? '🔒 ' : i.state === 'cleared' ? `${'★'.repeat(i.stars)} ` : ''}
                {st.en}
                {help ? ` · ${st.ko}` : ''}
              </span>
            </button>
          );
        })}
      </div>
      <Line l={ch.intro} help={help} cls="hintline" />
      <button type="button" className="btn primary" disabled={!can} onClick={() => engine.startChapter(sel.id)} data-testid="adv-start" style={{ alignItems: 'center' }}>
        {sel.state === 'cleared' ? S.replay.en : S.start.en} ▶{help && <span className="ko">{sel.state === 'cleared' ? S.replay.ko : S.start.ko}</span>}
      </button>
      <div className="hintline">
        {S.keysHint.en}
        {help && <div className="ko">{S.keysHint.ko}</div>}
      </div>
      <button type="button" className="btn ghost" onClick={() => engine.openParent()} data-testid="adv-parent-link">
        {S.parentLink}
      </button>
    </>
  );
}

function Explore({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const help = snap.help;
  const m = snap.exploreMsg;
  if (m) {
    const line = m.lines[m.i] ?? { en: '', ko: '' };
    if (m.stone) {
      const st = m.stone;
      return (
        <div className="card" data-testid="adv-stone">
          <div className="who" style={{ font: '12px var(--f-pixel)' }}>
            {m.who}
            {help ? ` · ${m.whoKo}` : ''}
          </div>
          <div className="target" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 38 }}>{st.emoji}</div>
            <div style={{ fontSize: 30 }}>{st.w}</div>
            {help && st.ko && <span className="ko">{st.ko}</span>}
          </div>
          <div className="target" style={{ fontSize: 18 }}>
            {line.en}
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => engine.speakModel(st.w, 0.85)} data-testid="adv-listen">
              🔊 {st.w}
            </button>
            <button type="button" className="btn" onClick={() => engine.speakModel(line.en)}>
              🔊 {S.listen.en}
            </button>
          </div>
          {st.lit ? (
            <Line l={S.stoneLit} help={help} cls="hintline" />
          ) : (
            <>
              <Line l={S.stoneSay} help={help} />
              <Speak help={help} placeholder={S.typeWord.en} onAnswer={(t, mode) => engine.stoneSaid(t, mode)} testid="adv-stone-type" />
            </>
          )}
          <button type="button" className="btn primary" onClick={() => engine.confirm()} data-testid="adv-next">
            {S.close.en} ▶
          </button>
        </div>
      );
    }
    return <Msg who={help ? `${m.who} · ${m.whoKo}` : m.who} text={line.en} ko={line.ko} reveal={snap.reveal} help={help} onNext={() => engine.confirm()} />;
  }
  return (
    <>
      {snap.hint && <Line l={snap.hint} help={help} cls="hintline" />}
      <div className="hintline">
        {snap.touch ? S.touchHint.en : S.keysHint.en}
        {help && <div className="ko">{snap.touch ? S.touchHint.ko : S.keysHint.ko}</div>}
      </div>
      <Pad engine={engine} />
      <button type="button" className="btn" onClick={() => engine.confirm()} data-testid="adv-action" style={{ alignItems: 'center' }}>
        {S.action.en}
        {help && <span className="ko">{S.action.ko}</span>}
      </button>
      <button type="button" className="btn ghost" onClick={() => engine.toTitle()}>
        {S.toMap.en}
      </button>
    </>
  );
}

function Battle({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const b = snap.battle!;
  const help = snap.help;
  if (b.phase === 'msg' && b.msg) {
    const who = b.msg.who === 'creature' ? (help ? `${b.creatureEn} · ${b.creatureKo}` : b.creatureEn) : '✦';
    return <Msg who={who} text={b.msg.line.en} ko={b.msg.line.ko} reveal={snap.reveal} help={help} onNext={() => engine.confirm()} />;
  }
  if (b.phase === 'menu') {
    const cmds = ['poke', 'talk', 'pouch', 'friend'] as const;
    const cur = cmds[b.menuIndex]!;
    return (
      <>
        <div className="cmds" data-testid="adv-menu">
          {cmds.map((c, i) => (
            <button
              key={c}
              type="button"
              tabIndex={-1}
              className={`btn ${i === b.menuIndex ? 'sel' : ''} ${c === 'friend' && b.ready ? 'glow' : ''} ${c === 'talk' ? 'primary' : ''}`}
              onClick={(e) => {
                (e.currentTarget as HTMLButtonElement).blur();
                engine.command(c);
              }}
              data-testid={`adv-cmd-${c}`}
            >
              {S.cmd[c].en}
              {help && <span className="ko">{S.cmd[c].ko}</span>}
            </button>
          ))}
        </div>
        <Line l={S.cmdHint[cur]} help={help} cls="hintline" />
      </>
    );
  }
  if (b.phase === 'talkPick') {
    return (
      <div className="card">
        <Line l={S.chooseTalk} help={help} />
        {b.choices.map((t, i) => (
          <button key={t.id} type="button" className="btn" data-nav autoFocus={i === 0} onClick={() => engine.pickTalk(t.id)} data-testid="adv-talk-choice" data-mode={t.mode}>
            {t.labelEn}
            {help && <span className="ko">{t.labelKo}</span>}
          </button>
        ))}
        <button type="button" className="btn ghost" onClick={() => engine.cancel()} style={{ color: 'var(--c-ink-900)', borderColor: 'var(--c-ink-900)' }}>
          {S.back.en}
        </button>
      </div>
    );
  }
  if (b.phase === 'talk' && b.current) return <TalkPanel key={b.current.id} engine={engine} item={b.current} help={help} />;
  if (b.phase === 'pouch') {
    return (
      <div className="card">
        <Line l={S.pouchTitle} help={help} />
        {(Object.keys(ITEM_INFO) as ItemKey[]).map((k, i) => (
          <button key={k} type="button" className="btn" data-nav autoFocus={i === 0} disabled={b.items[k] <= 0} onClick={() => engine.useItem(k)} data-testid={`adv-item-${k}`}>
            {k === 'honeyDrop' ? '🍯' : '🫐'} {S.items[k].en} ×{b.items[k]} (+{ITEM_INFO[k].heal})
            {help && <span className="ko">{S.items[k].ko}</span>}
          </button>
        ))}
        <button type="button" className="btn ghost" onClick={() => engine.cancel()} style={{ color: 'var(--c-ink-900)', borderColor: 'var(--c-ink-900)' }}>
          {S.back.en}
        </button>
      </div>
    );
  }
  if (b.phase === 'poke') {
    return (
      <>
        <Line l={S.pokeHint} help={help} cls="hintline" />
        <button type="button" className="btn primary" style={{ minHeight: 80, alignItems: 'center', fontFamily: 'var(--f-pixel)' }} onPointerDown={() => engine.confirm()} data-testid="adv-poke">
          {S.pokeNow.en}
        </button>
      </>
    );
  }
  if (b.phase === 'befriend' && b.befriendLine) {
    return (
      <div className="card" data-testid="adv-befriend">
        <Line l={S.befriendTitle} help={help} />
        <div className="target">
          {b.befriendLine.en}
          {help && <span className="ko">{b.befriendLine.ko}</span>}
        </div>
        <button type="button" className="btn" onClick={() => engine.speakModel(b.befriendLine!.en)}>
          🔊 {S.listen.en}
        </button>
        <Line l={S.befriendSay} help={help} cls="ko" />
        <Speak help={help} placeholder={S.typeHere.en} onAnswer={(t, mode) => engine.befriend(true, t, mode)} testid="adv-befriend-type" />
        <button type="button" className="btn go" onClick={() => engine.befriend(false)} data-testid="adv-befriend-go" style={{ alignItems: 'center' }}>
          🤝 {S.befriendBtn.en}
        </button>
      </div>
    );
  }
  if (b.phase === 'dodge') {
    return (
      <>
        {b.turnLine && (
          <div className="msg" data-testid="adv-turn">
            <div className="who">{b.creatureEn}</div>
            <Line l={b.turnLine} help={help} cls="en" />
          </div>
        )}
        <Line l={snap.touch ? S.dodgeTouch : S.dodgeKeys} help={help} cls="hintline" />
        <Line l={S.catchHint} help={help} cls="hintline" />
        <Pad engine={engine} />
      </>
    );
  }
  if (b.phase === 'end') {
    return (
      <button type="button" className="btn primary" onClick={() => engine.confirm()} data-testid="adv-next">
        {S.next.en} ▶
      </button>
    );
  }
  return null;
}

function End({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const e = snap.end!;
  const help = snap.help;
  const act = e.activity;
  return (
    <div className="card" data-testid="adv-end">
      <div style={{ fontWeight: 800, fontSize: 18 }}>
        {S.endTitle.en} · {ADVENTURE_CHAPTERS[snap.chapter - 1]!.islandEn}
        {help && <div className="ko">{S.endTitle.ko}</div>}
      </div>
      <div className="stars" data-testid="adv-end-stars" data-stars={act.stars}>
        {'★'.repeat(act.stars) + '☆'.repeat(3 - act.stars)}
      </div>
      {e.friends.length > 0 && (
        <div>
          <b>{S.endFriends.en}</b>: {e.friends.join(', ')}
        </div>
      )}
      {act.extra.outcome === 'fought' && <Line l={S.endFought} help={help} />}
      <div>
        <b>{S.endWords.en}</b>
        <div className="chips">
          {e.words.map((w) => (
            <span key={w} className="chip">
              {w}
            </span>
          ))}
        </div>
      </div>
      <div>
        <b>{S.endLines.en}</b>
        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
          {act.lines
            .filter((l) => l.ok)
            .slice(0, 8)
            .map((l) => (
              <li key={`${l.mode}-${l.en}`}>{l.en}</li>
            ))}
        </ul>
      </div>
      <Line l={S.endNext[e.nextNote]} help={help} />
      {e.sent === 'sent' && <div className="ko" data-testid="adv-sent">{S.sent.en}</div>}
      {e.back && (
        <a className="btn go" href={e.back} data-testid="adv-back-doc" style={{ textDecoration: 'none', alignItems: 'center' }}>
          {S.backToDoc.en}
          {help && <span className="ko">{S.backToDoc.ko}</span>}
        </a>
      )}
      <button type="button" className="btn primary" onClick={() => engine.toTitle()} data-testid="adv-to-map" style={{ alignItems: 'center' }}>
        {S.toMap.en}
        {help && <span className="ko">{S.toMap.ko}</span>}
      </button>
      <a className="btn" href="/world/" style={{ textDecoration: 'none', alignItems: 'center' }}>
        {S.toWorld.en}
        {help && <span className="ko">{S.toWorld.ko}</span>}
      </a>
      <button type="button" className="btn ghost" style={{ color: 'var(--c-ink-900)', borderColor: 'var(--c-ink-900)' }} onClick={() => engine.openParent()}>
        {PARENT.title}
      </button>
    </div>
  );
}

export function Panel({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  return (
    <div className="adv-panel dark" data-testid={`adv-panel-${snap.scene}`}>
      {snap.scene === 'title' && <Title engine={engine} snap={snap} />}
      {snap.scene === 'explore' && <Explore engine={engine} snap={snap} />}
      {snap.scene === 'battle' && snap.battle && <Battle engine={engine} snap={snap} />}
      {snap.scene === 'end' && snap.end && <End engine={engine} snap={snap} />}
    </div>
  );
}
