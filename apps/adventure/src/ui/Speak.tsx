import React, { useEffect, useRef, useState } from 'react';
import { Listener, canListen, type ListenEnd } from '../audio/listen.js';
import { S } from './strings.js';

/**
 * 🎤 + ⌨ for one spoken line (A04): the mic when the browser can listen, typing at once when it cannot or when the
 * mic is refused or silent. `onAnswer(transcripts, mode)` gets what was heard or typed.
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
  const [mic] = useState(() => canListen());
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const [note, setNote] = useState<null | { en: string; ko: string }>(mic ? null : S.micUnavailable);
  const [typing, setTyping] = useState(!mic || autoType);
  const [text, setText] = useState('');
  const lis = useRef<Listener | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => lis.current?.abort(), []);
  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing]);

  const start = () => {
    if (on) {
      lis.current?.stop();
      return;
    }
    const l = new Listener();
    lis.current = l;
    setOn(true);
    setInterim('');
    setNote(null);
    l.start(
      (t) => setInterim(t),
      (r: ListenEnd) => {
        setOn(false);
        if (r.kind === 'heard') onAnswer(r.alternatives, 'voice');
        else {
          setNote(r.kind === 'denied' ? S.micDenied : r.kind === 'silent' ? S.micSilent : S.micUnavailable);
          if (r.kind !== 'silent') setTyping(true);
        }
      }
    );
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
          <button type="button" className={`mic ${on ? 'on' : ''}`} onClick={start} aria-pressed={on} data-testid="adv-mic">
            {on ? S.stop.en : `🎤 ${S.speak.en}`}
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            {on && <div className="hintline">{S.listening.en}{help && <div className="ko">{S.listening.ko}</div>}</div>}
            {interim && (
              <div className="hintline">
                {S.heard.en}: “{interim}”
              </div>
            )}
          </div>
        </div>
      )}
      {note && (
        <div className="hintline" role="status">
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
