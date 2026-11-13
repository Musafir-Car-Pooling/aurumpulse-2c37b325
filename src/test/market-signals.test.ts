import { describe, expect, it } from 'vitest';
import { directionForScore,isMarketClosed,MARKETS,marketIds,price,shouldAlert } from '@/lib/markets';
import { analyze, type Candle } from '@/lib/signal-engine';
describe('Market signal rules',() => {
  it('supports the six requested markets',() => {expect(marketIds).toEqual(['XAUUSD','USTECm','USTEC_x100m','EURUSD','GBPUSD','USDJPY']);expect(MARKETS.USDJPY.ticker).toBe('JPY=X');expect(MARKETS.USTECm.ticker).toBe('^NDX');expect(MARKETS.USTEC_x100m.ticker).toBe('^NDX');});
  it('scales USTEC_x100m quotes by 100 against USTECm',() => {expect(MARKETS.USTEC_x100m.scale).toBe(100);expect(MARKETS.USTECm.scale).toBe(1);});
  it('preserves BUY threshold +4',() => {expect(directionForScore(4)).toBe('BUY');expect(directionForScore(3)).toBe('WAIT');});
  it('preserves SELL threshold -4',() => {expect(directionForScore(-4)).toBe('SELL');expect(directionForScore(-3)).toBe('WAIT');});
  it('never alerts on WAIT',() => expect(shouldAlert('WAIT','ready',null,0,1000)).toBe(false));
  it('alerts on a new BUY',() => expect(shouldAlert('BUY','ready',null,0,1000)).toBe(true));
  it('alerts on a new SELL',() => expect(shouldAlert('SELL','ready','BUY',2000,1000)).toBe(true));
  it('suppresses a repeated active setup',() => expect(shouldAlert('BUY','ready','BUY',2000,1000)).toBe(false));
  it('permits a fresh setup after expiry',() => expect(shouldAlert('BUY','ready','BUY',1000,2000)).toBe(true));
  it('never alerts on stale market data',() => expect(shouldAlert('SELL','stale',null,0,1000)).toBe(false));
  it('never alerts on unavailable market data',() => expect(shouldAlert('BUY','unavailable',null,0,1000)).toBe(false));
  it('closes every market including Nasdaq during the weekend',() => {const now=new Date('2026-10-18T17:38:00Z');for (const m of marketIds) expect(isMarketClosed(m,now)).toBe(true);});
  it('retains forex quote precision',() => {expect(price('EURUSD',1.12345)).toBe('$1.12345');expect(price('USDJPY',150.123)).toBe('¥150.123');});
  it('preserves gold ATR targets and one-hour validity',() => {
    const now=new Date('2026-10-19T12:00:00Z');
    const bars: Candle[]=Array.from({length:240},(_,i)=>({c:2000+i,h:2002+i,l:1998+i,time:now.getTime()/1000-(240-i)*900}));
    const result=analyze('XAUUSD',bars,bars,2230,now);
    expect(result.entry).toBe(2230);expect(result.stopLoss).toBe(2224);expect(result.tp1).toBe(2236);expect(result.tp2).toBe(2242);expect(result.validUntil).toBe('2026-10-19T13:00:00.000Z');expect(result.support).toBe(2197);expect(result.resistance).toBe(2232);
  });
  it('rejects insufficient hourly history',() => expect(() => analyze('USTECm',[],[],100,new Date())).toThrow('Insufficient market history'));
});
