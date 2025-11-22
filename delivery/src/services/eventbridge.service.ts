import {
  EventBridgeClient,
  PutEventsCommand,
  PutEventsRequestEntry
} from '@aws-sdk/client-eventbridge';
import { logger } from '../utils/logger';

const eventBridgeClient = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'delivery-event-bus';

export interface DeliveryEvent {
  orderId: string;
  status: string;
  [key: string]: any;
}

export class EventBridgeService {
  /**
   * Publicar un evento de delivery
   */
  static async publishDeliveryEvent(
    detailType: string,
    detail: DeliveryEvent
  ): Promise<void> {
    try {
      const entry: PutEventsRequestEntry = {
        Source: 'delivery.service',
        DetailType: detailType,
        Detail: JSON.stringify(detail),
        EventBusName: EVENT_BUS_NAME
      };

      await eventBridgeClient.send(new PutEventsCommand({
        Entries: [entry]
      }));

      logger.info('Event published successfully', {
        detailType,
        orderId: detail.orderId
      });
    } catch (error) {
      logger.error('Error publishing event', { detailType, error });
      throw error;
    }
  }

  /**
   * Publicar evento de pedido en preparación
   */
  static async publishPedidoEnPreparacion(
    orderId: string,
    cocineroId: string,
    cocineroNombre: string
  ): Promise<void> {
    await this.publishDeliveryEvent('PedidoEnPreparacion', {
      orderId,
      status: 'EN_PREPARACION',
      cocineroId,
      cocineroNombre,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Publicar evento de pedido en despacho
   */
  static async publishPedidoEnDespacho(
    orderId: string,
    despachadorId: string,
    despachadorNombre: string
  ): Promise<void> {
    await this.publishDeliveryEvent('PedidoEnDespacho', {
      orderId,
      status: 'EN_DESPACHO',
      despachadorId,
      despachadorNombre,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Publicar evento de pedido en camino
   */
  static async publishPedidoEnCamino(
    orderId: string,
    repartidorId: string,
    repartidorNombre: string,
    vehiculo: string,
    estimatedTime: number
  ): Promise<void> {
    await this.publishDeliveryEvent('PedidoEnCamino', {
      orderId,
      status: 'EN_CAMINO',
      repartidorId,
      repartidorNombre,
      vehiculo,
      estimatedDeliveryTime: estimatedTime,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Publicar evento de pedido entregado
   */
  static async publishPedidoEntregado(
    orderId: string,
    repartidorId: string,
    confirmationCode: string,
    totalDeliveryTime: number
  ): Promise<void> {
    await this.publishDeliveryEvent('PedidoEntregado', {
      orderId,
      status: 'ENTREGADO',
      repartidorId,
      confirmationCode,
      totalDeliveryTime,
      deliveryTimestamp: new Date().toISOString(),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Publicar evento de error en delivery
   */
  static async publishDeliveryError(
    orderId: string,
    errorType: string,
    errorMessage: string
  ): Promise<void> {
    await this.publishDeliveryEvent('ErrorDelivery', {
      orderId,
      status: 'ERROR',
      errorType,
      errorMessage,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Publicar múltiples eventos en batch
   */
  static async publishBatch(
    events: Array<{ detailType: string; detail: DeliveryEvent }>
  ): Promise<void> {
    try {
      const entries: PutEventsRequestEntry[] = events.map(event => ({
        Source: 'delivery.service',
        DetailType: event.detailType,
        Detail: JSON.stringify(event.detail),
        EventBusName: EVENT_BUS_NAME
      }));

      await eventBridgeClient.send(new PutEventsCommand({
        Entries: entries
      }));

      logger.info('Batch events published successfully', {
        count: events.length
      });
    } catch (error) {
      logger.error('Error publishing batch events', { error });
      throw error;
    }
  }
}
