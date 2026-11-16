/**
 * G10 도감·업적 (docs/08 8.6 "6권 탭, 진행 막대"; docs/03 D12 도감 6권: 블록, 광물, 적, 음식, 의상, 표현 / 업적).
 * What counts as found is the server's record only (GET /v1/collection); unfound entries show as a "?" silhouette.
 */
import React, { useEffect, useState } from 'react';
import { FRAME_STRINGS as F } from '../strings.js';
import { fetchCollection, type CollectionBook, type CollectionView } from '../api.js';
import type { MenuPanelProps } from './types.js';

export const BOOK_IDS = ['blocks', 'minerals', 'enemies', 'food', 'outfits', 'expressions'] as const;
const BOOK_ICONS: Record<string, string> = { blocks: '🧱', minerals: '💎', enemies: '👾', food: '🍪', outfits: '👕', expressions: '💬' };

/** Six books always in the spec order; a book the server did not send yet shows as empty (0 / 0). */
export function sixBooks(v: CollectionView | null): CollectionBook[] {
  return BOOK_IDS.map((id) => v?.books.find((b) => b.id === id) ?? { id, total: 0, found: 0, entries: [] });
}

/** 0..100, never NaN. */
export function bookPct(b: Pick<CollectionBook, 'found' | 'total'>): number {
  if (b.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((b.found / b.total) * 100)));
}

const BOOK_CSS = `
.lcw-menu .lcw-books{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px}
.lcw-menu .lcw-books button{display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:calc(104px * var(--fs));padding:8px 10px;border:2px solid var(--c-ink-900);border-radius:8px;background:var(--c-paper-0);cursor:pointer;text-align:left}
.lcw-menu .lcw-books button[aria-selected="true"]{background:var(--c-sun);box-shadow:var(--shadow)}
.lcw-menu .lcw-books .t{font-weight:800;display:flex;gap:6px;align-items:center}
.lcw-menu .lcw-books .c{font-size:calc(12px * var(--fs));color:var(--c-ink-700);font-weight:700;font-variant-numeric:tabular-nums}
.lcw-menu .lcw-entries{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(96px * var(--fs)),1fr));gap:8px;list-style:none;margin:0;padding:0}
.lcw-menu .lcw-entries li{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:8px;text-align:center;font-weight:700;font-size:calc(13px * var(--fs));word-break:keep-all}
.lcw-menu .lcw-entries li.no{background:var(--c-paper-100);border-style:dashed;border-color:var(--c-ink-500);color:var(--c-ink-500)}
.lcw-menu .lcw-entries .e{font-size:calc(28px * var(--fs));line-height:1.1}
.lcw-menu .lcw-entries li.no .e{filter:grayscale(1) brightness(.2);opacity:.35}
.lcw-menu .lcw-ach{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.lcw-menu .lcw-ach li{display:grid;grid-template-columns:1fr minmax(80px,30%);gap:10px;align-items:center;padding:8px 10px;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:8px;font-weight:700}
.lcw-menu .lcw-ach li.done{background:var(--c-leaf)}
@media (max-width:600px){.lcw-menu .lcw-books button{min-width:calc(30% - 4px);flex:1}}
`;

function Bar({ pct, label }: { pct: number; label: string }): React.ReactElement {
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function BookPanel(props: MenuPanelProps): React.ReactElement {
  const { auth, fetchImpl } = props;
  const [view, setView] = useState<CollectionView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'guest'>(auth.token ? 'loading' : 'guest');
  const [sel, setSel] = useState<string>('food');

  useEffect(() => {
    let live = true;
    if (auth.token)
      void fetchCollection(auth, fetchImpl).then((r) => {
        if (!live) return;
        if (r.ok) {
          setView(r.data);
          setState('ready');
          // open on the first book that has something in it
          const first = sixBooks(r.data).find((b) => b.found > 0);
          if (first) setSel(first.id);
        } else setState('offline');
      });
    return () => {
      live = false;
    };
  }, [auth, fetchImpl]);

  const books = sixBooks(view);
  const book = books.find((b) => b.id === sel) ?? books[0]!;
  return (
    <section>
      <style>{BOOK_CSS}</style>
      <h2>{F.bookTitle}</h2>
      {state === 'guest' ? <p className="note">{F.guestNote}</p> : null}
      {state === 'loading' ? <p className="muted">{F.loading}</p> : null}
      {state === 'offline' ? <p className="note">{F.offline}</p> : null}
      <div className="lcw-books" role="tablist" aria-label={F.bookTitle}>
        {books.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={b.id === book.id} onClick={() => setSel(b.id)}>
            <span className="t">
              <span aria-hidden="true">{BOOK_ICONS[b.id]}</span>
              {F.books[b.id] ?? b.id}
            </span>
            <Bar pct={bookPct(b)} label={`${F.books[b.id] ?? b.id} ${F.bookProgress(b.found, b.total)}`} />
            <span className="c">{F.bookProgress(b.found, b.total)}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={F.books[book.id] ?? book.id}>
        {book.entries.length === 0 ? (
          <p className="note">{F.bookEmptyBook}</p>
        ) : (
          <ul className="lcw-entries">
            {book.entries.map((e) => (
              <li key={e.key} className={e.found ? '' : 'no'}>
                <span className="e" aria-hidden="true">
                  {e.emoji ?? BOOK_ICONS[book.id]}
                </span>
                <span>{e.found ? e.name_ko : F.bookNotFound}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {view?.achievements && view.achievements.length > 0 ? (
        <>
          <h3>{F.achievementsTitle}</h3>
          <ul className="lcw-ach">
            {view.achievements.map((a) => {
              const pct = a.done ? 100 : a.goal ? Math.round(((a.progress ?? 0) / a.goal) * 100) : 0;
              return (
                <li key={a.id} className={a.done ? 'done' : ''}>
                  <span>
                    {a.done ? '🏅 ' : ''}
                    {a.name_ko}
                  </span>
                  <Bar pct={Math.max(0, Math.min(100, pct))} label={a.name_ko} />
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
