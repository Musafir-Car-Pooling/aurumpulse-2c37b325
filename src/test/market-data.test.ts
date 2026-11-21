import {afterEach,describe,expect,it,vi} from 'vitest';
import {scanMarket} from '@/lib/market-data';
const now=new Date('2026-10-19T12:00:00Z');
const chart=(interval: number,stale=false) => ({chart:{result:[{timestamp:Array.from({length:240},(_,i)=>now.getTime()/1000-(239-i)*interval-(stale ? 7200 : 0)),indicators:{quote:[{close:Array.from({length:240},(_,i)=>2000+i),high:Array.from({length:240},(_,i)=>2002+i),low:Array.from({length:240},(_,i)=>1998+i)}]}}]}});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('Market feed protections',()=>{
  it('scans BTCUSD with fresh Bitcoin candles on Saturday',async()=>{
    vi.useFakeTimers();vi.setSystemTime('2026-11-21T09:49:00Z');
    const offset=(Date.now()-now.getTime())/1000;
    const request=vi.fn(async(url: string)=>{
      const data=chart(url.includes('60m') ? 3600 : 900);
      const row=data.chart.result[0];
      if(row) row.timestamp=row.timestamp.map(t=>t+offset);
      return Response.json(data);
    });
    vi.stubGlobal('fetch',request);
    const scan=await scanMarket('BTCUSD');expect(scan.status).toBe('ready');expect(scan.result?.market).toBe('BTCUSD');expect(scan.result?.spot).toBe(2239);
    expect(request.mock.calls.length).toBe(2);expect(request.mock.calls.every(([url])=>url.includes('/BTC-USD?'))).toBe(true);
  });
  it('suppresses signals when candles are stale',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json(chart(900,true))));
    const scan=await scanMarket('USDCHF');expect(scan.status).toBe('stale');expect(scan.result).toBeNull();
  });
  it('uses the USDCHF feed without index scaling',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);
    const request=vi.fn(async(url: string)=>Response.json(chart(url.includes('60m') ? 3600 : 900)));
    vi.stubGlobal('fetch',request);
    const scan=await scanMarket('USDCHF');expect(scan.status).toBe('ready');expect(scan.result?.spot).toBe(2239);
    expect(request.mock.calls.every(([url])=>url.includes('CHF%3DX'))).toBe(true);
  });
  it('ignores stale gold spot quotes and uses validated futures instead',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);
    vi.stubGlobal('fetch',vi.fn(async(url: string)=>Response.json(url.includes('gold-api') ? {price:9999,updatedAt:'2026-10-19T11:00:00Z'} : chart(url.includes('60m') ? 3600 : 900))));
    const scan=await scanMarket('XAUUSD');expect(scan.status).toBe('ready');expect(scan.result?.spot).toBe(2239);
  });
  it('uses a fresh gold spot quote',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);
    vi.stubGlobal('fetch',vi.fn(async(url: string)=>Response.json(url.includes('gold-api') ? {price:2230,updatedAt:'2026-10-19T11:59:00Z'} : chart(url.includes('60m') ? 3600 : 900))));
    const scan=await scanMarket('XAUUSD');expect(scan.status).toBe('ready');expect(scan.result?.spot).toBe(2230);
  });
});