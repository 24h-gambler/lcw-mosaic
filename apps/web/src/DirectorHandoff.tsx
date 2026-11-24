/**
 * `/director` after R331 (Dan 11-23): the lesson runs from the in-world teacher panel (`/world/?teach=new`), so this
 * address is the teacher's sign-in door and the handoff to the world. The world's teacher mode reads the console
 * sign-in from this browser (`lcw.operatorToken`), so a teacher who is not signed in yet must sign in here first —
 * otherwise the world button would drop them into the world as a plain player (R331 review: the live run had the token
 * planted and did not show this). Seats, sign-up approval and the rest of the ops console stay below, folded once
 * signed in.
 */
import React, { useState } from 'react';
import { Card, TOKENS } from '@lcw/ui';
import { LessonDirectorConsole, prepFocus, type LessonDirectorConsoleProps } from './LessonDirector.js';
import { loadOperatorToken } from './lessonApi.js';

/** Where the world's teacher mode starts a lesson. */
export const WORLD_TEACH_URL = '/world/?teach=new';

/** The world button's address; the hub's '다음 수업 준비' (`/director?prep=<id>`) carries the student into the world's start list. */
export function worldTeachUrl(prep: string | null): string {
  return prep ? `${WORLD_TEACH_URL}&prep=${encodeURIComponent(prep)}` : WORLD_TEACH_URL;
}

export const HANDOFF_COPY = {
  title: '수업은 월드 안에서 — 선생님 패널로 이동했어요',
  body: '수업 시작·목표 문장·아이가 한 말·핀·교환·수업 끝은 이제 월드 안 선생님 패널에서 합니다. 이 주소는 로그인하고 넘어가는 길이에요.',
  go: '월드에서 수업 시작하기',
  signInFirst: '먼저 아래에서 선생님 로그인(Google 또는 운영 열쇠)을 해 주세요. 로그인하면 월드로 넘어가는 단추가 켜져요.',
  legacy: '운영 콘솔 (좌석·가입 승인 · 열려 있는 옛 수업)',
  signIn: '선생님 로그인'
} as const;

export function DirectorHandoff(props: { console?: LessonDirectorConsoleProps; initialToken?: string | null; search?: string }): React.ReactElement {
  const [token, setToken] = useState<string | null>(() =>
    props.initialToken !== undefined ? props.initialToken : loadOperatorToken()
  );
  const signedIn = Boolean(token && token.length >= 16);
  const [prep] = useState(() => prepFocus(props.search));
  const btn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    padding: `0 ${TOKENS.spacing[4]}px`,
    borderRadius: 12,
    background: TOKENS.colors['brand-d'],
    color: TOKENS.colors['paper-0'],
    fontWeight: 700,
    textDecoration: 'none'
  };
  return (
    <div data-testid="director-handoff" style={{ display: 'grid', gap: `${TOKENS.spacing[3]}px` }}>
      <Card title={HANDOFF_COPY.title}>
        <p>{HANDOFF_COPY.body}</p>
        {signedIn ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: `${TOKENS.spacing[2]}px` }}>
            <a href={worldTeachUrl(prep)} className="lcw-btn" data-testid="director-handoff-go" style={btn}>
              {HANDOFF_COPY.go}
            </a>
          </div>
        ) : (
          <p data-testid="director-handoff-signin" style={{ fontWeight: 700 }}>
            {HANDOFF_COPY.signInFirst}
          </p>
        )}
      </Card>
      {/* Not signed in: the console (its sign-in box on top) is open; signed in: folded, the world is the way. */}
      <details data-testid="director-legacy" open={!signedIn}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{signedIn ? HANDOFF_COPY.legacy : HANDOFF_COPY.signIn}</summary>
        <LessonDirectorConsole {...(props.console ?? {})} {...(props.initialToken !== undefined ? { initialToken: props.initialToken } : {})} onToken={setToken} />
      </details>
    </div>
  );
}
