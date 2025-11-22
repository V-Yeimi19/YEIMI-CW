import { EventBridgeEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, SendTaskSuccessCommand } from '@aws-sdk/client-sfn';
import { broadcastToRestaurant } from '../websocket/broadcast';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sfnClient = new SFNClient({});

const DELIVERY_TABLE = process.env.DELIVERY_TABLE!;

export const handler = async (event: EventBridgeEvent<string, any>) => {
  console.log('Event received:', JSON.stringify(event));
  
  const eventType = event['detail-type'];
  const detail = event.detail;
  
  try {
    switch (eventType) {
      case 'PagoConfirmado':
        await handlePagoConfirmado(detail);
        break;
        
      case 'ComidaPreparada':
        await handleComidaPreparada(detail);
        break;
        
      case 'Despachado':
        await handleDespachado(detail);
        break;
        
      case 'Entregado':
        await handleEntregado(detail);
        break;
        
      default:
        console.log('Evento no manejado:', eventType);
    }
    
    // Broadcast a WebSocket connections
    await broadcastToRestaurant(detail.restaurantId, {
      type: eventType,
      data: detail
    });
    
  } catch (error) {
    console.error('Error procesando evento:', error);
    throw error;
  }
};

async function handlePagoConfirmado(detail: any) {
  // Este evento inicia el Step Function
  // El Step Function ya está configurado con EventBridge Rule
  console.log('PagoConfirmado procesado, Step Function iniciado');
}

async function handleComidaPreparada(detail: any) {
  // Notificar al Step Function que está esperando este evento
  const { orderId, taskToken } = detail;
  
  await sfnClient.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({
      timestamp: new Date().toISOString(),
      orderId
    })
  }));
}

async function handleDespachado(detail: any) {
  const { orderId, taskToken } = detail;
  
  await sfnClient.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({
      timestamp: new Date().toISOString(),
      orderId
    })
  }));
}

async function handleEntregado(detail: any) {
  const { orderId, taskToken, confirmationCode } = detail;
  
  await dynamoClient.send(new UpdateCommand({
    TableName: DELIVERY_TABLE,
    Key: { orderId },
    UpdateExpression: 'SET #status = :status, confirmationCode = :code, deliveredAt = :deliveredAt, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':status': 'ENTREGADO',
      ':code': confirmationCode,
      ':deliveredAt': new Date().toISOString(),
      ':updatedAt': new Date().toISOString()
    }
  }));
  
  await sfnClient.send(new SendTaskSuccessCommand({
    taskToken,
    output: JSON.stringify({
      timestamp: new Date().toISOString(),
      confirmationCode,
      orderId,
      totalTime: calculateTotalTime(detail)
    })
  }));
}

function calculateTotalTime(detail: any): number {
  // Calcular tiempo total de entrega
  return 45; // minutos (ejemplo)
}