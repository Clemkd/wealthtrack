const FRANKFURTER_API = 'https://api.frankfurter.app/latest?from=EUR&to=USD';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

let cachedRate: { value: number; fetchedAt: number } | null = null;

export async function getEurToUsdRate(): Promise<number | null> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < CACHE_DURATION_MS) {
    return cachedRate.value;
  }

  try {
    const response = await fetch(FRANKFURTER_API);
    if (!response.ok) {
      console.warn('Exchange rate API returned status', response.status);
      return cachedRate?.value ?? null;
    }
    const data = await response.json();
    const rate = data.rates?.USD ?? null;
    if (rate != null) {
      cachedRate = { value: rate, fetchedAt: Date.now() };
    }
    return rate;
  } catch (error) {
    console.warn('Failed to fetch EUR/USD exchange rate:', error);
    return cachedRate?.value ?? null;
  }
}

export async function getUsdToEurRate(): Promise<number | null> {
  const eurToUsd = await getEurToUsdRate();
  if (eurToUsd === null || eurToUsd === 0) return null;
  return 1 / eurToUsd;
}
