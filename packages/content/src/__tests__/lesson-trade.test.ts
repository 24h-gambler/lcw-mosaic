import { describe, expect, it } from 'vitest';
import { CAFE_MENU, FURNITURE_SHOP_GOODS, TRADE_SHOP_GOODS } from '../lang-en-ko.js';
import { TEACHER_STOCK, giftLineEn, itemWordEn, teacherStockItem, tradeOffers, tradeOpeningEn, tradeReplyEn } from '../lesson-trade.js';

/** R325 (Dan 11-19): the teacher carries many things, reusing the town's own item definitions, and trades in English. */
describe('the teacher\'s things and trade sentences (R325)', () => {
  it('the teacher carries every tool, drink and furniture the town already defines, once each', () => {
    expect(TEACHER_STOCK.length).toBe(TRADE_SHOP_GOODS.length + CAFE_MENU.length + FURNITURE_SHOP_GOODS.length);
    expect(new Set(TEACHER_STOCK.map((s) => s.key)).size).toBe(TEACHER_STOCK.length);
    for (const g of TRADE_SHOP_GOODS) expect(teacherStockItem(g.key)?.label).toBe(g.label);
    expect(teacherStockItem('nope')).toBeNull();
  });

  it('three sentences per trade, one per star, naming the things; polite forms from L3', () => {
    const get = tradeOffers({ getKey: 'lantern', level: 'L1' });
    expect(get.map((o) => o.stars)).toEqual([1, 2, 3]);
    expect(get[1]!.text).toBe('Can I have the lantern, please?');
    expect(tradeOffers({ getKey: 'lantern', level: 'L3' })[1]!.text).toBe('Could I have the lantern, please?');
    const swap = tradeOffers({ getKey: 'boots', giveKey: 'rope', level: 'L2' });
    expect(swap.map((o) => o.text)).toEqual(['My rope for the boots.', 'Can I trade my rope for the boots?', expect.stringMatching(/^Can I trade my rope for your .*boots, please\?$/)]);
    expect(tradeOffers({ giveKey: 'apple' })[1]!.text).toBe('Here is my apple.');
    expect(tradeOffers({})).toEqual([]);
  });

  it('any bag item has an English word; the teacher answers and opens with the things named', () => {
    expect(itemWordEn('furn_blue_lamp')).toBe('blue lamp');
    expect(itemWordEn('???')).toBe('thing');
    expect(tradeReplyEn({ getKey: 'boots', giveKey: 'rope' })).toBe('Deal! Here are the boots. Thank you for the rope!');
    expect(giftLineEn('map')).toBe('Here is a map for you!');
    expect(giftLineEn('boots')).toBe('Here are some boots for you!');
    expect(tradeOpeningEn({ giveKey: 'apple' })).toBe('Oh, an apple! Is it for me?');
    expect(tradeOpeningEn({ getKey: 'map' })).toBe('Hello! Do you want the map?');
    expect(tradeOpeningEn({ giveKey: 'rope' })).toBe('Oh, a rope! Is it for me?');
  });
});
