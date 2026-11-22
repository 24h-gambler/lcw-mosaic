import React from 'react';
import { ADVENTURE_CHAPTERS } from '@lcw/content';
import type { Engine, Snapshot } from '../engine.js';
import { ITEM_INFO, MENU } from '../core/battle.js';
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

type Row = { key: string; en: React.ReactNode; ko?: string; disabled?: boolean; extra?: Record<string, string> };

/** A list the keyboard walks with the arrows (the engine's one cursor) and Z picks; a click or tap picks too. */
function Rows({ engine, snap, rows, onPick, testid }: { engine: Engine; snap: Snapshot; rows: Row[]; onPick: (i: number) => void; testid: string }) {
  return (
    <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }} data-testid={`${testid}-list`}>
      {rows.map((r, i) => (
        <button
          key={r.key}
          type="button"
          tabIndex={-1}
          className={`btn ${snap.cursor === i ? 'sel' : ''}`}
          aria-current={snap.cursor === i}
          disabled={r.disabled}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse') engine.setCursor(i);
          }}
          onClick={(e) => {
            (e.currentTarget as HTMLButtonElement).blur();
            onPick(i);
          }}
          data-testid={testid}
          data-index={i}
          {...(r.extra ?? {})}
        >
          <span>
            {snap.cursor === i ? '▸ ' : ''}
            {r.en}
          </span>
          {snap.help && r.ko && <span className="ko">{r.ko}</span>}
        </button>
      ))}
    </div>
  );
}

/** The trip's voice (hit points) and coins — always in sight on an island. */
function Hud({ snap }: { snap: Snapshot }) {
  const r = snap.run;
  const frac = r.hpMax ? r.hp / r.hpMax : 0;
  return (
    <div className="row" style={{ alignItems: 'center', gap: 10, font: '12px var(--f-pixel)' }} data-testid="adv-hud" data-hp={r.hp} data-hpmax={r.hpMax} data-coins={r.coins}>
      <span>{S.voiceLabel.en}</span>
      <span style={{ flex: 1, height: 10, background: 'var(--c-ink-700)', borderRadius: 4, overflow: 'hidden', minWidth: 60 }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.round(frac * 100)}%`, background: frac > 0.3 ? 'var(--c-leaf)' : 'var(--c-sun)' }} />
      </span>
      <span>
        {r.hp}/{r.hpMax}
      </span>
      <span>
        ● {r.coins} {S.coinsLabel.en}
      </span>
    </div>
  );
}

function Msg({
  engine,
  snap,
  who,
  text,
  ko,
  reveal,
  help,
  onNext,
  choices,
  onChoose
}: {
  engine: Engine;
  snap: Snapshot;
  who: string;
  text: string;
  ko: string;
  reveal: number;
  help: boolean;
  onNext: () => void;
  choices?: L[];
  onChoose?: (i: number) => void;
}) {
  const full = reveal >= text.length;
  const asking = Boolean(choices?.length && full && onChoose);
  return (
    <div className="msg" onClick={asking ? undefined : onNext} data-testid="adv-msg">
      <div className="who">{who}</div>
      <div className="en">{text.slice(0, Math.max(0, Math.floor(reveal)))}</div>
      {help && full && ko && <div className="ko">{ko}</div>}
      {asking ? (
        <Rows engine={engine} snap={snap} rows={choices!.map((c, i) => ({ key: `${i}-${c.en}`, en: c.en, ko: c.ko }))} onPick={onChoose!} testid="adv-reply" />
      ) : (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
          <button
            type="button"
            className="btn primary"
            data-primary
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            data-testid="adv-next"
          >
            {S.next.en} ▶
          </button>
        </div>
      )}
    </div>
  );
}

function Title({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const help = snap.help;
  const sel = snap.islands.find((i) => i.id === snap.selected)!;
  const can = snap.booted && (sel.state === 'open' || sel.state === 'cleared');
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
          const locked = i.state === 'previous';
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
      <button type="button" className="btn primary" disabled={!can} data-primary onClick={() => engine.begin(sel.id)} data-testid="adv-start" style={{ alignItems: 'center' }}>
        {!snap.booted ? S.loading.en : sel.state === 'cleared' ? S.replay.en : `${S.start.en} ▶`}
        {help && <span className="ko">{!snap.booted ? S.loading.ko : sel.state === 'cleared' ? S.replay.ko : S.start.ko}</span>}
      </button>
      <div className="hintline">
        {S.keysHint.en}
        {help && <div className="ko">{S.keysHint.ko}</div>}
      </div>
      {(snap.run.coins > 0 || snap.run.skills.length > 0) && <Hud snap={snap} />}
      <button type="button" className="btn ghost" onClick={() => engine.newTrip()} data-testid="adv-new-trip">
        {S.newTrip.en}
        {help && <span className="ko">{S.newTrip.ko}</span>}
      </button>
      <button type="button" className="btn ghost" onClick={() => engine.openParent()} data-testid="adv-parent-link">
        {S.parentLink}
      </button>
    </>
  );
}

function Shop({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const help = snap.help;
  const sh = snap.shop!;
  const rows: Row[] = [
    ...sh.rows.map((r) => ({
      key: r.id,
      en: (
        <>
          {r.en} · {r.cost} ● <small>({S.shopKind[r.kind].en})</small>
          {r.check === 'owned' ? ` · ${S.owned.en}` : ''}
          <span style={{ display: 'block', fontSize: 13, opacity: 0.85 }}>{r.info.en}</span>
        </>
      ),
      ko: `${r.ko} · ${r.info.ko}`,
      extra: { 'data-check': r.check, 'data-goods': r.id, 'data-cost': String(r.cost) }
    })),
    { key: 'leave', en: S.shopLeave.en, ko: S.shopLeave.ko, extra: { 'data-goods': 'leave' } }
  ];
  return (
    <div className="card" data-testid="adv-shop">
      <Hud snap={snap} />
      <div style={{ fontWeight: 800 }}>
        {S.shopTitle.en}
        {help && <span className="ko"> · {S.shopTitle.ko}</span>}
      </div>
      <Line l={S.shopHint} help={help} cls="hintline" />
      <Rows engine={engine} snap={snap} rows={rows} onPick={(i) => engine.shopPick(i)} testid="adv-goods" />
      {sh.note && (
        <div role="status" data-testid="adv-shop-note">
          <Line l={sh.note} help={help} />
        </div>
      )}
    </div>
  );
}

function Explore({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const help = snap.help;
  const m = snap.exploreMsg;
  if (snap.shop) return <Shop engine={engine} snap={snap} />;
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
    const last = m.i === m.lines.length - 1;
    return (
      <>
        <Hud snap={snap} />
        <Msg
          engine={engine}
          snap={snap}
          who={help ? `${m.who} · ${m.whoKo}` : m.who}
          text={line.en}
          ko={line.ko}
          reveal={snap.reveal}
          help={help}
          onNext={() => engine.confirm()}
          choices={last ? m.choices : undefined}
          onChoose={(i) => engine.chooseReply(i)}
        />
      </>
    );
  }
  return (
    <>
      <Hud snap={snap} />
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

/** Voice and coins, and a guardian's stage (2/3 …) so a hard meeting shows how far along it is. */
function BattleTop({ snap }: { snap: Snapshot }) {
  const b = snap.battle!;
  return (
    <>
      <Hud snap={snap} />
      {b.stageCount > 1 && (
        <div className="hintline" data-testid="adv-stage" data-stage={b.stage}>
          {S.stageLabel.en} {b.stage + 1}/{b.stageCount}
        </div>
      )}
    </>
  );
}

const backStyle = { color: 'var(--c-ink-900)', borderColor: 'var(--c-ink-900)' };

function Battle({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const b = snap.battle!;
  const help = snap.help;
  if (b.phase === 'msg' && b.msg) {
    const who = b.msg.who === 'creature' ? (help ? `${b.creatureEn} · ${b.creatureKo}` : b.creatureEn) : '✦';
    return (
      <>
        <BattleTop snap={snap} />
        <Msg engine={engine} snap={snap} who={who} text={b.msg.line.en} ko={b.msg.line.ko} reveal={snap.reveal} help={help} onNext={() => engine.confirm()} />
      </>
    );
  }
  if (b.phase === 'menu') {
    const cur = MENU[b.menuIndex]!;
    return (
      <>
        <BattleTop snap={snap} />
        <div className="cmds" style={{ gridTemplateColumns: '1fr 1fr 1fr' }} data-testid="adv-menu">
          {MENU.map((c, i) => (
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
        <Rows
          engine={engine}
          snap={snap}
          rows={b.choices.map((t) => ({ key: t.id, en: t.labelEn, ko: t.labelKo, extra: { 'data-mode': t.mode } }))}
          onPick={(i) => engine.pickTalk(b.choices[i]!.id)}
          testid="adv-talk-choice"
        />
        <Line l={S.listHint} help={help} cls="hintline" />
        <button type="button" className="btn ghost" onClick={() => engine.cancel()} style={backStyle}>
          {S.back.en}
        </button>
      </div>
    );
  }
  if (b.phase === 'skillPick') {
    return (
      <div className="card" data-testid="adv-skills">
        <Line l={S.skillTitle} help={help} />
        <Rows
          engine={engine}
          snap={snap}
          rows={b.skills.map((k) => ({
            key: k.id,
            en: (
              <>
                ✦ {k.en}
                <span style={{ display: 'block', fontSize: 13, opacity: 0.85 }}>{k.info.en}</span>
              </>
            ),
            ko: `${k.ko} · ${k.info.ko}`,
            extra: { 'data-skill': k.id }
          }))}
          onPick={(i) => engine.pickSkill(b.skills[i]!.id)}
          testid="adv-skill"
        />
        <button type="button" className="btn ghost" onClick={() => engine.cancel()} style={backStyle}>
          {S.back.en}
        </button>
      </div>
    );
  }
  if (b.phase === 'talk' && b.current) return <TalkPanel key={b.current.id} engine={engine} snap={snap} item={b.current} help={help} />;
  if (b.phase === 'pouch') {
    return (
      <div className="card">
        <BattleTop snap={snap} />
        <Line l={S.pouchTitle} help={help} />
        <Rows
          engine={engine}
          snap={snap}
          rows={b.pouch.map((k) => ({ key: k, en: `${S.items[k].en} ×${b.items[k]} (+${ITEM_INFO[k].heal})`, ko: S.items[k].ko, extra: { 'data-item': k } }))}
          onPick={(i) => engine.useItem(b.pouch[i]!)}
          testid="adv-item"
        />
        <button type="button" className="btn ghost" onClick={() => engine.cancel()} style={backStyle}>
          {S.back.en}
        </button>
      </div>
    );
  }
  if (b.phase === 'poke') {
    return (
      <>
        <Line l={S.pokeHint} help={help} cls="hintline" />
        <button type="button" className="btn primary" data-primary style={{ minHeight: 80, alignItems: 'center', fontFamily: 'var(--f-pixel)' }} onPointerDown={() => engine.confirm()} data-testid="adv-poke">
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
        <BattleTop snap={snap} />
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
      <button type="button" className="btn primary" data-primary onClick={() => engine.confirm()} data-testid="adv-next">
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
  const go = e.nextNote === 'done-all' ? S.endingTitle : S.sailOn;
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
      <button type="button" className="btn go" data-primary onClick={() => engine.sailOn()} data-testid="adv-sail" style={{ alignItems: 'center' }}>
        {go.en} ▶{help && <span className="ko">{go.ko}</span>}
      </button>
      {e.back && (
        <a className="btn" href={e.back} data-testid="adv-back-doc" style={{ textDecoration: 'none', alignItems: 'center' }}>
          {S.backToDoc.en}
          {help && <span className="ko">{S.backToDoc.ko}</span>}
        </a>
      )}
      <button type="button" className="btn" onClick={() => engine.toTitle()} data-testid="adv-to-map" style={{ alignItems: 'center' }}>
        {S.toMap.en}
        {help && <span className="ko">{S.toMap.ko}</span>}
      </button>
      <a className="btn" href="/world/" style={{ textDecoration: 'none', alignItems: 'center' }}>
        {S.toWorld.en}
        {help && <span className="ko">{S.toWorld.ko}</span>}
      </a>
      <button type="button" className="btn ghost" style={backStyle} onClick={() => engine.openParent()}>
        {PARENT.title}
      </button>
    </div>
  );
}

function Story({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const st = snap.story!;
  const line = st.lines[st.i] ?? { en: '', ko: '' };
  const lastPage = st.kind === 'credits' && st.i === st.lines.length - 1;
  return (
    <div className="card" data-testid="adv-story" data-kind={st.kind} data-page={st.i} data-pages={st.lines.length}>
      <div style={{ fontWeight: 800 }}>
        {st.who}
        {snap.help && <span className="ko"> · {st.whoKo}</span>}
      </div>
      <Msg engine={engine} snap={snap} who={`${st.i + 1}/${st.lines.length}`} text={line.en} ko={line.ko} reveal={snap.reveal} help={snap.help} onNext={() => engine.confirm()} />
      {lastPage && <div style={{ textAlign: 'center', font: '18px var(--f-pixel)' }}>{S.theEnd.en}</div>}
    </div>
  );
}

function Down({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  const d = snap.down!;
  const help = snap.help;
  const wake = d.where === 'post' ? S.downWake : S.downWakeStart;
  return (
    <div className="card" data-testid="adv-down" data-where={d.where} data-boss={String(d.boss)}>
      <div style={{ fontWeight: 800, fontSize: 20 }}>
        {S.downTitle.en}
        {help && <div className="ko">{S.downTitle.ko}</div>}
      </div>
      <Line l={S.downBody} help={help} />
      <Line l={S.downTip} help={help} cls="hintline" />
      <button type="button" className="btn go" data-primary onClick={() => engine.wake()} data-testid="adv-wake" style={{ alignItems: 'center' }}>
        {wake.en} ▶{help && <span className="ko">{wake.ko}</span>}
      </button>
    </div>
  );
}

export function Panel({ engine, snap }: { engine: Engine; snap: Snapshot }) {
  return (
    <div className="adv-panel dark" data-testid={`adv-panel-${snap.scene}`}>
      {snap.scene === 'title' && <Title engine={engine} snap={snap} />}
      {snap.scene === 'story' && snap.story && <Story engine={engine} snap={snap} />}
      {snap.scene === 'down' && snap.down && <Down engine={engine} snap={snap} />}
      {snap.scene === 'explore' && <Explore engine={engine} snap={snap} />}
      {snap.scene === 'battle' && snap.battle && <Battle engine={engine} snap={snap} />}
      {snap.scene === 'end' && snap.end && <End engine={engine} snap={snap} />}
    </div>
  );
}
