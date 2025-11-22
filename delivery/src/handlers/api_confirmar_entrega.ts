import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { OrderStatus } from '../models/types';
import { logger } from '../utils/logger';
import { success, badRequest, notFound, internalError, handleLambdaError } from '../utils/responses';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfnClient = new SFNClient({});
const DELIVERY_TABLE = process.env.DELIVERY_TABLE!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.lambdaStart('ApiConfirmarEntrega', event);

  const httpMethod = event.httpMethod;
  const orderId = event.pathParameters?.orderId;

  if (!orderId) {
    return badRequest('orderId es requerido');
  }

  try {
    if (httpMethod === 'GET') {
      return await getDeliveryStatus(orderId);
    } else if (httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      return await confirmarEntrega(orderId, body);
    } else {
      return badRequest('Metodo no soportado');
    }
  } catch (error: any) {
    logger.lambdaError('ApiConfirmarEntrega', error);
    return handleLambdaError(error);
  }
};

async function getDeliveryStatus(orderId: string): Promise<APIGatewayProxyResult> {
  const result = await dynamoClient.send(new GetCommand({
    TableName: DELIVERY_TABLE,
    Key: { orderId }
  }));

  if (!result.Item) {
    return notFound(`Pedido ${orderId} no encontrado`);
  }

  const delivery = result.Item;

  // Remover campos sensibles
  const { pendingTaskToken, ...safeDelivery } = delivery;

  return success({
    orderId: safeDelivery.orderId,
    status: safeDelivery.status,
    restaurantId: safeDelivery.restaurantId,
    cocinero: safeDelivery.cocinero,
    despachador: safeDelivery.despachador,
    repartidor: safeDelivery.repartidor,
    statusHistory: safeDelivery.statusHistory,
    createdAt: safeDelivery.createdAt,
    updatedAt: safeDelivery.updatedAt,
    deliveredAt: safeDelivery.deliveredAt,
    confirmationCode: safeDelivery.confirmationCode,
    awaitingConfirmation: safeDelivery.awaitingConfirmation || false
  });
}

interface ConfirmarEntregaBody {
  confirmationCode: string;
  customerSignature?: string;
  notes?: string;
}

async function confirmarEntrega(
  orderId: string,
  body: ConfirmarEntregaBody
): Promise<APIGatewayProxyResult> {
  const { confirmationCode, customerSignature, notes } = body;

  if (!confirmationCode) {
    return badRequest('confirmationCode es requerido');
  }

  // 1. Obtener el registro del pedido
  const result = await dynamoClient.send(new GetCommand({
    TableName: DELIVERY_TABLE,
    Key: { orderId }
  }));

  if (!result.Item) {
    return notFound(`Pedido ${orderId} no encontrado`);
  }

  const delivery = result.Item;

  if (!delivery.pendingTaskToken) {
    return badRequest(`Pedido ${orderId} no tiene confirmacion pendiente`);
  }

  if (!delivery.awaitingConfirmation) {
    return badRequest(`Pedido ${orderId} ya fue confirmado`);
  }

  const taskToken = delivery.pendingTaskToken;
  const startTime = new Date(delivery.createdAt).getTime();
  const totalTime = Math.round((Date.now() - startTime) / 60000); // minutos

  // 2. Actualizar el registro de delivery
  await dynamoClient.send(new UpdateCommand({
    TableName: DELIVERY_TABLE,
    Key: { orderId },
    UpdateExpression: `
      SET #status = :status,
          confirmationCode = :code,
          customerSignature = :signature,
          deliveryNotes = :notes,
          deliveredAt = :deliveredAt,
          awaitingConfirmation = :awaiting,
          pendingTaskToken = :emptyToken,
          statusHistory = list_append(statusHistory, :newHistory),
          updatedAt = :updatedAt
    `,
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': OrderStatus.ENTREGADO,
      ':code': confirmationCode,
      ':signature': customerSignature || null,
      ':notes': notes || null,
      ':deliveredAt': new Date().toISOString(),
      ':awaiting': false,
      ':emptyToken': null,
      ':newHistory': [{
        status: OrderStatus.ENTREGADO,
        timestamp: new Date().toISOString(),
        actor: delivery.repartidor?.repartidorId
      }],
      ':updatedAt': new Date().toISOString()
    }
  }));

  // 3. Notificar a Step Functions que la entrega fue confirmada
  await sfnClient.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({
      timestamp: new Date().toISOString(),
      confirmationCode,
      totalTime,
      orderId
    })
  }));

  logger.info('Delivery confirmed via API', { orderId, confirmationCode, totalTime });

  return success({
    message: 'Entrega confirmada exitosamente',
    orderId,
    confirmationCode,
    totalDeliveryTimeMinutes: totalTime,
    deliveredAt: new Date().toISOString()
  });
}
