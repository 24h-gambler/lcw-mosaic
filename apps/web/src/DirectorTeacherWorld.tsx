/**
 * The console's two R325 boxes (Dan 11-19 lesson: "LCW 가 선생님과 함께 진행되지 않는다", "선생님이 여러 도구와 물건을
 * 가지고 있어 아이와 거래"): the teacher's own voice in the child's world, and the trades with the child. The same
 * routes the teacher's 3D page uses (apps/client world/TeacherBar.tsx). docs/18 §11.
 */
import React, { useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { TEACHER_STOCK, type LessonStage } from '@lcw/content';
import { errorCodeOf, type LessonApi } from './lessonApi.js';
import type { FeedTrade } from './directorLiveState.js';
import { Box, Notice, inputStyle, sp } from './lessonUi.js';
import { M } from './directorMoreStrings.js';

const C = TOKENS.colors;
const T = TOKENS.typography;

/** One id per console action: the server keeps one gift per id (a double click gives one thing). */
export function consoleActionId(now: number, rand: () => number = Math.random): string {
  return `c${Math.floor(now)}-${String(Math.floor(rand() * 10_000)).padStart(4, '0')}`;
}

export function TeacherSayBox(p: {
  api: Pick<LessonApi, 'npcSay'>;
  token: string;
  lessonId: string;
  stage: LessonStage | undefined;
  disabled: boolean;
  onSent: () => void;
  onAuthError: (code: string) => void;
}): React.ReactElement {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const say = async (line: string) => {
    const t = line.trim().slice(0, 280);
    if (!t) return;
    try {
      await p.api.npcSay(p.token, p.lessonId, { npc_id: 'teacher', text: t });
      setText('');
      setMsg({ ok: true, text: M.sayDone });
      p.onSent();
    } catch (e) {
      p.onAuthError(errorCodeOf(e));
      setMsg({ ok: false, text: M.sayFailed });
    }
  };
  const quick = p.stage ? [p.stage.teacherScriptEn, ...(p.stage.followUpsEn ?? [])].filter(Boolean).slice(0, 4) : [];
  return (
    <Box title={M.sayTitle} testId="director-teacher-say">
      <form
        style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          void say(text);
        }}
      >
        <input
          data-testid="teacher-say-input"
          lang="en"
          value={text}
          maxLength={280}
          placeholder={M.sayPlaceholder}
          aria-label={M.sayPlaceholder}
          onChange={(e) => setText(e.target.value)}
          disabled={p.disabled}
          style={{ ...inputStyle, flex: '1 1 220px' }}
        />
        <Button type="submit" variant="brand" disabled={p.disabled || !text.trim()} data-testid="teacher-say-send">
          {M.saySend}
        </Button>
      </form>
      {quick.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1), marginTop: sp(2) }}>
          {quick.map((q) => (
            <Button key={q} type="button" variant="paper" disabled={p.disabled} onClick={() => void say(q)}>
              <span lang="en" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale.small.sizePx}px` }}>
                {q}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      {msg ? (
        msg.ok ? (
          <p role="status" style={{ margin: `${sp(2)} 0 0`, color: C['leaf-d'], fontWeight: 700 }}>
            {msg.text}
          </p>
        ) : (
          <Notice>{msg.text}</Notice>
        )
      ) : null}
    </Box>
  );
}

export function TradeBox(p: {
  api: Pick<LessonApi, 'give'>;
  token: string;
  lessonId: string;
  trades: readonly FeedTrade[];
  disabled: boolean;
  onSent: () => void;
  onAuthError: (code: string) => void;
  now?: () => number;
}): React.ReactElement {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const give = async (key: string, label: string) => {
    try {
      await p.api.give(p.token, p.lessonId, { item_key: key, client_id: consoleActionId((p.now ?? Date.now)()) });
      setMsg({ ok: true, text: M.given(label) });
      p.onSent();
    } catch (e) {
      p.onAuthError(errorCodeOf(e));
      setMsg({ ok: false, text: M.sayFailed });
    }
  };
  return (
    <Box title={M.tradeTitle(p.trades.length)} testId="director-trades">
      {p.trades.length === 0 ? (
        <p style={{ margin: 0, fontSize: `${T.scale.small.sizePx}px`, color: C['ink-700'] }}>{M.tradesEmpty}</p>
      ) : (
        <ol data-testid="director-trade-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: sp(1) }}>
          {p.trades.slice(0, 8).map((t) => (
            <li key={t.client_id} style={{ fontSize: `${T.scale.small.sizePx}px` }}>
              <strong>{M.tradeRow(t.kind, t.get_key, t.give_key)}</strong>
              {t.kind === 'trade' ? (
                <span lang="en" style={{ marginLeft: sp(2), color: t.ok ? C['leaf-d'] : C['sun-d'] }}>
                  {t.ok ? '✅' : '🔁'} “{t.transcript}”
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <details style={{ marginTop: sp(2) }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{M.giveLabel}</summary>
        <div data-testid="director-give" style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1), marginTop: sp(2) }}>
          {TEACHER_STOCK.map((it) => (
            <Button key={it.key} type="button" variant="paper" disabled={p.disabled} onClick={() => void give(it.key, it.nameKo)}>
              {it.emoji} {it.nameKo}
            </Button>
          ))}
        </div>
      </details>
      {msg ? (
        msg.ok ? (
          <p role="status" style={{ margin: `${sp(2)} 0 0`, color: C['leaf-d'], fontWeight: 700 }}>
            {msg.text}
          </p>
        ) : (
          <Notice>{msg.text}</Notice>
        )
      ) : null}
    </Box>
  );
}
