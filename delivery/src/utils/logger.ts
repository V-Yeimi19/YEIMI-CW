type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  service: string;
  data?: Record<string, any>;
}

const SERVICE_NAME = process.env.SERVICE_NAME || 'delivery-service';
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL as LogLevel];
}

function formatLogEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, data?: Record<string, any>): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: SERVICE_NAME,
    data
  };

  const formattedEntry = formatLogEntry(entry);

  switch (level) {
    case 'DEBUG':
    case 'INFO':
      console.log(formattedEntry);
      break;
    case 'WARN':
      console.warn(formattedEntry);
      break;
    case 'ERROR':
      console.error(formattedEntry);
      break;
  }
}

export const logger = {
  debug: (message: string, data?: Record<string, any>) => log('DEBUG', message, data),
  info: (message: string, data?: Record<string, any>) => log('INFO', message, data),
  warn: (message: string, data?: Record<string, any>) => log('WARN', message, data),
  error: (message: string, data?: Record<string, any>) => log('ERROR', message, data),

  /**
   * Log de inicio de función Lambda
   */
  lambdaStart: (functionName: string, event: any) => {
    log('INFO', `Lambda ${functionName} started`, {
      functionName,
      eventType: typeof event,
      hasBody: !!event?.body
    });
  },

  /**
   * Log de fin de función Lambda
   */
  lambdaEnd: (functionName: string, statusCode: number, duration?: number) => {
    log('INFO', `Lambda ${functionName} completed`, {
      functionName,
      statusCode,
      duration: duration ? `${duration}ms` : undefined
    });
  },

  /**
   * Log de error de función Lambda
   */
  lambdaError: (functionName: string, error: any) => {
    log('ERROR', `Lambda ${functionName} failed`, {
      functionName,
      errorName: error?.name,
      errorMessage: error?.message,
      stack: error?.stack
    });
  },

  /**
   * Log de evento de Step Function
   */
  stepFunctionEvent: (state: string, input: any, output?: any) => {
    log('INFO', `Step Function state: ${state}`, {
      state,
      inputKeys: Object.keys(input || {}),
      outputKeys: output ? Object.keys(output) : undefined
    });
  },

  /**
   * Log de evento de EventBridge
   */
  eventBridgeEvent: (eventType: string, detail: any) => {
    log('INFO', `EventBridge event: ${eventType}`, {
      eventType,
      orderId: detail?.orderId,
      status: detail?.status
    });
  }
};

export default logger;
