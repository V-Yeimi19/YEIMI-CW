export enum OrderStatus {
  RECIBIDO = 'RECIBIDO',
  EN_PREPARACION = 'EN_PREPARACION',
  EN_DESPACHO = 'EN_DESPACHO',
  EN_CAMINO = 'EN_CAMINO',
  ENTREGADO = 'ENTREGADO'
}

export interface OrderDetail {
  orderId: string;
  restaurantId: string;
  customerId: string;
  items: OrderItem[];
  deliveryAddress: Address;
  totalAmount: number;
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface Address {
  street: string;
  city: string;
  postalCode: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface Cocinero {
  cocineroId: string;
  nombre: string;
  assignedAt: string;
}

export interface Despachador {
  despachadorId: string;
  nombre: string;
  assignedAt: string;
}

export interface Repartidor {
  repartidorId: string;
  nombre: string;
  vehiculo: string;
  estimatedTime: number;
  assignedAt: string;
}

export interface DeliveryRecord {
  orderId: string;
  status: OrderStatus;
  orderDetail: OrderDetail;
  cocinero?: Cocinero;
  despachador?: Despachador;
  repartidor?: Repartidor;
  statusHistory: StatusHistoryItem[];
  createdAt: string;
  updatedAt: string;
}

export interface StatusHistoryItem {
  status: OrderStatus;
  timestamp: string;
  actor?: string;
}

export interface WebSocketConnection {
  connectionId: string;
  restaurantId: string;
  connectedAt: string;
}