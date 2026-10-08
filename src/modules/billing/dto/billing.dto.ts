import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceStatus, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';
import { Trim } from '../../../common/validation/transformers';

export class CreateInvoiceItemDto {
  /** Descrição do item */
  @ApiProperty({ example: 'Mentoria individual' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'Descrição deve ter ao menos 2 caracteres' })
  @MaxLength(200)
  description: string;

  /** Quantidade */
  @ApiProperty({ example: 2, minimum: 1, maximum: 9999 })
  @IsInt({ message: 'quantity deve ser um inteiro' })
  @Min(1, { message: 'quantity deve ser maior ou igual a 1' })
  @Max(9999)
  quantity: number;

  /** Preço unitário (até 2 casas decimais) */
  @ApiProperty({ example: 150.5, minimum: 0 })
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'unitPrice deve ter no máximo 2 casas decimais' },
  )
  @Min(0, { message: 'unitPrice não pode ser negativo' })
  @Max(999999.99)
  unitPrice: number;
}

export class CreateInvoiceDto {
  /** Nome do cliente */
  @ApiProperty({ example: 'João Costa' })
  @Trim()
  @IsString()
  @MinLength(2, { message: 'customerName deve ter ao menos 2 caracteres' })
  @MaxLength(120)
  customerName: string;

  /** Itens da fatura (ao menos um) */
  @ApiProperty({ type: [CreateInvoiceItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'A fatura deve ter ao menos um item' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  /** Desconto total (até 2 casas decimais; não pode exceder o subtotal) */
  @ApiPropertyOptional({ example: 10, default: 0 })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'discount deve ter no máximo 2 casas decimais' },
  )
  @Min(0, { message: 'discount não pode ser negativo' })
  @Max(9999999999.99)
  discount?: number;

  /** Vencimento (ISO 8601) */
  @ApiPropertyOptional({ example: '2026-11-10T00:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'dueDate deve ser uma data ISO 8601 válida' })
  dueDate?: string;
}

export class ListInvoicesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus, { message: 'status deve ser PENDING, PAID ou CANCELLED' })
  status?: InvoiceStatus;

  /** Busca pelo nome do cliente */
  @ApiPropertyOptional({ example: 'joão' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Faturas criadas a partir desta data */
  @ApiPropertyOptional({ example: '2026-10-01T00:00:00Z' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'from deve ser uma data ISO 8601 válida' })
  from?: string;

  /** Faturas criadas até esta data */
  @ApiPropertyOptional({ example: '2026-10-31T23:59:59Z' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'to deve ser uma data ISO 8601 válida' })
  to?: string;
}

export class PayInvoiceDto {
  /** Forma de pagamento (pagamento simulado) */
  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.SIMULATED })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'method inválido' })
  method?: PaymentMethod;
}

export class PaymentWebhookDto {
  /** ID único do evento no provedor (chave de idempotência) */
  @ApiProperty({ example: 'evt_1Nxyz' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  eventId: string;

  /** Fatura paga */
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'invoiceId deve ser um UUID' })
  invoiceId: string;

  /** Valor pago (deve ser igual ao total da fatura) */
  @ApiProperty({ example: 291 })
  @IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: 'amount deve ter no máximo 2 casas decimais' },
  )
  @Min(0.01, { message: 'amount deve ser maior que zero' })
  @Max(9999999999.99)
  amount: number;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.SIMULATED })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'method inválido' })
  method?: PaymentMethod;
}
