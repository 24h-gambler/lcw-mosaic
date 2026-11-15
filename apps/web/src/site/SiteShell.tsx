import React, { createContext, useContext, useState } from 'react';
import { FOOTER, NAV } from './copy.js';
import { isSitePath } from './routes.js';

type Navigate = (path: string) => void;

export const NavContext = createContext<{ navigate: Navigate; path: string }>({ navigate: () => undefined, path: '/' });

/** Site link: in-app navigation for site paths (no reload), a normal link for everything else (game, lesson). */
export function SLink({
  to,
  className,
  children,
  onClick,
  ...rest
}: { to: string; className?: string; children?: React.ReactNode; onClick?: () => void } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href' | 'onClick'
>): React.ReactElement {
  const { navigate, path } = useContext(NavContext);
  const [base, hash] = to.split('#');
  const internal = isSitePath(base || '/');
  const current = internal && (base || '/') === path;
  return (
    <a
      {...rest}
      href={to}
      className={className}
      aria-current={current && !hash ? 'page' : undefined}
      onClick={(e) => {
        onClick?.();
        if (!internal || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

export function LogoMark(): React.ReactElement {
  return (
    <span className="s-logo-mark" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

const NAV_ITEMS: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/parents', label: NAV.parents },
  { to: '/play', label: NAV.play },
  { to: '/tutoring', label: NAV.tutoring },
  { to: '/pricing', label: NAV.pricing }
];

export function SiteHeader(): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <header className="s-head">
      <a className="s-skip" href="#main">
        {NAV.skip}
      </a>
      <div className="s-wrap s-head-in">
        <SLink to="/" className="s-logo" aria-label="LCW 처음으로">
          <LogoMark />
          <span className="s-pixel">LCW</span>
        </SLink>
        <nav className="s-nav" aria-label="사이트 메뉴">
          {NAV_ITEMS.map((n) => (
            <SLink key={n.to} to={n.to}>
              {n.label}
            </SLink>
          ))}
          <SLink to="/try" className="s-btn s-btn-brand" style={{ marginLeft: 8 }}>
            {NAV.try}
          </SLink>
        </nav>
        <button
          type="button"
          className="s-btn s-menu-btn"
          aria-expanded={open}
          aria-controls="s-mnav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? NAV.close : NAV.menu}
        </button>
      </div>
      <nav id="s-mnav" className="s-mnav" data-open={open ? '1' : '0'} aria-label="사이트 메뉴(모바일)">
        {NAV_ITEMS.map((n) => (
          <SLink key={n.to} to={n.to} onClick={() => setOpen(false)}>
            {n.label}
          </SLink>
        ))}
        <SLink to="/try" onClick={() => setOpen(false)}>
          {NAV.try}
        </SLink>
      </nav>
    </header>
  );
}

export function SiteFooter(): React.ReactElement {
  return (
    <footer className="s-foot">
      <div className="s-wrap s-foot-grid">
        <div className="s-stack" style={{ gap: 12 }}>
          <span className="s-logo" style={{ color: 'inherit' }}>
            <LogoMark />
            <span className="s-pixel">LCW</span>
          </span>
          <p>{FOOTER.tagline}</p>
          <p>{FOOTER.note}</p>
        </div>
        <div>
          <h3>{FOOTER.colSite}</h3>
          <ul>
            <li><SLink to="/parents">{NAV.parents}</SLink></li>
            <li><SLink to="/play">{NAV.play}</SLink></li>
            <li><SLink to="/tutoring">{NAV.tutoring}</SLink></li>
            <li><SLink to="/pricing">{NAV.pricing}</SLink></li>
          </ul>
        </div>
        <div>
          <h3>{FOOTER.colLearn}</h3>
          <ul>
            <li><SLink to="/try">{NAV.try}</SLink></li>
            <li><SLink to="/learn">{FOOTER.learn}</SLink></li>
            <li><SLink to="/worlds">{FOOTER.worlds}</SLink></li>
            <li><SLink to="/pass">{FOOTER.pass}</SLink></li>
          </ul>
        </div>
        <div>
          <h3>{FOOTER.colTrust}</h3>
          <ul>
            <li><SLink to="/safety">{FOOTER.safety}</SLink></li>
            <li><SLink to="/terms">{FOOTER.terms}</SLink></li>
            <li><SLink to="/privacy">{FOOTER.privacy}</SLink></li>
          </ul>
          <p style={{ marginTop: 16 }}>{FOOTER.copyright}</p>
        </div>
      </div>
    </footer>
  );
}
