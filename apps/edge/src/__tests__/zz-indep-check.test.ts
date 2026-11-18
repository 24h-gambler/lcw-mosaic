import { it } from 'vitest';
import { publicFacts, publicSafeText } from '../parent-report.js';
import { writeFileSync } from 'node:fs';
const L: string[] = [];
it('indep', () => {
  for (const t of ['Hi jiwoo','I like jiwoo','jiwoo can i have tea','we live at mapo apartment','I go to hannuri school','June is my friend','Hi Jiwoo','Jiwoo can I have tea','Okay','Pizza is good','Can I have a warm honey tea?','Can I have ten wooden blocks because I am building a bakery?','Thank you! See you next time.','Dogs are cute']) {
    const pf = publicFacts({ lesson: { quotes: [{ text: t, stars: 3 }], expressions: [t], home_practice: [t] } }, ['지우']) as any;
    L.push(`${JSON.stringify(t)} safe=${publicSafeText(t,['지우'])} pf q/e/h=${pf.lesson.quotes.length}/${pf.lesson.expressions.length}/${pf.lesson.home_practice.length}`);
  }
  const pf = publicFacts({ lesson: { summary_ko: '지우 010-1234-5678', stages:[{id:'nope',title_ko:'지우네 집 010-1234-5678'}] } }, ['지우']) as any;
  L.push('stage/summary '+JSON.stringify([pf.lesson.summary_ko, pf.lesson.stages]));
  writeFileSync('Z:/automation-offload/delegate-out/t_84b035c5f31c/indep1.log', L.join('\n'));
});
