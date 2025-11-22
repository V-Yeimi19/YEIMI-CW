// Exportaciones principales del microservicio de Delivery

// Modelos
export * from './models/types';
export { DeliveryModel } from './models/delivery.model';

// Servicios
export { DynamoDBService, deliveryTable, connectionsTable, cocinerosTable } from './services/dynamodb.service';
export { EventBridgeService } from './services/eventbridge.service';
export { WebSocketService } from './services/websocket.service';

// Utilidades
export { logger } from './utils/logger';
export * from './utils/responses';

// Handlers (para referencia)
export { handler as asignarCocineroHandler } from './handlers/Lambda_AsignarCocinero';
export { handler as asignarDespachadorHandler } from './handlers/Lambda_AsignarDespachador';
export { handler as asignarRepartidorHandler } from './handlers/Lambda_AsignarRepartidor';
export { handler as confirmarEntregaHandler } from './handlers/Lambda_ConfirmarEntrega';
export { handler as eventHandler } from './handlers/event_handler';
export { handler as apiConfirmarEntregaHandler } from './handlers/api_confirmar_entrega';

// WebSocket Handlers
export { handler as wsConnectHandler } from './websocket/connect';
export { handler as wsDisconnectHandler } from './websocket/disconnect';
export { broadcastToRestaurant } from './websocket/broadcast';
