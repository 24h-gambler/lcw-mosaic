/** Public site entry (docs/14): routing among W01–W09, page metadata, stylesheet. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { siteCss } from './siteCss.js';
import { NavContext, SiteFooter, SiteHeader } from './SiteShell.js';
import { metaFor, parseSitePath, type SiteLocation } from './routes.js';
import { LandingPage } from './pages/Landing.js';
import { ParentsPage } from './pages/Parents.js';
import { PlayPage } from './pages/Play.js';
import { TutoringPage } from './pages/Tutoring.js';
import { PricingPage } from './pages/Pricing.js';
import { LegalPage, PassPage, SafetyPage } from './pages/Info.js';
import { LearnIndexPage, LearnPage } from './pages/Learn.js';
import { ShowroomPage, WorldsPage } from './pages/Showroom.js';
import { TryScene, type TrySceneProps } from './TryScene.js';

const CSS = siteCss();

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name'): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

export function SitePageView({ loc, tryProps }: { loc: SiteLocation; tryProps?: TrySceneProps }): React.ReactElement {
  switch (loc.page) {
    case 'home':
      return <LandingPage />;
    case 'parents':
      return <ParentsPage />;
    case 'play':
      return <PlayPage />;
    case 'tutoring':
      return <TutoringPage />;
    case 'pricing':
      return <PricingPage />;
    case 'safety':
      return <SafetyPage />;
    case 'terms':
      return <LegalPage kind="terms" />;
    case 'privacy':
      return <LegalPage kind="privacy" />;
    case 'learn':
      return <LearnIndexPage />;
    case 'learnPage':
      return <LearnPage slug={loc.param ?? ''} />;
    case 'worlds':
      return <WorldsPage />;
    case 'showroom':
      return <ShowroomPage token={loc.param ?? ''} />;
    case 'pass':
      return <PassPage />;
    case 'try':
      return <TryScene {...tryProps} />;
    default:
      return <LandingPage />;
  }
}

export interface SiteRootProps {
  initialPath: string;
  tryProps?: TrySceneProps;
}

export function SiteRoot({ initialPath, tryProps }: SiteRootProps): React.ReactElement {
  const [path, setPath] = useState(initialPath);
  const loc = useMemo(() => parseSitePath(path) ?? { page: 'home' as const, path: '/' }, [path]);

  const navigate = useCallback((to: string) => {
    const [base, hash] = to.split('#');
    const target = base || '/';
    if (typeof window !== 'undefined') {
      if (window.location.pathname !== target || hash) window.history.pushState(null, '', to);
      setPath(target);
      requestAnimationFrame(() => {
        const el = hash ? document.getElementById(hash) : null;
        if (el) el.scrollIntoView({ block: 'start' });
        else window.scrollTo(0, 0);
      });
    } else setPath(target);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const m = metaFor(loc);
    document.title = m.title;
    setMeta('description', m.description);
    setMeta('og:title', m.title, 'property');
    setMeta('og:description', m.description, 'property');
    setMeta('og:type', 'website', 'property');
    const hash = window.location.hash.slice(1);
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }));
  }, [loc]);

  const ctx = useMemo(() => ({ navigate, path: loc.path }), [navigate, loc.path]);
  const page = <SitePageView loc={loc} tryProps={tryProps} />;
  return (
    <NavContext.Provider value={ctx}>
      <div className="s-root" data-site-page={loc.page}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        {loc.page === 'try' ? (
          page
        ) : (
          <>
            <SiteHeader />
            <main id="main">{page}</main>
            <SiteFooter />
          </>
        )}
      </div>
    </NavContext.Provider>
  );
}
