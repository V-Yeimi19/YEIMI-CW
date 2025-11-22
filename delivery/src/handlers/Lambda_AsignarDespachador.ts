import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { OrderStatus } from '../models/types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DELIVERY_TABLE = process.env.DELIVERY_TABLE!;

interface AsignarDespachadorInput {
  orderId: string;
  restaurantId: string;
  cocineroId: string;
}

export const handler = async (event: AsignarDespachadorInput) => {
  console.log('AsignarDespachador event:', JSON.stringify(event));
  
  try {
    const { orderId, restaurantId, cocineroId } = event;
    
    // 1. Buscar despachador disponible
    const despachador = await findAvailableDespachador(restaurantId);
    
    if (!despachador) {
      throw new Error('No hay despachadores disponibles');
    }
    
    // 2. Actualizar el pedido en DynamoDB
    await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, despachador = :despachador, statusHistory = list_append(statusHistory, :newHistory), updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': OrderStatus.EN_DESPACHO,
        ':despachador': {
          despachadorId: despachador.despachadorId,
          nombre: despachador.nombre,
          assignedAt: new Date().toISOString()
        },
        ':newHistory': [{
          status: OrderStatus.EN_DESPACHO,
          timestamp: new Date().toISOString(),
          actor: despachador.despachadorId
        }],
        ':updatedAt': new Date().toISOString()
      }
    }));
    
    return {
      despachadorId: despachador.despachadorId,
      nombre: despachador.nombre,
      assignedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error asignando despachador:', error);
    throw error;
  }
};

async function findAvailableDespachador(restaurantId: string) {
  const despachadores = [
    { despachadorId: 'DES-001', nombre: 'Carlos Ruiz' },
    { despachadorId: 'DES-002', nombre: 'Ana Martínez' }
  ];
  
  const randomIndex = Math.floor(Math.random() * despachadores.length);
  return despachadores[randomIndex];
}