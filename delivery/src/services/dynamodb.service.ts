import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../utils/logger';

const client = new DynamoDBClient({});
const dynamoClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

export class DynamoDBService {
  private tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  /**
   * Crear un nuevo item
   */
  async put<T extends Record<string, any>>(item: T, conditionExpression?: string): Promise<T> {
    try {
      await dynamoClient.send(new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: conditionExpression
      }));

      logger.info('Item created successfully', { tableName: this.tableName });
      return item;
    } catch (error) {
      logger.error('Error creating item', { tableName: this.tableName, error });
      throw error;
    }
  }

  /**
   * Obtener un item por key
   */
  async get<T>(key: Record<string, any>): Promise<T | null> {
    try {
      const result = await dynamoClient.send(new GetCommand({
        TableName: this.tableName,
        Key: key
      }));

      return (result.Item as T) || null;
    } catch (error) {
      logger.error('Error getting item', { tableName: this.tableName, key, error });
      throw error;
    }
  }

  /**
   * Actualizar un item
   */
  async update<T>(
    key: Record<string, any>,
    updateExpression: string,
    expressionAttributeValues: Record<string, any>,
    expressionAttributeNames?: Record<string, string>
  ): Promise<T> {
    try {
      const result = await dynamoClient.send(new UpdateCommand({
        TableName: this.tableName,
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames,
        ReturnValues: 'ALL_NEW'
      }));

      logger.info('Item updated successfully', { tableName: this.tableName, key });
      return result.Attributes as T;
    } catch (error) {
      logger.error('Error updating item', { tableName: this.tableName, key, error });
      throw error;
    }
  }

  /**
   * Eliminar un item
   */
  async delete(key: Record<string, any>): Promise<void> {
    try {
      await dynamoClient.send(new DeleteCommand({
        TableName: this.tableName,
        Key: key
      }));

      logger.info('Item deleted successfully', { tableName: this.tableName, key });
    } catch (error) {
      logger.error('Error deleting item', { tableName: this.tableName, key, error });
      throw error;
    }
  }

  /**
   * Query por partition key
   */
  async query<T>(
    keyConditionExpression: string,
    expressionAttributeValues: Record<string, any>,
    indexName?: string,
    expressionAttributeNames?: Record<string, string>
  ): Promise<T[]> {
    try {
      const result = await dynamoClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames
      }));

      return (result.Items || []) as T[];
    } catch (error) {
      logger.error('Error querying items', { tableName: this.tableName, error });
      throw error;
    }
  }

  /**
   * Scan de la tabla (usar con cuidado)
   */
  async scan<T>(
    filterExpression?: string,
    expressionAttributeValues?: Record<string, any>,
    expressionAttributeNames?: Record<string, string>
  ): Promise<T[]> {
    try {
      const result = await dynamoClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames
      }));

      return (result.Items || []) as T[];
    } catch (error) {
      logger.error('Error scanning table', { tableName: this.tableName, error });
      throw error;
    }
  }
}

// Instancias pre-configuradas para las tablas del proyecto
export const deliveryTable = new DynamoDBService(process.env.DELIVERY_TABLE || 'DeliveryTable');
export const connectionsTable = new DynamoDBService(process.env.CONNECTIONS_TABLE || 'ConnectionsTable');
export const cocinerosTable = new DynamoDBService(process.env.COCINEROS_TABLE || 'CocinerosTable');
