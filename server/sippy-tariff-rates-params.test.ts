import { describe, it, expect } from 'vitest';
import { tariffRatesParams } from './sippy-tariff-rates-params';

describe('tariffRatesParams', () => {
  it('sends only the tariff when nothing else is given', () => {
    expect(tariffRatesParams({ iTariff: 68 })).toEqual({ i_tariff: 68 });
  });

  it('never sends an object as offset — the 2026-09-14 company-card 500', () => {
    // `{}` arrived in the offset position from a mis-ordered call.
    expect(tariffRatesParams({ iTariff: 68, offset: {} as any })).toEqual({ i_tariff: 68 });
  });

  it('never sends a string, NaN or a negative as offset', () => {
    expect(tariffRatesParams({ iTariff: 1, offset: 'https://portal' })).toEqual({ i_tariff: 1 });
    expect(tariffRatesParams({ iTariff: 1, offset: NaN })).toEqual({ i_tariff: 1 });
    expect(tariffRatesParams({ iTariff: 1, offset: -5 })).toEqual({ i_tariff: 1 });
  });

  it('passes real paging through, with limit clamped to 1..1000 as before', () => {
    expect(tariffRatesParams({ iTariff: 2, offset: 0, limit: 1000 })).toEqual({ i_tariff: 2, offset: 0, limit: 1000 });
    expect(tariffRatesParams({ iTariff: 2, offset: 40, limit: 5000 })).toEqual({ i_tariff: 2, offset: 40, limit: 1000 });
    expect(tariffRatesParams({ iTariff: 2, limit: 0 })).toEqual({ i_tariff: 2, limit: 1 });
  });

  it('only an integer customer id becomes i_customer', () => {
    expect(tariffRatesParams({ iTariff: 3, iCustomer: 7 })).toEqual({ i_tariff: 3, i_customer: 7 });
    expect(tariffRatesParams({ iTariff: 3, iCustomer: '7' })).toEqual({ i_tariff: 3 });
    expect(tariffRatesParams({ iTariff: 3, iCustomer: undefined })).toEqual({ i_tariff: 3 });
  });
});
