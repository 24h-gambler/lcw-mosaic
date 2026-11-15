/** W04 tutoring page (docs/14 §7). Sample screens are labelled 예시 until real data exists. */
import React, { useState } from 'react';
import { FIRST_LESSON_PLAN } from '@lcw/content';
import { SAMPLE_REPORT, TUTORING } from '../copy.js';
import { track } from '../track.js';
import { ListenButton } from '../widgets.js';

const ARC_TONE = ['s-tag-sky', 's-btn-sun', 's-btn-brand', 's-tag-leaf', 's-btn-sky', 's-tint'];

export function LessonArc(): React.ReactElement {
  const total = FIRST_LESSON_PLAN.totalMinutes;
  let start = 0;
  return (
    <div className="s-arc" role="list" aria-label={`${total}분 수업 흐름`}>
      {FIRST_LESSON_PLAN.stages.map((s, i) => {
        const from = start;
        start += s.minutes;
        return (
          <div key={s.id} role="listitem" style={{ flex: `${s.minutes} 1 0` }}>
            <i className={ARC_TONE[i % ARC_TONE.length]} />
            <b>{s.titleKo}</b>
            <small>
              {from}~{start}분 · {s.studentGoalKo}
            </small>
          </div>
        );
      })}
    </div>
  );
}

export interface ConsultForm {
  name: string;
  contact: string;
  grade: string;
  days: string[];
  note: string;
}

export const CONSULT_ENDPOINT = '/v1/site/consult';

/** Client-side check mirrors the edge schema: a name and a phone number or e-mail. */
export function validateConsult(f: ConsultForm): boolean {
  const name = f.name.trim();
  const contact = f.contact.trim();
  const phone = /^[0-9+\-\s()]{9,20}$/.test(contact) && contact.replace(/\D/g, '').length >= 9;
  const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
  return name.length >= 1 && name.length <= 40 && (phone || mail) && f.note.length <= 500;
}

function ConsultFormView(): React.ReactElement {
  const [f, setF] = useState<ConsultForm>({ name: '', contact: '', grade: '', days: [], note: '' });
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'invalid'>('idle');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateConsult(f)) {
      setState('invalid');
      return;
    }
    setState('sending');
    try {
      const r = await fetch(CONSULT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ name: f.name.trim(), contact: f.contact.trim(), grade: f.grade, days: f.days, note: f.note.trim() })
      });
      if (!r.ok) throw new Error(String(r.status));
      track('consult_submit');
      setState('sent');
    } catch {
      setState('error');
    }
  };
  if (state === 'sent')
    return (
      <div className="s-note s-ok" role="status" style={{ fontSize: 18, lineHeight: '28px' }}>
        {TUTORING.sent}
      </div>
    );
  return (
    <form className="s-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="s-grid-2" style={{ gap: 16 }}>
        <div className="s-field">
          <label htmlFor="c-name">{TUTORING.fName}</label>
          <input id="c-name" autoComplete="name" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </div>
        <div className="s-field">
          <label htmlFor="c-contact">{TUTORING.fContact}</label>
          <input id="c-contact" autoComplete="tel" inputMode="tel" value={f.contact} maxLength={80} onChange={(e) => setF({ ...f, contact: e.target.value })} required />
        </div>
      </div>
      <div className="s-field">
        <label htmlFor="c-grade">{TUTORING.fGrade}</label>
        <select id="c-grade" value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })}>
          <option value="">선택</option>
          {TUTORING.grades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="s-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>{TUTORING.fDays}</legend>
        <div className="s-checks">
          {TUTORING.days.map((d) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={f.days.includes(d)}
                onChange={(e) => setF({ ...f, days: e.target.checked ? [...f.days, d] : f.days.filter((x) => x !== d) })}
              />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="s-field">
        <label htmlFor="c-note">{TUTORING.fNote}</label>
        <textarea id="c-note" rows={3} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </div>
      {state === 'invalid' ? <p className="s-note s-warn" role="alert">{TUTORING.invalid}</p> : null}
      {state === 'error' ? <p className="s-note s-warn" role="alert">{TUTORING.error}</p> : null}
      <p className="s-small">{TUTORING.privacy}</p>
      <button type="submit" className="s-btn s-btn-brand s-btn-lg" disabled={state === 'sending'} style={{ justifySelf: 'start' }}>
        {state === 'sending' ? TUTORING.sending : TUTORING.submit}
      </button>
    </form>
  );
}

function ReportPhone(): React.ReactElement {
  const R = SAMPLE_REPORT;
  return (
    <div className="s-phone" aria-label="수업 리포트 예시 화면">
      <div className="s-phone-in">
        <div className="s-phone-sec">
          <span className="s-row" style={{ justifyContent: 'space-between' }}>
            <strong>{R.date}</strong>
            <span className="s-tag s-tag-sample">예시</span>
          </span>
          <span>▶ {R.clip}</span>
          <span className="s-small">“{R.clipCap}”</span>
        </div>
        <div className="s-phone-sec">
          {R.rows.map((r) => (
            <span key={r.k} className="s-row" style={{ justifyContent: 'space-between' }}>
              <span>{r.k}</span>
              <b>{r.v}</b>
            </span>
          ))}
          <span className="s-small">대화 밀도</span>
          <span className="s-band" aria-hidden="true">
            {R.band.map((b, i) => (
              <i key={i} style={{ opacity: b / 5 }} />
            ))}
          </span>
        </div>
        <div className="s-phone-sec">
          <strong>같은 과제, 4주 전과 오늘</strong>
          <span>
            ▶ {R.before.d} · {R.before.v}
          </span>
          <span>
            ▶ {R.after.d} · {R.after.v}
          </span>
        </div>
        <div className="s-phone-sec">
          <strong>{R.exprTitle}</strong>
          <span className="s-en-sm" lang="en">
            {R.exprs.join(' · ')}
          </span>
        </div>
        <div className="s-phone-sec">
          <span>{R.solo}</span>
          <span className="s-small">{R.next}</span>
        </div>
      </div>
    </div>
  );
}

export function TutoringPage(): React.ReactElement {
  const W = TUTORING.windowSample;
  return (
    <>
      <section className="s-hero">
        <div className="s-wrap s-stack" style={{ gap: 24 }}>
          <div className="s-hero-copy" style={{ maxWidth: 760 }}>
            <span className="s-eyebrow">과외 수업</span>
            <h1 className="s-h1">{TUTORING.title}</h1>
            <p className="s-lead">{TUTORING.lead}</p>
            <a href="#consult" className="s-btn s-btn-brand" style={{ justifySelf: 'start' }}>
              {TUTORING.formTitle} ↓
            </a>
          </div>
          <div className="s-stack" style={{ gap: 12 }}>
            <h2 className="s-h3">{TUTORING.arcTitle}</h2>
            <p className="s-muted">{TUTORING.arcBody}</p>
            <LessonArc />
          </div>
        </div>
      </section>

      <section className="s-sec s-sec-tint">
        <div className="s-wrap s-split">
          <div className="s-stack">
            <h2 className="s-h2">{TUTORING.windowTitle}</h2>
            <p className="s-lead">{TUTORING.windowBody}</p>
          </div>
          <div className="s-card s-stack" style={{ gap: 10 }}>
            <span className="s-row" style={{ justifyContent: 'space-between' }}>
              <strong>수업 창문</strong>
              <span className="s-tag s-tag-sample">예시 화면</span>
            </span>
            <div className="s-note">
              <b>{W.place}</b> · {W.situation}
            </div>
            <span className="s-small">화면의 목표 문장</span>
            <span className="s-row">
              <span className="s-en" lang="en">
                {W.target}
              </span>
              <ListenButton text={W.target} />
            </span>
            <span className="s-small">10초마다 갱신 · 영상 없음</span>
          </div>
        </div>
      </section>

      <section className="s-sec">
        <div className="s-wrap s-split">
          <ReportPhone />
          <div className="s-stack">
            <h2 className="s-h2">{TUTORING.reportTitle}</h2>
            <p className="s-lead">{TUTORING.reportBody}</p>
            <h3 className="s-h3" style={{ marginTop: 16 }}>
              {TUTORING.monthTitle}
            </h3>
            <p className="s-muted">{TUTORING.monthBody}</p>
          </div>
        </div>
      </section>

      {TUTORING.teacherIntro ? (
        <section className="s-sec s-sec-tint">
          <div className="s-wrap s-stack">
            <h2 className="s-h2">{TUTORING.teacherTitle}</h2>
            <p className="s-lead">{TUTORING.teacherIntro}</p>
          </div>
        </section>
      ) : null}

      <section className="s-sec s-sec-tint" id="consult">
        <div className="s-wrap s-split" style={{ alignItems: 'start' }}>
          <div className="s-stack">
            <h2 className="s-h2">{TUTORING.formTitle}</h2>
            <p className="s-lead">{TUTORING.formBody}</p>
          </div>
          <div className="s-card">
            <ConsultFormView />
          </div>
        </div>
      </section>
    </>
  );
}
