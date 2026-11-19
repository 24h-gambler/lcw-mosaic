/**
 * Screen words of the shop, the maker's book and trades (frame domain, Dan R326 ⑤⑪⑫). English is the screen line
 * (the language being learned, docs/08 8.4), the Korean is the optional help (world/lang.ts `say`). Item names and
 * recipes come from `@lcw/content` shop-catalog.ts; numbers come from the server, never from these strings.
 */
export interface Bi {
  en: string;
  ko: string;
}
const b = (en: string, ko: string): Bi => ({ en, ko });

export const SHOP_STRINGS = {
  tabShop: b('Shop', '상점'),
  tabMake: b('Make', '만들기'),
  hudShop: b('Shop', '상점'),
  coins: b('coins', '코인'),
  today: b('Earned today', '오늘 번 코인'),
  helpTitle: b('How coins work', '코인은 이렇게 써요'),
  helpEarn: b('Earn coins by speaking English: every sentence you pass in town, lessons, and the daily goals.', '영어로 말해서 코인을 벌어요: 마을에서 통과한 문장, 수업, 오늘의 목표.'),
  helpSpend: b('Spend them here on clothes, tools, home things, pets, food and water, and blocks to build with.', '여기서 옷·도구·집 꾸미기·펫·음식과 물·건축 블록을 사요.'),
  helpSay: b('Tip: ask the shopkeeper in English and pay less — 3 stars is half price!', '팁: 가게 주인에게 영어로 주문하면 더 싸요 — 별 3개면 반값!'),
  helpMake: b('Open Make to see what you can build with what you buy.', '만들기 탭에서 산 것으로 무엇을 지을 수 있는지 봐요.'),
  helpOk: b('Got it', '알겠어요'),
  helpOpen: b('How coins work', '코인 도움말'),
  buy: b('Buy', '사기'),
  sayIt: b('Ask in English', '영어로 주문'),
  sayItSub: b('up to half price', '최대 반값'),
  need: b('Need', '부족'),
  owned: b('You have', '가진 것'),
  bought: b('Bought! It is in your bag.', '샀어요! 가방에 넣었어요.'),
  boughtChest: b('Bought! It is in your home chest.', '샀어요! 집 상자에 넣었어요.'),
  short: b('Not enough coins yet. Speak more to earn!', '코인이 아직 모자라요. 더 말해서 모아요!'),
  failed: b('That did not work. Try again.', '잘 안 됐어요. 다시 해 봐요.'),
  offline: b('The shop is away right now.', '지금은 상점이 열리지 않아요.'),
  guest: b('Sign up to earn and spend coins.', '가입하면 코인을 모으고 쓸 수 있어요.'),
  hunger: b('food', '배고픔'),
  thirst: b('water', '목마름'),
  blocks: b('blocks', '블록'),
  trade: b('Trade', '거래'),
  tradeTitle: b('Trade with friends', '친구와 거래'),
  tradeHint: b('Put one of your things up for coins. Friends in this world can buy it. Ask in English: "Do you want my red hat?"', '내 물건을 코인 값에 내놓아요. 같은 월드 친구가 살 수 있어요. 영어로 물어봐요: "Do you want my red hat?"'),
  tradeEmpty: b('No offers here yet.', '아직 올라온 거래가 없어요.'),
  tradeNoRoom: b('Trades open when you play with friends or in a lesson.', '친구와 함께 놀거나 수업 중일 때 거래가 열려요.'),
  myThings: b('My things', '내 물건'),
  offer: b('Offer', '내놓기'),
  price: b('Price', '값'),
  cancel: b('Take back', '돌려받기'),
  buyFrom: b('Buy from', '사기:'),
  sold: b('Sold!', '팔렸어요!'),
  paidOut: b('A friend bought your thing:', '친구가 내 물건을 샀어요:'),
  sellShop: b('Sell to the shop', '상점에 팔기'),
  makeTitle: b("Today's build challenge", '오늘의 만들기 도전'),
  makeUses: b('You will use', '쓰는 것'),
  makeProgress: b('Blocks placed today', '오늘 놓은 블록'),
  goBuild: b('Go build', '지으러 가기'),
  claim: b('Get coins', '코인 받기'),
  claimed: b('Done', '받았어요'),
  quests: b("Today's goals", '오늘의 목표'),
  book: b("Maker's book", '만들기 도감'),
  bookHint: b('Pictures of what you can make. Buy the blocks, then build it on your plot.', '만들 수 있는 것의 그림이에요. 블록을 사서 내 땅에 지어요.'),
  ideas: b("See friends' builds for ideas", '친구 작품 보고 아이디어 얻기'),
  shopFor: b('Get these', '사러 가기'),
  sayLine: b('Say it in English:', '영어로 말해요:'),
  sayMic: b('Speak', '말하기'),
  sayDone: b('Done', '다 했어요'),
  sayType: b('Type it in English', '영어로 써요'),
  sayAgain: b('Almost! Say it again:', '거의 다 됐어요! 다시 말해 봐요:'),
  cancelStep: b('Back', '뒤로')
} as const;
