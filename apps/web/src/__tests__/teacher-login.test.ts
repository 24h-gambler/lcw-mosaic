import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LessonDirectorConsole } from '../LessonDirector.js';
import { TEACHER_SIGN_IN_PATH, isOperatorSession, operatorSignInFromHash, operatorTokenFromResult } from '../lessonApi.js';
import { LESSON_STRINGS_KO } from '../strings.js';

const S = LESSON_STRINGS_KO.director;
const SESSION = `lcwop_${'a'.repeat(64)}`;

describe('teacher Google sign-in on /director (operator-login.ts via the shared OAuth module)', () => {
  it('back from Google: a one-use code in the fragment, the session only from the exchange result', () => {
    const code = 'ab'.repeat(16);
    expect(operatorSignInFromHash(`#oauth=${code}`)).toEqual({ code });
    expect(operatorSignInFromHash('#oauth_error=not_an_operator')).toEqual({ error: 'not_an_operator' });
    // a session token in the address bar is never taken (the shared module never puts one there)
    expect(operatorSignInFromHash(`#op=${SESSION}`)).toBeNull();
    expect(operatorSignInFromHash('#g=abc')).toBeNull();
    expect(operatorSignInFromHash('')).toBeNull();
    expect(operatorTokenFromResult(`op=${SESSION}`)).toBe(SESSION);
    expect(operatorTokenFromResult('op=op-token-0123456789abcdef')).toBeNull();
    expect(operatorTokenFromResult(`g=${'a'.repeat(64)}`)).toBeNull();
    expect(operatorTokenFromResult(null)).toBeNull();
    expect(isOperatorSession(SESSION)).toBe(true);
    expect(isOperatorSession('op-token-0123456789abcdef')).toBe(false);
    expect(isOperatorSession(null)).toBe(false);
  });

  it('without a key the console offers Google first and keeps the ops key box (today\'s path)', () => {
    const html = renderToStaticMarkup(React.createElement(LessonDirectorConsole, { initialToken: null }));
    expect(html).toContain('data-testid="teacher-google"');
    expect(html).toContain(`href="${TEACHER_SIGN_IN_PATH.replace(/&/g, '&amp;')}"`);
    expect(html).toContain(S.googleSignIn);
    expect(html).toContain(S.keyOr);
    expect(html).toContain(S.keyPlaceholder);
    expect(TEACHER_SIGN_IN_PATH).toBe('/v1/oauth/google/start?role=teacher&return=%2Fdirector');
  });

  it('a Google session shows the account box with logout; an ops key keeps the old key row', () => {
    const signedIn = renderToStaticMarkup(React.createElement(LessonDirectorConsole, { initialToken: SESSION, initialLesson: null }));
    expect(signedIn).toContain('data-testid="teacher-account"');
    expect(signedIn).toContain(S.logout);
    expect(signedIn).not.toContain(S.keySaved);
    const key = renderToStaticMarkup(React.createElement(LessonDirectorConsole, { initialToken: 'op-key', initialLesson: null }));
    expect(key).toContain(S.keySaved);
    expect(key).not.toContain('data-testid="teacher-account"');
  });
});
