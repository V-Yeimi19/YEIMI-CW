import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand
} from '@aws-sdk/lib-dynamodb';
import {
  DeliveryRecord,
  OrderStatus,
  OrderDetail,
  Cocinero,
  Despachador,
  Repartidor,
  StatusHistoryItem
} from './types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DELIVERY_TABLE = process.env.DELIVERY_TABLE!;

export class DeliveryModel {
  /**
   * Crear un nuevo registro de delivery
   */
  static async create(orderDetail: OrderDetail): Promise<DeliveryRecord> {
    const now = new Date().toISOString();

    const deliveryRecord: DeliveryRecord = {
      orderId: orderDetail.orderId,
      status: OrderStatus.RECIBIDO,
      orderDetail,
      statusHistory: [
        {
          status: OrderStatus.RECIBIDO,
          timestamp: now
        }
      ],
      createdAt: now,
      updatedAt: now
    };

    await dynamoClient.send(new PutCommand({
      TableName: DELIVERY_TABLE,
      Item: deliveryRecord,
      ConditionExpression: 'attribute_not_exists(orderId)'
    }));

    return deliveryRecord;
  }

  /**
   * Obtener un delivery por orderId
   */
  static async getByOrderId(orderId: string): Promise<DeliveryRecord | null> {
    const result = await dynamoClient.send(new GetCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId }
    }));

    return result.Item as DeliveryRecord | null;
  }

  /**
   * Actualizar el estado del delivery
   */
  static async updateStatus(
    orderId: string,
    status: OrderStatus,
    actor?: string
  ): Promise<DeliveryRecord> {
    const now = new Date().toISOString();

    const newHistoryItem: StatusHistoryItem = {
      status,
      timestamp: now,
      actor
    };

    const result = await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, statusHistory = list_append(statusHistory, :newHistory), updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':newHistory': [newHistoryItem],
        ':updatedAt': now
      },
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes as DeliveryRecord;
  }

  /**
   * Asignar cocinero al delivery
   */
  static async assignCocinero(orderId: string, cocinero: Cocinero): Promise<DeliveryRecord> {
    const now = new Date().toISOString();

    const result = await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, cocinero = :cocinero, statusHistory = list_append(statusHistory, :newHistory), updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': OrderStatus.EN_PREPARACION,
        ':cocinero': cocinero,
        ':newHistory': [{
          status: OrderStatus.EN_PREPARACION,
          timestamp: now,
          actor: cocinero.cocineroId
        }],
        ':updatedAt': now
      },
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes as DeliveryRecord;
  }

  /**
   * Asignar despachador al delivery
   */
  static async assignDespachador(orderId: string, despachador: Despachador): Promise<DeliveryRecord> {
    const now = new Date().toISOString();

    const result = await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, despachador = :despachador, statusHistory = list_append(statusHistory, :newHistory), updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': OrderStatus.EN_DESPACHO,
        ':despachador': despachador,
        ':newHistory': [{
          status: OrderStatus.EN_DESPACHO,
          timestamp: now,
          actor: despachador.despachadorId
        }],
        ':updatedAt': now
      },
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes as DeliveryRecord;
  }

  /**
   * Asignar repartidor al delivery
   */
  static async assignRepartidor(orderId: string, repartidor: Repartidor): Promise<DeliveryRecord> {
    const now = new Date().toISOString();

    const result = await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, repartidor = :repartidor, statusHistory = list_append(statusHistory, :newHistory), updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': OrderStatus.EN_CAMINO,
        ':repartidor': repartidor,
        ':newHistory': [{
          status: OrderStatus.EN_CAMINO,
          timestamp: now,
          actor: repartidor.repartidorId
        }],
        ':updatedAt': now
      },
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes as DeliveryRecord;
  }

  /**
   * Marcar delivery como entregado
   */
  static async markAsDelivered(
    orderId: string,
    confirmationCode: string
  ): Promise<DeliveryRecord> {
    const now = new Date().toISOString();

    const result = await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, confirmationCode = :code, deliveredAt = :deliveredAt, statusHistory = list_append(statusHistory, :newHistory), updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': OrderStatus.ENTREGADO,
        ':code': confirmationCode,
        ':deliveredAt': now,
        ':newHistory': [{
          status: OrderStatus.ENTREGADO,
          timestamp: now
        }],
        ':updatedAt': now
      },
      ReturnValues: 'ALL_NEW'
    }));

    return result.Attributes as DeliveryRecord;
  }

  /**
   * Obtener deliveries por restaurante
   */
  static async getByRestaurantId(restaurantId: string): Promise<DeliveryRecord[]> {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: DELIVERY_TABLE,
      IndexName: 'RestaurantIdIndex',
      KeyConditionExpression: 'restaurantId = :restaurantId',
      ExpressionAttributeValues: {
        ':restaurantId': restaurantId
      }
    }));

    return (result.Items || []) as DeliveryRecord[];
  }

  /**
   * Obtener deliveries por estado
   */
  static async getByStatus(status: OrderStatus): Promise<DeliveryRecord[]> {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: DELIVERY_TABLE,
      IndexName: 'StatusIndex',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': status
      }
    }));

    return (result.Items || []) as DeliveryRecord[];
  }
}
