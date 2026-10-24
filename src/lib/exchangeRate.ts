const FRANKFURTER_BASE = 'https://api.frankfurter.app';
const LATEST_CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 5000;

let latestRate: { value: number; fetchedAt: number } | null = null;
// Historical rates never change once published, so they are cached for good
const historicalRates = new Map<string, number>();

async function fetchRate(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      console.warn('Exchange rate API returned status', response.status);
      return null;
    }
    const data = await response.json();
    return data.rates?.USD ?? null;
  } catch (error) {
    console.warn('Failed to fetch EUR/USD exchange rate:', error);
    return null;
  }
}

// EUR to USD rate. With a past date, the rate of that day is used (the value in
// euros on the day of the transaction is what counts for tax); otherwise the
// latest rate.
export async function getEurToUsdRate(date?: Date): Promise<number | null> {
  const day = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  const today = new Date().toISOString().slice(0, 10);

  if (day && day < today) {
    const cached = historicalRates.get(day);
    if (cached !== undefined) return cached;

    const rate = await fetchRate(`${FRANKFURTER_BASE}/${day}?from=EUR&to=USD`);
    if (rate != null) historicalRates.set(day, rate);
    return rate;
  }

  if (latestRate && Date.now() - latestRate.fetchedAt < LATEST_CACHE_DURATION_MS) {
    return latestRate.value;
  }
  const rate = await fetchRate(`${FRANKFURTER_BASE}/latest?from=EUR&to=USD`);
  if (rate != null) {
    latestRate = { value: rate, fetchedAt: Date.now() };
    return rate;
  }
  return latestRate?.value ?? null;
}
