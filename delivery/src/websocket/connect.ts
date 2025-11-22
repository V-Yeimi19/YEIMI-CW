import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const connectionId = event.requestContext.connectionId!;
  const restaurantId = event.queryStringParameters?.restaurantId;
  
  if (!restaurantId) {
    return {
      statusCode: 400,
      body: 'restaurantId is required'
    };
  }
  
  try {
    await dynamoClient.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        connectionId,
        restaurantId,
        connectedAt: new Date().toISOString()
      }
    }));
    
    return {
      statusCode: 200,
      body: 'Connected'
    };
  } catch (error) {
    console.error('Error connecting:', error);
    return {
      statusCode: 500,
      body: 'Failed to connect'
    };
  }
};