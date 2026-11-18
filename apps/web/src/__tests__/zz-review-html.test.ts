// THROWAWAY review probe
import { it } from 'vitest';
import React from 'react';
import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportBody } from '../ParentReportPage.js';
it('html', () => {
  const lesson = { lesson_day: '2026-11-16', lesson_number: 3, duration_min: 95, utterances: 24, passes: 19, free_words: 112, speaking_sec: 1385, summary_ko: '',
    quotes: [
      { text: 'Can I have ten wooden blocks because I am building a bakery', stars: 3, stage_title_ko: '상점에서 재료 사기', hintless: true },
      { text: 'Can I have a strawberry smoothie please', stars: 2, stage_title_ko: '카페에서 음료 주문하기', hintless: false },
      { text: 'I want a jetpack so that I can fly to school every single morning', stars: 1, stage_title_ko: '질문에 자유롭게 대답하기', hintless: true }],
    expressions: ['so that', 'because I am', 'Can I have a warm honey tea please', 'would you like', 'would you like some'],
    stages: [
      { id: 'a', title_ko: '선생님과 인사하고 내 이야기 하기', main: false, utterances: 4, passes: 4 },
      { id: 'b', title_ko: '카페에서 음료 주문하기', main: true, utterances: 10, passes: 8 },
      { id: 'c', title_ko: '선생님과 물건 바꾸기 놀이', main: true, utterances: 10, passes: 7 }],
    previous: { utterances: 20, passes: 12, speaking_sec: 1000, free_words: 80 },
    home_practice: ['Can I have a warm honey tea, please?', 'Can I have ten wooden blocks because I am building a bakery?'] };
  const r: any = { kind: 'lesson', ref_id: 'x', facts: { lesson }, body: '', clips: [], created_at: Date.UTC(2026, 10, 16), expires_at: Date.UTC(2026, 11, 16), teacher_comment: '카페 주문을 끝까지 영어로 했습니다. 다음 수업에는 가게 이름을 직접 정해 오기', next_lesson_at: '11월 19일 수요일 17:30' };
  const html = renderToStaticMarkup(React.createElement(ReportBody, { report: r }));
  const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;font-family:sans-serif}</style></head><body><div id="root">${html}</div><pre id="m"></pre><script>
  const w=document.documentElement.clientWidth; const bad=[]; document.querySelectorAll('#root *').forEach(e=>{const b=e.getBoundingClientRect(); if(b.right>w+1||b.left<-1) bad.push(e.tagName+':'+Math.round(b.right)+':'+(e.textContent||'').slice(0,30))});
  document.getElementById('m').textContent='VW='+w+' scrollW='+document.documentElement.scrollWidth+' bad='+JSON.stringify(bad.slice(0,8));</script></body></html>`;
  fs.writeFileSync('../report-390.html', page);
});
