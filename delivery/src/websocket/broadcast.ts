import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const WS_ENDPOINT = process.env.WS_ENDPOINT!;

const apiGwClient = new ApiGatewayManagementApiClient({
  endpoint: WS_ENDPOINT
});

export async function broadcastToRestaurant(restaurantId: string, message: any) {
  try {
    // Obtener todas las conexiones del restaurante
    const result = await dynamoClient.send(new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'RestaurantIdIndex',
      KeyConditionExpression: 'restaurantId = :restaurantId',
      ExpressionAttributeValues: {
        ':restaurantId': restaurantId
      }
    }));
    
    const connections = result.Items || [];
    
    // Enviar mensaje a todas las conexiones
    const sendPromises = connections.map(async (connection) => {
      try {
        await apiGwClient.send(new PostToConnectionCommand({
          ConnectionId: connection.connectionId,
          Data: JSON.stringify(message)
        }));
      } catch (error: any) {
        if (error.statusCode === 410) {
          // Conexión obsoleta, eliminar
          await dynamoClient.send(new DeleteCommand({
            TableName: CONNECTIONS_TABLE,
            Key: { connectionId: connection.connectionId }
          }));
        } else {
          console.error('Error sending message:', error);
        }
      }
    });
    
    await Promise.all(sendPromises);
    
  } catch (error) {
    console.error('Error broadcasting:', error);
    throw error;
  }
}