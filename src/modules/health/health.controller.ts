import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  MemoryHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator.js';
import { BypassTransform } from '../../common/decorators/bypass-transform.decorator.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { MinioService } from '../../infrastructure/minio/minio.service.js';

@ApiTags('Health')
@Controller('health')
@BypassTransform()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly minio: MinioService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'System health and core dependencies status' })
  async check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.checkRedis(),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }

  @Public()
  @Get('storage')
  @HealthCheck()
  @ApiOperation({ summary: 'Object storage (MinIO) health status' })
  async checkStorage() {
    return this.health.check([() => this.checkMinio()]);
  }

  private async checkRedis() {
    const isUp = await this.redis.ping();
    const session = this.indicator.check('redis');
    return isUp ? session.up() : session.down({ message: 'Redis unreachable' });
  }

  private async checkMinio() {
    const isUp = await this.minio.ping();
    const session = this.indicator.check('minio');
    return isUp ? session.up() : session.down({ message: 'MinIO unreachable' });
  }
}
