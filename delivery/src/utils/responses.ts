import { APIGatewayProxyResult } from 'aws-lambda';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
};

/**
 * Respuesta exitosa genérica
 */
export function success<T>(data: T, statusCode = 200): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: true,
      data
    })
  };
}

/**
 * Respuesta de creación exitosa (201)
 */
export function created<T>(data: T): APIGatewayProxyResult {
  return success(data, 201);
}

/**
 * Respuesta sin contenido (204)
 */
export function noContent(): APIGatewayProxyResult {
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: ''
  };
}

/**
 * Respuesta de error genérica
 */
export function error(
  message: string,
  statusCode = 500,
  errorCode?: string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: false,
      error: {
        message,
        code: errorCode
      }
    })
  };
}

/**
 * Bad Request (400)
 */
export function badRequest(message = 'Bad Request', errorCode?: string): APIGatewayProxyResult {
  return error(message, 400, errorCode || 'BAD_REQUEST');
}

/**
 * Unauthorized (401)
 */
export function unauthorized(message = 'Unauthorized'): APIGatewayProxyResult {
  return error(message, 401, 'UNAUTHORIZED');
}

/**
 * Forbidden (403)
 */
export function forbidden(message = 'Forbidden'): APIGatewayProxyResult {
  return error(message, 403, 'FORBIDDEN');
}

/**
 * Not Found (404)
 */
export function notFound(message = 'Resource not found'): APIGatewayProxyResult {
  return error(message, 404, 'NOT_FOUND');
}

/**
 * Conflict (409)
 */
export function conflict(message = 'Resource conflict'): APIGatewayProxyResult {
  return error(message, 409, 'CONFLICT');
}

/**
 * Internal Server Error (500)
 */
export function internalError(message = 'Internal server error'): APIGatewayProxyResult {
  return error(message, 500, 'INTERNAL_ERROR');
}

/**
 * Service Unavailable (503)
 */
export function serviceUnavailable(message = 'Service temporarily unavailable'): APIGatewayProxyResult {
  return error(message, 503, 'SERVICE_UNAVAILABLE');
}

/**
 * Respuesta de validación fallida
 */
export function validationError(
  errors: Array<{ field: string; message: string }>
): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors
      }
    })
  };
}

/**
 * Respuesta de WebSocket exitosa
 */
export function wsSuccess(): APIGatewayProxyResult {
  return {
    statusCode: 200,
    body: 'OK'
  };
}

/**
 * Respuesta de WebSocket con error
 */
export function wsError(message: string): APIGatewayProxyResult {
  return {
    statusCode: 500,
    body: message
  };
}

/**
 * Handler de errores para Lambda
 */
export function handleLambdaError(err: any): APIGatewayProxyResult {
  console.error('Lambda error:', err);

  if (err.name === 'ValidationError') {
    return badRequest(err.message, 'VALIDATION_ERROR');
  }

  if (err.name === 'ConditionalCheckFailedException') {
    return conflict('Resource already exists or condition failed');
  }

  if (err.name === 'ResourceNotFoundException') {
    return notFound(err.message);
  }

  return internalError(
    process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
  );
}
