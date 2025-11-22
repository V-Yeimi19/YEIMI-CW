import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { OrderStatus } from '../models/types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const DELIVERY_TABLE = process.env.DELIVERY_TABLE!;

interface AsignarRepartidorInput {
  orderId: string;
  restaurantId: string;
  deliveryAddress: any;
  despachadorId: string;
}

export const handler = async (event: AsignarRepartidorInput) => {
  console.log('AsignarRepartidor event:', JSON.stringify(event));
  
  try {
    const { orderId, restaurantId, deliveryAddress, despachadorId } = event;
    
    // 1. Buscar repartidor disponible
    const repartidor = await findAvailableRepartidor(restaurantId, deliveryAddress);
    
    if (!repartidor) {
      throw new Error('No hay repartidores disponibles');
    }
    
    // 2. Actualizar el pedido en DynamoDB
    await dynamoClient.send(new UpdateCommand({
      TableName: DELIVERY_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET #status = :status, repartidor = :repartidor, statusHistory = list_append(statusHistory, :newHistory), updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': OrderStatus.EN_CAMINO,
        ':repartidor': {
          repartidorId: repartidor.repartidorId,
          nombre: repartidor.nombre,
          vehiculo: repartidor.vehiculo,
          estimatedTime: repartidor.estimatedTime,
          assignedAt: new Date().toISOString()
        },
        ':newHistory': [{
          status: OrderStatus.EN_CAMINO,
          timestamp: new Date().toISOString(),
          actor: repartidor.repartidorId
        }],
        ':updatedAt': new Date().toISOString()
      }
    }));
    
    return {
      repartidorId: repartidor.repartidorId,
      nombre: repartidor.nombre,
      vehiculo: repartidor.vehiculo,
      estimatedTime: repartidor.estimatedTime,
      assignedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Error asignando repartidor:', error);
    throw error;
  }
};

async function findAvailableRepartidor(restaurantId: string, deliveryAddress: any) {
  const repartidores = [
    { 
      repartidorId: 'REP-001', 
      nombre: 'Luis Torres',
      vehiculo: 'Moto',
      estimatedTime: 30 // minutos
    },
    { 
      repartidorId: 'REP-002', 
      nombre: 'Sofia Mendez',
      vehiculo: 'Bicicleta',
      estimatedTime: 25
    }
  ];
  
  const randomIndex = Math.floor(Math.random() * repartidores.length);
  return repartidores[randomIndex];
}