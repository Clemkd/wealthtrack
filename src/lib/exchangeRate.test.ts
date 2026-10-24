import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Rates = typeof import('./exchangeRate');

let rates: Rates;
const fetchMock = vi.fn();

const answer = (usd: number) => ({ ok: true, json: async () => ({ rates: { USD: usd } }) });

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
  rates = await import('./exchangeRate');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getEurToUsdRate', () => {
  it('uses the latest rate when no date is given and caches it', async () => {
    fetchMock.mockResolvedValue(answer(1.1));
    expect(await rates.getEurToUsdRate()).toBe(1.1);
    expect(await rates.getEurToUsdRate()).toBe(1.1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/latest');
  });

  it('uses the rate of the transaction day for a past date, cached per day', async () => {
    fetchMock.mockResolvedValue(answer(1.06));
    expect(await rates.getEurToUsdRate(new Date('2023-03-01T10:00:00Z'))).toBe(1.06);
    await rates.getEurToUsdRate(new Date('2023-03-01T23:00:00Z'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/2023-03-01');

    await rates.getEurToUsdRate(new Date('2023-03-02T10:00:00Z'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the latest rate for today, a future date or an invalid date', async () => {
    fetchMock.mockResolvedValue(answer(1.1));
    await rates.getEurToUsdRate(new Date('2026-10-24T08:00:00Z'));
    await rates.getEurToUsdRate(new Date('2027-01-01T00:00:00Z'));
    await rates.getEurToUsdRate(new Date('garbage'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/latest');
  });

  it('gives up after a timeout instead of waiting forever', async () => {
    fetchMock.mockResolvedValue(answer(1.1));
    await rates.getEurToUsdRate();
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('returns null when the request fails or the answer is not ok', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await rates.getEurToUsdRate(new Date('2023-03-01T10:00:00Z'))).toBeNull();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await rates.getEurToUsdRate(new Date('2023-03-02T10:00:00Z'))).toBeNull();
  });

  it('does not cache a failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(answer(1.06));
    expect(await rates.getEurToUsdRate(new Date('2023-03-01T10:00:00Z'))).toBeNull();
    expect(await rates.getEurToUsdRate(new Date('2023-03-01T10:00:00Z'))).toBe(1.06);
  });
});

describe('latest rate cache', () => {
  it('is refreshed after one hour', async () => {
    fetchMock.mockResolvedValueOnce(answer(1.1)).mockResolvedValueOnce(answer(1.2));
    expect(await rates.getEurToUsdRate()).toBe(1.1);
    vi.setSystemTime(new Date('2026-10-24T12:59:00Z'));
    expect(await rates.getEurToUsdRate()).toBe(1.1);
    vi.setSystemTime(new Date('2026-10-24T13:01:00Z'));
    expect(await rates.getEurToUsdRate()).toBe(1.2);
  });

  it('falls back to the last known rate when the refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(answer(1.1)).mockRejectedValueOnce(new Error('network'));
    await rates.getEurToUsdRate();
    vi.setSystemTime(new Date('2026-10-24T14:00:00Z'));
    expect(await rates.getEurToUsdRate()).toBe(1.1);
  });
});

describe('getUsdToEurRate', () => {
  it('inverts the rate', async () => {
    fetchMock.mockResolvedValue(answer(2));
    expect(await rates.getUsdToEurRate()).toBe(0.5);
  });

  it('returns null when the rate is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    expect(await rates.getUsdToEurRate()).toBeNull();
  });
});
