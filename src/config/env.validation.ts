import { plainToInstance } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/** Variáveis de ambiente validadas na inicialização (documento 13.2). */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  PAGINATION_MAX_LIMIT?: number;

  @IsOptional()
  @IsBooleanString()
  SWAGGER_ENABLED?: string;

  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(15)
  BCRYPT_ROUNDS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  AUTH_THROTTLE_TTL_SECONDS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  AUTH_THROTTLE_LIMIT?: number;

  @IsString()
  @IsNotEmpty()
  PAYMENT_WEBHOOK_SECRET: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const messages = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Variáveis de ambiente inválidas — ${messages}`);
  }
  return { ...config, ...validated };
}
