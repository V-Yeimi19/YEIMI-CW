# Microservicio de Delivery

Microservicio serverless para la gestion de asignacion y actualizacion del estado de pedidos en un sistema de delivery de comida.

## Arquitectura

```
                                    +------------------+
                                    |   Orders Service |
                                    +--------+---------+
                                             |
                                             | PagoConfirmado
                                             v
+------------------+              +----------+----------+
|   Kitchen        |              |     EventBridge     |
|   Service        +------------->|   (delivery-bus)    |
+------------------+              +----------+----------+
       ^                                     |
       |                                     v
       |                          +----------+----------+
       |                          |   Step Functions    |
       |                          |   State Machine     |
       |                          +----------+----------+
       |                                     |
       +-------------------------------------+
                                             |
              +------------------------------+------------------------------+
              |                              |                              |
              v                              v                              v
    +---------+--------+          +----------+---------+          +---------+--------+
    | Lambda           |          | Lambda             |          | Lambda           |
    | AsignarCocinero  |          | AsignarDespachador |          | AsignarRepartidor|
    +------------------+          +--------------------+          +------------------+
              |                              |                              |
              +------------------------------+------------------------------+
                                             |
                                             v
                                    +--------+--------+
                                    |    DynamoDB     |
                                    |  (DeliveryTable)|
                                    +-----------------+
                                             |
                                             v
                                    +--------+--------+
                                    |   WebSocket API |
                                    |  (Notificaciones)|
                                    +-----------------+
```

## Flujo de Estados

```
RECIBIDO -> EN_PREPARACION -> EN_DESPACHO -> EN_CAMINO -> ENTREGADO
                |                  |              |
                v                  v              v
           [Cocinero]        [Despachador]   [Repartidor]
```

## Estructura del Proyecto

```
proyecto_final/
├── delivery.asl.json           # Definicion Step Function (JSONata)
├── package.json                # Dependencias
├── samconfig.toml              # Configuracion SAM CLI
├── tsconfig.json               # Configuracion TypeScript
├── infraestructure/
│   └── delivery_stack.yml      # Template CloudFormation/SAM
└── src/
    ├── index.ts                # Exportaciones principales
    ├── events/
    │   └── integration.ts      # Tipos de eventos para integracion
    ├── handlers/
    │   ├── Lambda_AsignarCocinero.ts
    │   ├── Lambda_AsignarDespachador.ts
    │   ├── Lambda_AsignarRepartidor.ts
    │   ├── Lambda_ConfirmarEntrega.ts
    │   ├── api_confirmar_entrega.ts
    │   └── event_handler.ts
    ├── models/
    │   ├── types.ts
    │   └── delivery.model.ts
    ├── services/
    │   ├── dynamodb.service.ts
    │   ├── eventbridge.service.ts
    │   └── websocket.service.ts
    ├── utils/
    │   ├── logger.ts
    │   └── responses.ts
    └── websocket/
        ├── connect.ts
        ├── disconnect.ts
        └── broadcast.ts
```

## Requisitos Previos

- Node.js >= 18.x
- AWS CLI configurado
- SAM CLI instalado
- Cuenta de AWS con permisos necesarios

## Instalacion

```bash
# Clonar e instalar dependencias
cd proyecto_final
npm install

# Compilar TypeScript
npm run build
```

## Despliegue

### Desarrollo

```bash
# Desde el directorio raiz
cd infraestructure
sam build
sam deploy --guided
```

### Staging

```bash
sam deploy --config-env staging
```

### Produccion

```bash
sam deploy --config-env prod
```

## Recursos AWS Creados

| Recurso | Tipo | Descripcion |
|---------|------|-------------|
| DeliveryTable | DynamoDB | Almacena estado de los deliveries |
| ConnectionsTable | DynamoDB | Conexiones WebSocket activas |
| CocinerosTable | DynamoDB | Catalogo de cocineros |
| DeliveryEventBus | EventBridge | Bus de eventos para integracion |
| DeliveryStateMachine | Step Functions | Orquestacion del flujo |
| WebSocketApi | API Gateway v2 | Notificaciones en tiempo real |
| DeliveryApi | API Gateway | API REST para operaciones |

## API REST

### Obtener estado de un delivery

```http
GET /delivery/{orderId}
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "orderId": "ORD-123",
    "status": "EN_CAMINO",
    "restaurantId": "REST-001",
    "cocinero": {
      "cocineroId": "COC-001",
      "nombre": "Juan Perez"
    },
    "despachador": {
      "despachadorId": "DES-001",
      "nombre": "Carlos Ruiz"
    },
    "repartidor": {
      "repartidorId": "REP-001",
      "nombre": "Luis Torres",
      "vehiculo": "Moto"
    },
    "statusHistory": [...],
    "awaitingConfirmation": true
  }
}
```

### Confirmar entrega

```http
POST /delivery/{orderId}/confirm
Content-Type: application/json

{
  "confirmationCode": "ABC123",
  "customerSignature": "base64...",
  "notes": "Entregado en puerta"
}
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "message": "Entrega confirmada exitosamente",
    "orderId": "ORD-123",
    "confirmationCode": "ABC123",
    "totalDeliveryTimeMinutes": 45,
    "deliveredAt": "2024-01-15T14:30:00.000Z"
  }
}
```

## WebSocket API

### Conectar

```
wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}?restaurantId=REST-001
```

### Eventos recibidos

```json
{
  "type": "ORDER_STATUS_UPDATE",
  "data": {
    "orderId": "ORD-123",
    "status": "EN_PREPARACION",
    "timestamp": "2024-01-15T14:00:00.000Z"
  }
}
```

## Integracion con Otros Microservicios

### Eventos que escucha (Entrantes)

| Evento | Source | Descripcion |
|--------|--------|-------------|
| PagoConfirmado | orders.service | Inicia el flujo de delivery |
| ComidaPreparada | kitchen.service | Cocinero termino de preparar |
| Despachado | dispatch.service | Pedido listo para envio |

### Eventos que emite (Salientes)

| Evento | Descripcion |
|--------|-------------|
| PedidoEnPreparacion | Cocinero asignado |
| PedidoEnDespacho | Despachador asignado |
| PedidoEnCamino | Repartidor en camino |
| PedidoEntregado | Entrega confirmada |
| ErrorDelivery | Error en el proceso |

### Ejemplo: Publicar evento desde otro microservicio

```typescript
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const client = new EventBridgeClient({});

await client.send(new PutEventsCommand({
  Entries: [{
    Source: 'orders.service',
    DetailType: 'PagoConfirmado',
    EventBusName: 'delivery-event-bus-dev',
    Detail: JSON.stringify({
      orderId: 'ORD-123',
      restaurantId: 'REST-001',
      customerId: 'CUST-001',
      items: [
        { productId: 'PROD-1', name: 'Pizza', quantity: 2, price: 15.00 }
      ],
      deliveryAddress: {
        street: 'Av. Principal 123',
        city: 'Lima',
        postalCode: '15001'
      },
      totalAmount: 30.00
    })
  }]
}));
```

## Variables de Entorno

| Variable | Descripcion |
|----------|-------------|
| DELIVERY_TABLE | Nombre de la tabla DynamoDB de deliveries |
| CONNECTIONS_TABLE | Nombre de la tabla de conexiones WebSocket |
| COCINEROS_TABLE | Nombre de la tabla de cocineros |
| EVENT_BUS_NAME | Nombre del EventBus |
| WS_ENDPOINT | Endpoint del WebSocket API |
| SERVICE_NAME | Nombre del servicio para logs |
| LOG_LEVEL | Nivel de logging (DEBUG, INFO, WARN, ERROR) |

## Scripts Disponibles

```bash
npm run build        # Compilar TypeScript
npm run watch        # Compilar en modo watch
npm run test         # Ejecutar tests
npm run lint         # Ejecutar linter
npm run lint:fix     # Corregir errores de lint
npm run clean        # Limpiar directorio dist
```

## Pruebas Locales

```bash
# Iniciar API local
sam local start-api

# Invocar funcion especifica
sam local invoke AsignarCocineroFunction -e events/test-event.json
```

## Monitoreo

Los logs se envian a CloudWatch Logs con formato JSON estructurado:

```json
{
  "level": "INFO",
  "message": "Delivery confirmed successfully",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "service": "delivery-service",
  "data": {
    "orderId": "ORD-123",
    "confirmationCode": "ABC123"
  }
}
```

## Outputs del Stack

Despues del despliegue, estos valores estaran disponibles:

- **DeliveryTableName**: Nombre de la tabla de deliveries
- **ConnectionsTableName**: Nombre de la tabla de conexiones
- **DeliveryEventBusArn**: ARN del EventBus para integracion
- **StateMachineArn**: ARN de la Step Function
- **WebSocketUrl**: URL del WebSocket API
- **DeliveryApiUrl**: URL de la API REST

## Licencia

ISC
