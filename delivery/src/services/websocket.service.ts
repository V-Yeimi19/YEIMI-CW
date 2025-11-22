import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
  GetConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';
import { WebSocketConnection } from '../models/types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const WS_ENDPOINT = process.env.WS_ENDPOINT!;

let apiGwClient: ApiGatewayManagementApiClient;

function getApiGwClient(): ApiGatewayManagementApiClient {
  if (!apiGwClient) {
    apiGwClient = new ApiGatewayManagementApiClient({
      endpoint: WS_ENDPOINT
    });
  }
  return apiGwClient;
}

export class WebSocketService {
  /**
   * Registrar una nueva conexión WebSocket
   */
  static async registerConnection(
    connectionId: string,
    restaurantId: string
  ): Promise<WebSocketConnection> {
    const connection: WebSocketConnection = {
      connectionId,
      restaurantId,
      connectedAt: new Date().toISOString()
    };

    await dynamoClient.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: connection
    }));

    logger.info('WebSocket connection registered', {
      connectionId,
      restaurantId
    });

    return connection;
  }

  /**
   * Eliminar una conexión WebSocket
   */
  static async removeConnection(connectionId: string): Promise<void> {
    await dynamoClient.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));

    logger.info('WebSocket connection removed', { connectionId });
  }

  /**
   * Obtener todas las conexiones de un restaurante
   */
  static async getConnectionsByRestaurant(
    restaurantId: string
  ): Promise<WebSocketConnection[]> {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'RestaurantIdIndex',
      KeyConditionExpression: 'restaurantId = :restaurantId',
      ExpressionAttributeValues: {
        ':restaurantId': restaurantId
      }
    }));

    return (result.Items || []) as WebSocketConnection[];
  }

  /**
   * Enviar mensaje a una conexión específica
   */
  static async sendToConnection(
    connectionId: string,
    message: any
  ): Promise<boolean> {
    try {
      await getApiGwClient().send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message))
      }));

      return true;
    } catch (error: any) {
      if (error.statusCode === 410 || error.$metadata?.httpStatusCode === 410) {
        // Conexión obsoleta, eliminar de la base de datos
        await this.removeConnection(connectionId);
        logger.warn('Stale connection removed', { connectionId });
      } else {
        logger.error('Error sending to connection', { connectionId, error });
      }
      return false;
    }
  }

  /**
   * Broadcast mensaje a todas las conexiones de un restaurante
   */
  static async broadcastToRestaurant(
    restaurantId: string,
    message: any
  ): Promise<{ sent: number; failed: number }> {
    const connections = await this.getConnectionsByRestaurant(restaurantId);

    let sent = 0;
    let failed = 0;

    const sendPromises = connections.map(async (connection) => {
      const success = await this.sendToConnection(connection.connectionId, message);
      if (success) {
        sent++;
      } else {
        failed++;
      }
    });

    await Promise.all(sendPromises);

    logger.info('Broadcast completed', {
      restaurantId,
      totalConnections: connections.length,
      sent,
      failed
    });

    return { sent, failed };
  }

  /**
   * Verificar si una conexión está activa
   */
  static async isConnectionActive(connectionId: string): Promise<boolean> {
    try {
      await getApiGwClient().send(new GetConnectionCommand({
        ConnectionId: connectionId
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Cerrar una conexión forzadamente
   */
  static async forceDisconnect(connectionId: string): Promise<void> {
    try {
      await getApiGwClient().send(new DeleteConnectionCommand({
        ConnectionId: connectionId
      }));
      await this.removeConnection(connectionId);

      logger.info('Connection forcefully closed', { connectionId });
    } catch (error) {
      logger.error('Error forcing disconnect', { connectionId, error });
      throw error;
    }
  }

  /**
   * Enviar notificación de actualización de estado del pedido
   */
  static async notifyOrderStatusUpdate(
    restaurantId: string,
    orderId: string,
    status: string,
    additionalData?: Record<string, any>
  ): Promise<void> {
    const message = {
      type: 'ORDER_STATUS_UPDATE',
      data: {
        orderId,
        status,
        timestamp: new Date().toISOString(),
        ...additionalData
      }
    };

    await this.broadcastToRestaurant(restaurantId, message);
  }
}
