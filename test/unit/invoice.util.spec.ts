import { BusinessRuleException } from '../../src/common/errors/app.exceptions';
import { calculateInvoiceTotals } from '../../src/modules/billing/invoice.util';

describe('calculateInvoiceTotals (regras 6.2 e 8.5)', () => {
  it('total = soma dos itens − desconto', () => {
    const r = calculateInvoiceTotals(
      [
        { description: 'Mentoria', quantity: 2, unitPrice: 150 },
        { description: 'Material', quantity: 1, unitPrice: 49.9 },
      ],
      9.9,
    );
    expect(r.subtotal.toFixed(2)).toBe('349.90');
    expect(r.discount.toFixed(2)).toBe('9.90');
    expect(r.total.toFixed(2)).toBe('340.00');
    expect(r.lines[0].total.toFixed(2)).toBe('300.00');
  });

  it('usa precisão decimal (0.1 × 3 não vira 0.30000000000000004)', () => {
    const r = calculateInvoiceTotals([{ description: 'Item', quantity: 3, unitPrice: 0.1 }]);
    expect(r.total.toString()).toBe('0.3');
  });

  it('desconto padrão é zero', () => {
    const r = calculateInvoiceTotals([{ description: 'Item', quantity: 1, unitPrice: 10 }]);
    expect(r.discount.toFixed(2)).toBe('0.00');
    expect(r.total.toFixed(2)).toBe('10.00');
  });

  it('rejeita desconto maior que o subtotal', () => {
    expect(() =>
      calculateInvoiceTotals([{ description: 'Item', quantity: 1, unitPrice: 10 }], 10.01),
    ).toThrow(BusinessRuleException);
  });

  it('rejeita total acima do limite de DECIMAL(12,2)', () => {
    expect(() =>
      calculateInvoiceTotals(
        Array.from({ length: 3 }, () => ({
          description: 'x',
          quantity: 9999,
          unitPrice: 999999.99,
        })),
      ),
    ).toThrow(BusinessRuleException);
  });
});
