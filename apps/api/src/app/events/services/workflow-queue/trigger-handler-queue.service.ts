import { Injectable } from '@nestjs/common';
import { Queue, QueueBaseOptions, Worker } from 'bullmq';
import { getRedisPrefix } from '@novu/shared';
const nr = require('newrelic');
import { ConnectionOptions } from 'tls';
import { PinoLogger, storage, Store } from '@novu/application-generic';

import { TriggerEvent, TriggerEventCommand } from '../../usecases/trigger-event';

@Injectable()
export class TriggerHandlerQueueService {
  private bullConfig: QueueBaseOptions = {
    connection: {
      db: Number(process.env.REDIS_DB_INDEX),
      port: Number(process.env.REDIS_PORT),
      host: process.env.REDIS_HOST,
      password: process.env.REDIS_PASSWORD,
      connectTimeout: 50000,
      keepAlive: 30000,
      family: 4,
      keyPrefix: getRedisPrefix(),
      tls: process.env.REDIS_TLS as ConnectionOptions,
    },
  };
  public readonly queue: Queue;
  public readonly worker: Worker;

  constructor(private triggerEventUsecase: TriggerEvent) {
    this.queue = new Queue<TriggerEventCommand>('trigger-handler', {
      ...this.bullConfig,
      defaultJobOptions: {
        removeOnComplete: true,
      },
    });

    this.worker = new Worker('trigger-handler', this.getWorkerProcessor(), this.getWorkerOpts());
  }

  private getWorkerOpts() {
    return {
      ...this.bullConfig,
      lockDuration: 90000,
      concurrency: 200,
    };
  }

  public getWorkerProcessor() {
    return async ({ data }: { data: TriggerEventCommand }) => {
      return await new Promise(async (resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const _this = this;

        nr.startBackgroundTransaction('trigger-handler-queue', 'Trigger Engine', function () {
          const transaction = nr.getTransaction();

          storage.run(new Store(PinoLogger.root), () => {
            _this.triggerEventUsecase
              .execute(data)
              .then(resolve)
              .catch(reject)
              .finally(() => {
                transaction.end();
              });
          });
        });
      });
    };
  }
}
