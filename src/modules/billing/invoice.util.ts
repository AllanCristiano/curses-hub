import { Prisma } from '@prisma/client';
import { BusinessRuleException } from '../../common/errors/app.exceptions';

const Decimal = Prisma.Decimal;
/** Limite de DECIMAL(12,2) */
const MAX_AMOUNT = new Decimal('9999999999.99');

export interface InvoiceItemInput {
  description: string;
  quantity: number;
  unitPrice: number | string;
}

export interface InvoiceTotals {
  lines: {
    description: string;
    quantity: number;
    unitPrice: Prisma.Decimal;
    total: Prisma.Decimal;
  }[];
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Regras 6.2/8.5: valores monetários com precisão decimal (nunca float) e
 * total = soma dos itens − desconto.
 */
export function calculateInvoiceTotals(
  items: InvoiceItemInput[],
  discount: number | string = 0,
): InvoiceTotals {
  const lines = items.map((i) => {
    const unitPrice = new Decimal(i.unitPrice);
    return {
      description: i.description,
      quantity: i.quantity,
      unitPrice,
      total: unitPrice.mul(i.quantity),
    };
  });
  const subtotal = lines.reduce((acc, l) => acc.plus(l.total), new Decimal(0));
  const discountValue = new Decimal(discount);

  if (discountValue.gt(subtotal)) {
    throw new BusinessRuleException('O desconto não pode ser maior que o subtotal');
  }
  if (subtotal.gt(MAX_AMOUNT)) {
    throw new BusinessRuleException('Valor total da fatura excede o limite permitido');
  }
  return { lines, subtotal, discount: discountValue, total: subtotal.minus(discountValue) };
}
