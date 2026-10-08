import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AccessTokenPayload, AuthUser } from '../../../common/auth/auth.types';
import { AuthenticationRequiredException } from '../../../common/errors/app.exceptions';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /** Carrega o usuário a cada requisição (UserStatus pode mudar após a emissão do token). */
  async validate(payload: AccessTokenPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AuthenticationRequiredException('Token ausente ou inválido');
    }
    return { id: user.id, email: user.email, name: user.name, tokenOrganizationId: payload.orgId };
  }
}
