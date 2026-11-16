/**
 * Korean copy of guardian push notices (push.ts). It shows on a lock screen: no child name, no price, no ids —
 * the details are on /family behind the guardian login.
 */
export type PushKind =
  | 'seat_7d'
  | 'seat_1d'
  | 'seat_expired'
  | 'refund_done'
  | 'refund_declined'
  | 'lesson_report'
  | 'report_reminder'
  | 'test';

export const PUSH_COPY_KO: Record<PushKind, { title: string; body: string }> = {
  seat_7d: { title: '이용 기간이 7일 남았어요', body: '우리 가족 화면에서 연장하거나 남은 기간을 볼 수 있어요.' },
  seat_1d: { title: '이용 기간이 내일 끝나요', body: '연장하지 않으면 30일 동안 보기만 할 수 있어요. 우리 가족 화면에서 확인해 주세요.' },
  seat_expired: { title: '이용 기간이 끝났어요', body: '30일 동안은 기록을 보기만 할 수 있어요. 우리 가족 화면에서 연장할 수 있어요.' },
  refund_done: { title: '환불이 처리됐어요', body: '처리 내용은 우리 가족 화면에서 볼 수 있어요.' },
  refund_declined: { title: '환불 요청 결과가 나왔어요', body: '결과와 이유는 우리 가족 화면에서 볼 수 있어요.' },
  lesson_report: { title: '수업 리포트가 왔어요', body: '이번 수업에서 아이가 한 말과 선생님 한마디를 우리 가족 화면에서 볼 수 있어요.' },
  report_reminder: { title: '아직 보지 않은 수업 리포트가 있어요', body: '우리 가족 화면에서 지난 수업 리포트를 볼 수 있어요.' },
  test: { title: '알림이 잘 와요', body: '이 기기에서 수업 리포트·이용 기간·환불 안내를 받을 수 있어요.' }
};
