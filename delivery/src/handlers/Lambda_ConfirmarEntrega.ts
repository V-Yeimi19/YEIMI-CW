import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { OrderStatus } from '../models/types';
import { logger } from '../utils/logger';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfnClient = new SFNClient({});

const DELIVERY_TABLE = process.env.DELIVERY_TABLE!;

interface ConfirmarEntregaInput {
  orderId: string;
  repartidorId: string;
  taskToken: string;
}

interface ConfirmarEntregaRequest {
  orderId: string;
  confirmationCode: string;
  customerSignature?: string;
  notes?: string;
}

// Almacen temporal de taskTokens (en produccion usar DynamoDB)
const pendingDeliveries = new Map<string, string>();

/**
 * Handler que registra el pedido como pendiente de confirmacion
 * El taskToken se guarda para ser usado cuando el repartidor confirme la entrega
 */
export const handler = async (event: ConfirmarEntregaInput) => {
  logger.lambdaStart('ConfirmarEntrega', event);

  const { orderId, repartidorId, taskToken } = event;

  try {
    // Guardar el taskToken en DynamoDB para poder confirmarlo despues
    await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET pendingTaskToken = :token, awaitingConfirmation = :awaiting, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':token': taskToken,
        ':awaiting': true,
        ':updatedAt': new Date().toISOString()
      }
    }));

    logger.info('Delivery pending confirmation', { orderId, repartidorId });

    // Este handler NO llama a SendTaskSuccess inmediatamente
    // El taskToken se usara cuando llegue la confirmacion del repartidor

    return {
      message: 'Esperando confirmacion de entrega',
      orderId,
      repartidorId
    };

  } catch (error: any) {
    logger.lambdaError('ConfirmarEntrega', error);
    throw error;
  }
};

/**
 * Funcion para confirmar la entrega (llamada desde API Gateway o evento)
 */
export async function confirmarEntregaManual(request: ConfirmarEntregaRequest): Promise<void> {
  const { orderId, confirmationCode, customerSignature, notes } = request;

  logger.info('Processing manual delivery confirmation', { orderId, confirmationCode });

  try {
    // 1. Obtener el registro del pedido con el taskToken
    const result = await dynamoClient.send(new GetCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId }
    }));

    if (!result.Item) {
      throw new Error(`Pedido ${orderId} no encontrado`);
    }

    const delivery = result.Item;

    if (!delivery.pendingTaskToken) {
      throw new Error(`Pedido ${orderId} no tiene confirmacion pendiente`);
    }

    if (!delivery.awaitingConfirmation) {
      throw new Error(`Pedido ${orderId} ya fue confirmado`);
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

    logger.info('Delivery confirmed successfully', { orderId, confirmationCode, totalTime });

  } catch (error: any) {
    logger.error('Error confirming delivery', { orderId, error: error.message });
    throw error;
  }
}

/**
 * Funcion para cancelar/fallar la entrega
 */
export async function cancelarEntrega(orderId: string, reason: string): Promise<void> {
  logger.info('Cancelling delivery', { orderId, reason });

  try {
    const result = await dynamoClient.send(new GetCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId }
    }));

    if (!result.Item || !result.Item.pendingTaskToken) {
      throw new Error(`Pedido ${orderId} no tiene confirmacion pendiente`);
    }

    const taskToken = result.Item.pendingTaskToken;

    // Actualizar estado
    await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET awaitingConfirmation = :awaiting, pendingTaskToken = :emptyToken, cancellationReason = :reason, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':awaiting': false,
        ':emptyToken': null,
        ':reason': reason,
        ':updatedAt': new Date().toISOString()
      }
    }));

    // Notificar fallo a Step Functions
    await sfnClient.send(new SendTaskFailureCommand({
      taskToken,
      error: 'DeliveryCancelled',
      cause: reason
    }));

    logger.info('Delivery cancelled', { orderId, reason });

  } catch (error: any) {
    logger.error('Error cancelling delivery', { orderId, error: error.message });
    throw error;
  }
}
