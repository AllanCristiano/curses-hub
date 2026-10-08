import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination';

export class ListNotificationsQueryDto extends PaginationQueryDto {
  /** Se true, retorna apenas notificações não lidas */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean({ message: 'unreadOnly deve ser booleano' })
  unreadOnly?: boolean;
}
