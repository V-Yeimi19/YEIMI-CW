import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { OrderDetail, Cocinero, OrderStatus } from '../models/types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfnClient = new SFNClient({});

const DELIVERY_TABLE = process.env.DELIVERY_TABLE!;
const COCINEROS_TABLE = process.env.COCINEROS_TABLE!;

interface AsignarCocineroInput {
  orderId: string;
  restaurantId: string;
  items: any[];
  taskToken: string;
}

export const handler = async (event: AsignarCocineroInput) => {
  console.log('AsignarCocinero event:', JSON.stringify(event));
  
  try {
    const { orderId, restaurantId, items, taskToken } = event;
    
    // 1. Buscar cocinero disponible
    const cocinero = await findAvailableCocinero(restaurantId);
    
    if (!cocinero) {
      throw new Error('No hay cocineros disponibles');
    }
    
    // 2. Guardar asignación en DynamoDB
    await dynamoClient.send(new PutCommand({
      TableName: DELIVERY_TABLE,
      Item: {
        orderId,
        status: OrderStatus.EN_PREPARACION,
        restaurantId,
        cocinero: {
          cocineroId: cocinero.cocineroId,
          nombre: cocinero.nombre,
          assignedAt: new Date().toISOString()
        },
        statusHistory: [
          {
            status: OrderStatus.EN_PREPARACION,
            timestamp: new Date().toISOString(),
            actor: cocinero.cocineroId
          }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }));
    
    // 3. Enviar éxito a Step Functions con task token
    const result = {
      cocineroId: cocinero.cocineroId,
      nombre: cocinero.nombre,
      assignedAt: new Date().toISOString()
    };
    
    await sfnClient.send(new SendTaskSuccessCommand({
      taskToken,
      output: JSON.stringify(result)
    }));
    
    return result;
    
  } catch (error) {
    console.error('Error asignando cocinero:', error);
    
    // Enviar fallo a Step Functions
    await sfnClient.send(new SendTaskFailureCommand({
      taskToken: event.taskToken,
      error: 'CocineroAsignacionError',
      cause: error.message
    }));
    
    throw error;
  }
};

async function findAvailableCocinero(restaurantId: string): Promise<{ cocineroId: string; nombre: string } | null> {
  // Lógica para encontrar un cocinero disponible
  // Por ahora, simulación simple
  const cocineros = [
    { cocineroId: 'COC-001', nombre: 'Juan Pérez' },
    { cocineroId: 'COC-002', nombre: 'María García' },
    { cocineroId: 'COC-003', nombre: 'Pedro López' }
  ];
  
  // Seleccionar aleatoriamente (en producción: verificar disponibilidad)
  const randomIndex = Math.floor(Math.random() * cocineros.length);
  return cocineros[randomIndex];
}