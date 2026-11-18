import { describe, it } from 'vitest';
import { publicSafeText, publicFacts } from '../parent-report';
describe('mine', () => { it('probe', () => {
  const names = ['지우'];
  const leak = ['Hi jiwoo','I like jiwoo','Can I sit with jiwoo','jiwoo can i have tea','(Seoyeon) can I have tea','...Seoyeon can I have tea','I like ji-woo','we live at mapo apartment','Will likes tea','June is my friend','Bye minji'];
  for (const s of leak) console.log('LEAK?', JSON.stringify(s), publicSafeText(s, norm(names)));
  const ok = ['Okay','Sure, I like cats','Pizza is good','Dogs are cute','Nothing','Can I have a warm honey tea?','Thank you! See you next time.','Can I have ten wooden blocks because I am building a bakery?','Jiwoo, can I have tea?','Hello Jiwoo','My name is Jiwoo'];
  for (const s of ok) console.log('LEGIT', JSON.stringify(s), publicSafeText(s, ['juno']));
  const pf: any = publicFacts({lesson:{quotes:[{text:'I like jiwoo',stars:1}],expressions:['Hi jiwoo'],home_practice:['I like jiwoo'],stages:[{id:'zz',title_ko:'지우네 집 010-1234-5678'}],summary_ko:'지우 010-1234-5678'}}, names as any);
  console.log('PF', JSON.stringify(pf.lesson));
});});
function norm(a:string[]){return a;}
