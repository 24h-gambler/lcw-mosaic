import React, { useEffect, useRef, useState } from 'react';
import { joinWithCode, cleanCode, type JoinEnd } from '../audio/join.js';
import { Listener, listenState, type ListenEnd, type ListenState } from '../audio/listen.js';
import { ADV } from '../core/tuning.js';
import { S } from './strings.js';

type Note = { en: string; ko: string };

const NOTE_OF: Record<Exclude<ListenEnd['kind'], 'heard'>, Note> = {
  silent: S.micSilent,
  retry: S.micRetry,
  denied: S.micDenied,
  quota: S.micQuota,
  unsupported: S.micUnavailable,
  need_code: S.joinTitle
};

const JOIN_NOTE: Record<Extract<JoinEnd, { ok: false }>['reason'], Note> = {
  format: S.joinFormat,
  invalid: S.joinInvalid,
  busy: S.joinBusy,
  network: S.joinNetwork
};

/**
 * 🎤 + ⌨ for one spoken line (A04). The mic is the LCW server Whisper path (audio/listen.ts). A child with no token
 * gets the class code box right here (audio/join.ts), not a silent switch to typing. "Say it again" after a turn that
 * was not heard or not understood; typing when there is no microphone, it is refused, or the meter is resting.
 * `onAnswer(transcripts, mode)` gets what was heard or typed.
 */
export function Speak({
  help,
  onAnswer,
  placeholder,
  autoType = false,
  testid
}: {
  help: boolean;
  onAnswer: (transcripts: string[], mode: 'voice' | 'typed') => void;
  placeholder: string;
  autoType?: boolean;
  testid?: string;
}) {
  const [state, setState] = useState<ListenState>(() => listenState());
  const mic = state === 'ok';
  const [on, setOn] = useState(false);
  const [sending, setSending] = useState(false);
  const [level, setLevel] = useState('');
  const [note, setNote] = useState<Note | null>(state === 'unsupported' ? S.micUnavailable : null);
  const [typing, setTyping] = useState(state === 'unsupported' || autoType);
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const lis = useRef<Listener | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => lis.current?.abort(), []);
  // review #196 high 1: no microphone → the box is shown but not focused, so Z/Enter still move the game on;
  // the student clicks the box to type. A box the student asked for (autoType or the type toggle) is focused.
  useEffect(() => {
    if (typing && (autoType || state !== 'unsupported')) inputRef.current?.focus();
  }, [typing, autoType, state]);

  const start = () => {
    if (sending) return;
    if (on) {
      setSending(true);
      lis.current?.stop();
      return;
    }
    const l = new Listener();
    lis.current = l;
    setOn(true);
    setSending(false);
    setLevel('');
    setNote(null);
    l.start(
      (dots) => setLevel(dots),
      (r: ListenEnd) => {
        setOn(false);
        setSending(false);
        setLevel('');
        if (r.kind === 'heard') {
          onAnswer(r.alternatives, 'voice');
          return;
        }
        setNote(NOTE_OF[r.kind]);
        if (r.kind === 'need_code') setState('need_code');
        else if (r.kind === 'denied' || r.kind === 'unsupported' || r.kind === 'quota') {
          setState('unsupported');
          setTyping(true);
        }
      }
    );
  };

  const join = async () => {
    if (joining) return;
    setJoining(true);
    const r = await joinWithCode(code);
    setJoining(false);
    if (r.ok) {
      setCode('');
      setState(listenState());
      setNote(S.joinOk);
    } else setNote(JOIN_NOTE[r.reason]);
  };

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAnswer([t], 'typed');
    setText('');
  };

  return (
    <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      {mic && (
        <div className="row">
          <button type="button" className={`mic ${on ? 'on' : ''}`} onClick={start} aria-pressed={on} disabled={sending} data-primary data-testid="adv-mic">
            {on ? S.stop.en : `🎤 ${S.speak.en}`}
          </button>
          <div style={{ flex: 1, minWidth: 0 }} data-testid="adv-mic-state">
            {on && !sending && (
              <div className="hintline">
                {S.listening.en} {level && <span aria-hidden="true">🎙{level}</span>}
                {help && <div className="ko">{S.listening.ko}</div>}
              </div>
            )}
            {sending && (
              <div className="hintline">
                {S.micSending.en}
                {help && <div className="ko">{S.micSending.ko}</div>}
              </div>
            )}
          </div>
        </div>
      )}
      {state === 'need_code' && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
          data-testid="adv-join"
        >
          <div className="hintline" style={{ flexBasis: '100%' }}>
            <strong>{S.joinTitle.en}</strong> {S.joinHint.en}
            {help && (
              <div className="ko">
                {S.joinTitle.ko} {S.joinHint.ko}
              </div>
            )}
          </div>
          <input
            className="type"
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            placeholder={S.joinLabel.en}
            aria-label={S.joinLabel.en}
            inputMode="numeric"
            autoComplete="off"
            maxLength={ADV.joinCodeDigits}
            data-testid="adv-join-code"
          />
          <button type="submit" className="btn primary" disabled={joining} data-testid="adv-join-ok">
            {S.joinGo.en}
            {help && <span className="ko">{S.joinGo.ko}</span>}
          </button>
        </form>
      )}
      {note && (
        <div className="hintline" role="status" data-testid="adv-mic-note">
          {note.en}
          {help && <div className="ko">{note.ko}</div>}
        </div>
      )}
      {typing ? (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            className="type"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            data-testid={testid ?? 'adv-type'}
          />
          <button type="submit" className="btn primary" data-testid="adv-type-ok">
            {S.check.en}
          </button>
        </form>
      ) : (
        <button type="button" className="btn ghost" onClick={() => setTyping(true)} data-testid="adv-type-open">
          ⌨ {S.typeInstead.en}
          {help && <span className="ko">{S.typeInstead.ko}</span>}
        </button>
      )}
    </div>
  );
}
