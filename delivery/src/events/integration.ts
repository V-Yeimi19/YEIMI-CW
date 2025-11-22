/**
 * Definicion de eventos para integracion con otros microservicios
 *
 * Este archivo documenta los eventos que el microservicio de Delivery:
 * - Escucha (eventos entrantes)
 * - Emite (eventos salientes)
 */

// ============================================
// EVENTOS ENTRANTES (que este microservicio escucha)
// ============================================

/**
 * Evento emitido por el microservicio de Orders cuando se confirma el pago
 * Este evento inicia el flujo de delivery
 */
export interface PagoConfirmadoEvent {
  source: 'orders.service';
  'detail-type': 'PagoConfirmado';
  detail: {
    orderId: string;
    restaurantId: string;
    customerId: string;
    items: Array<{
      productId: string;
      name: string;
      quantity: number;
      price: number;
    }>;
    deliveryAddress: {
      street: string;
      city: string;
      postalCode: string;
      coordinates?: {
        lat: number;
        lng: number;
      };
    };
    totalAmount: number;
    paymentId: string;
    timestamp: string;
  };
}

/**
 * Evento emitido por el cocinero cuando termina de preparar la comida
 */
export interface ComidaPreparadaEvent {
  source: 'kitchen.service';
  'detail-type': 'ComidaPreparada';
  detail: {
    orderId: string;
    cocineroId: string;
    taskToken: string;  // Token de Step Functions para continuar el flujo
    timestamp: string;
  };
}

/**
 * Evento emitido por el despachador cuando el pedido esta listo para envio
 */
export interface DespachadoEvent {
  source: 'dispatch.service';
  'detail-type': 'Despachado';
  detail: {
    orderId: string;
    despachadorId: string;
    taskToken: string;
    timestamp: string;
  };
}

/**
 * Evento emitido por el repartidor cuando confirma la entrega
 */
export interface EntregadoEvent {
  source: 'delivery.service';
  'detail-type': 'Entregado';
  detail: {
    orderId: string;
    repartidorId: string;
    taskToken: string;
    confirmationCode: string;
    timestamp: string;
  };
}

// ============================================
// EVENTOS SALIENTES (que este microservicio emite)
// ============================================

/**
 * Evento emitido cuando se asigna un cocinero al pedido
 */
export interface PedidoEnPreparacionEvent {
  source: 'delivery.service';
  'detail-type': 'PedidoEnPreparacion';
  detail: {
    orderId: string;
    status: 'EN_PREPARACION';
    cocineroId: string;
    cocineroNombre: string;
    timestamp: string;
  };
}

/**
 * Evento emitido cuando se asigna un despachador al pedido
 */
export interface PedidoEnDespachoEvent {
  source: 'delivery.service';
  'detail-type': 'PedidoEnDespacho';
  detail: {
    orderId: string;
    status: 'EN_DESPACHO';
    despachadorId: string;
    despachadorNombre: string;
    cocineroId: string;
    timestamp: string;
  };
}

/**
 * Evento emitido cuando se asigna un repartidor al pedido
 */
export interface PedidoEnCaminoEvent {
  source: 'delivery.service';
  'detail-type': 'PedidoEnCamino';
  detail: {
    orderId: string;
    status: 'EN_CAMINO';
    repartidorId: string;
    repartidorNombre: string;
    vehiculo: string;
    estimatedDeliveryTime: number;
    timestamp: string;
  };
}

/**
 * Evento emitido cuando se confirma la entrega del pedido
 */
export interface PedidoEntregadoEvent {
  source: 'delivery.service';
  'detail-type': 'PedidoEntregado';
  detail: {
    orderId: string;
    status: 'ENTREGADO';
    repartidorId: string;
    deliveryTimestamp: string;
    confirmationCode: string;
    totalDeliveryTime: number;
    timestamp: string;
  };
}

/**
 * Evento emitido cuando ocurre un error en el proceso de delivery
 */
export interface ErrorDeliveryEvent {
  source: 'delivery.service';
  'detail-type': 'ErrorDelivery';
  detail: {
    orderId: string;
    errorType:
      | 'ASIGNACION_COCINERO_FALLIDA'
      | 'ASIGNACION_DESPACHADOR_FALLIDA'
      | 'ASIGNACION_REPARTIDOR_FALLIDA'
      | 'TIMEOUT_ENTREGA'
      | 'ERROR_CONFIRMACION_ENTREGA';
    errorMessage: string;
    timestamp: string;
  };
}

// ============================================
// TIPOS AUXILIARES
// ============================================

export type IncomingEvent =
  | PagoConfirmadoEvent
  | ComidaPreparadaEvent
  | DespachadoEvent
  | EntregadoEvent;

export type OutgoingEvent =
  | PedidoEnPreparacionEvent
  | PedidoEnDespachoEvent
  | PedidoEnCaminoEvent
  | PedidoEntregadoEvent
  | ErrorDeliveryEvent;

// ============================================
// CONSTANTES DE INTEGRACION
// ============================================

export const EVENT_BUS_NAME = 'delivery-event-bus';

export const EVENT_SOURCES = {
  DELIVERY: 'delivery.service',
  ORDERS: 'orders.service',
  KITCHEN: 'kitchen.service',
  DISPATCH: 'dispatch.service'
} as const;

export const EVENT_TYPES = {
  // Entrantes
  PAGO_CONFIRMADO: 'PagoConfirmado',
  COMIDA_PREPARADA: 'ComidaPreparada',
  DESPACHADO: 'Despachado',
  ENTREGADO: 'Entregado',

  // Salientes
  PEDIDO_EN_PREPARACION: 'PedidoEnPreparacion',
  PEDIDO_EN_DESPACHO: 'PedidoEnDespacho',
  PEDIDO_EN_CAMINO: 'PedidoEnCamino',
  PEDIDO_ENTREGADO: 'PedidoEntregado',
  ERROR_DELIVERY: 'ErrorDelivery'
} as const;
