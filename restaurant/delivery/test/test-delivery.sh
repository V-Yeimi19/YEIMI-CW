#!/bin/bash

# ============================================================================
# Scripts de Prueba Automatizados - Microservicio de Delivery
# ============================================================================

set -e  # Exit on error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Variables globales
ORDER_ID="ORDER-TEST-$(date +%s)"
SUCURSAL="sucursal-001"
CUSTOMER="USER#customer-test"
EMAIL="${TEST_EMAIL:-test@ejemplo.com}"
CORRELATION_ID="corr-test-$(date +%s)"

# ============================================================================
# Funciones de Utilidad
# ============================================================================

print_header() {
    echo -e "\n${BLUE}=========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}=========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

wait_for_execution() {
    local seconds=$1
    echo -n "Esperando ${seconds} segundos para que se procese el evento"
    for i in $(seq 1 $seconds); do
        echo -n "."
        sleep 1
    done
    echo " ✓"
}

# ============================================================================
# Funciones de Verificación
# ============================================================================

check_prerequisites() {
    print_header "Verificando Pre-requisitos"
    
    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI no está instalado"
        exit 1
    fi
    print_success "AWS CLI instalado"
    
    # Check credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "Credenciales de AWS no configuradas"
        exit 1
    fi
    print_success "Credenciales de AWS válidas"
    
    # Check jq
    if ! command -v jq &> /dev/null; then
        print_warning "jq no está instalado (opcional pero recomendado)"
    else
        print_success "jq instalado"
    fi
    
    # Check infrastructure
    if ! aws cloudformation describe-stacks --stack-name cw-infra-shared-dev &> /dev/null; then
        print_error "Stack de infraestructura base no desplegado"
        print_info "Ejecuta: npm run deploy:infra"
        exit 1
    fi
    print_success "Infraestructura base desplegada"
    
    # Check delivery microservice
    if ! aws cloudformation describe-stacks --stack-name delivery-ms-dev &> /dev/null; then
        print_error "Microservicio de delivery no desplegado"
        print_info "Ejecuta: npm run deploy:restaurant:delivery"
        exit 1
    fi
    print_success "Microservicio de delivery desplegado"
}

verify_workers_exist() {
    print_header "Verificando Workers en DynamoDB"
    
    # Verificar cocineros
    local cocineros=$(aws dynamodb query \
        --table-name Usuarios-dev \
        --index-name TenantRoleIndex \
        --key-condition-expression "tenant_context = :tc AND #role = :role" \
        --expression-attribute-names '{"#role": "Role"}' \
        --expression-attribute-values "{\":tc\": {\"S\": \"TENANT#$SUCURSAL\"}, \":role\": {\"S\": \"COCINERO\"}}" \
        --query 'Count' \
        --output text)
    
    if [ "$cocineros" -eq 0 ]; then
        print_warning "No hay cocineros disponibles"
        return 1
    fi
    print_success "Cocineros disponibles: $cocineros"
    
    # Verificar despachadores
    local despachadores=$(aws dynamodb query \
        --table-name Usuarios-dev \
        --index-name TenantRoleIndex \
        --key-condition-expression "tenant_context = :tc AND #role = :role" \
        --expression-attribute-names '{"#role": "Role"}' \
        --expression-attribute-values "{\":tc\": {\"S\": \"TENANT#$SUCURSAL\"}, \":role\": {\"S\": \"DESPACHADOR\"}}" \
        --query 'Count' \
        --output text)
    
    if [ "$despachadores" -eq 0 ]; then
        print_warning "No hay despachadores disponibles"
        return 1
    fi
    print_success "Despachadores disponibles: $despachadores"
    
    # Verificar repartidores
    local repartidores=$(aws dynamodb query \
        --table-name Usuarios-dev \
        --index-name TenantRoleIndex \
        --key-condition-expression "tenant_context = :tc AND #role = :role" \
        --expression-attribute-names '{"#role": "Role"}' \
        --expression-attribute-values "{\":tc\": {\"S\": \"TENANT#$SUCURSAL\"}, \":role\": {\"S\": \"REPARTIDOR\"}}" \
        --query 'Count' \
        --output text)
    
    if [ "$repartidores" -eq 0 ]; then
        print_warning "No hay repartidores disponibles"
        return 1
    fi
    print_success "Repartidores disponibles: $repartidores"
    
    return 0
}

create_test_workers() {
    print_header "Creando Workers de Prueba"
    
    cat > /tmp/create-workers.json << EOF
{
  "Usuarios-dev": [
    {
      "PutRequest": {
        "Item": {
          "user_id": {"S": "USER#worker-test-001"},
          "entity_type": {"S": "PROFILE"},
          "tenant_context": {"S": "TENANT#$SUCURSAL"},
          "Role": {"S": "COCINERO"},
          "atributos": {"S": "{\"nombre\": \"Juan Pérez (Test)\", \"activo\": true, \"turno\": \"mañana\"}"}
        }
      }
    },
    {
      "PutRequest": {
        "Item": {
          "user_id": {"S": "USER#worker-test-002"},
          "entity_type": {"S": "PROFILE"},
          "tenant_context": {"S": "TENANT#$SUCURSAL"},
          "Role": {"S": "DESPACHADOR"},
          "atributos": {"S": "{\"nombre\": \"María García (Test)\", \"activo\": true, \"turno\": \"mañana\"}"}
        }
      }
    },
    {
      "PutRequest": {
        "Item": {
          "user_id": {"S": "USER#worker-test-003"},
          "entity_type": {"S": "PROFILE"},
          "tenant_context": {"S": "TENANT#$SUCURSAL"},
          "Role": {"S": "REPARTIDOR"},
          "atributos": {"S": "{\"nombre\": \"Carlos Rodríguez (Test)\", \"activo\": true, \"vehiculo\": \"moto\"}"}
        }
      }
    }
  ]
}
EOF
    
    if aws dynamodb batch-write-item --request-items file:///tmp/create-workers.json; then
        print_success "Workers de prueba creados"
    else
        print_error "Error creando workers de prueba"
        return 1
    fi
}

# ============================================================================
# Funciones de Prueba de Flujos
# ============================================================================

test_pago_confirmado() {
    print_header "Prueba 1/4: PagoConfirmado → EnPreparación"
    
    print_info "Publicando evento PagoConfirmado..."
    aws events put-events --entries "[{
        \"Source\": \"payment.service\",
        \"DetailType\": \"PagoConfirmado\",
        \"Detail\": \"{\\\"orderId\\\": \\\"$ORDER_ID\\\", \\\"sucursalId\\\": \\\"$SUCURSAL\\\", \\\"customerId\\\": \\\"$CUSTOMER\\\", \\\"customerEmail\\\": \\\"$EMAIL\\\", \\\"correlationId\\\": \\\"$CORRELATION_ID\\\"}\"
    }]" > /dev/null
    
    if [ $? -eq 0 ]; then
        print_success "Evento publicado"
    else
        print_error "Error publicando evento"
        return 1
    fi
    
    wait_for_execution 8
    
    # Verificar registro en DynamoDB
    print_info "Verificando registro en DynamoDB..."
    local result=$(aws dynamodb query \
        --table-name Pedidos \
        --key-condition-expression "pedido_id = :pid AND entity = :entity" \
        --expression-attribute-values "{\":pid\": {\"S\": \"Pedido#$ORDER_ID\"}, \":entity\": {\"S\": \"EnPreparacion\"}}" \
        --query 'Count' \
        --output text)
    
    if [ "$result" -gt 0 ]; then
        print_success "Registro EnPreparación creado en DynamoDB"
    else
        print_error "No se encontró registro EnPreparación"
        return 1
    fi
    
    # Verificar ejecución de Step Function
    print_info "Verificando ejecución de Step Function..."
    local sm_arn=$(aws stepfunctions list-state-machines --query 'stateMachines[?contains(name, `DeliveryStateMachine`)].stateMachineArn' --output text)
    local exec_status=$(aws stepfunctions list-executions \
        --state-machine-arn "$sm_arn" \
        --max-results 1 \
        --query 'executions[0].status' \
        --output text)
    
    if [ "$exec_status" == "SUCCEEDED" ]; then
        print_success "Step Function ejecutada exitosamente"
    else
        print_warning "Step Function en estado: $exec_status"
    fi
    
    print_success "✓ Flujo PagoConfirmado completado"
}

test_comida_preparada() {
    print_header "Prueba 2/4: ComidaPreparada → EnDespacho"
    
    print_info "Publicando evento ComidaPreparada..."
    aws events put-events --entries "[{
        \"Source\": \"kitchen.service\",
        \"DetailType\": \"ComidaPreparada\",
        \"Detail\": \"{\\\"orderId\\\": \\\"$ORDER_ID\\\", \\\"sucursalId\\\": \\\"$SUCURSAL\\\", \\\"customerId\\\": \\\"$CUSTOMER\\\", \\\"customerEmail\\\": \\\"$EMAIL\\\", \\\"correlationId\\\": \\\"$CORRELATION_ID\\\", \\\"cocineroId\\\": \\\"USER#worker-001\\\"}\"
    }]" > /dev/null
    
    if [ $? -eq 0 ]; then
        print_success "Evento publicado"
    else
        print_error "Error publicando evento"
        return 1
    fi
    
    wait_for_execution 8
    
    # Verificar registro
    local result=$(aws dynamodb query \
        --table-name Pedidos \
        --key-condition-expression "pedido_id = :pid AND entity = :entity" \
        --expression-attribute-values "{\":pid\": {\"S\": \"Pedido#$ORDER_ID\"}, \":entity\": {\"S\": \"EnDespacho\"}}" \
        --query 'Count' \
        --output text)
    
    if [ "$result" -gt 0 ]; then
        print_success "Registro EnDespacho creado"
    else
        print_error "No se encontró registro EnDespacho"
        return 1
    fi
    
    print_success "✓ Flujo ComidaPreparada completado"
}

test_despachado() {
    print_header "Prueba 3/4: Despachado → EnCamino"
    
    print_info "Publicando evento Despachado..."
    aws events put-events --entries "[{
        \"Source\": \"packing.service\",
        \"DetailType\": \"Despachado\",
        \"Detail\": \"{\\\"orderId\\\": \\\"$ORDER_ID\\\", \\\"sucursalId\\\": \\\"$SUCURSAL\\\", \\\"customerId\\\": \\\"$CUSTOMER\\\", \\\"customerEmail\\\": \\\"$EMAIL\\\", \\\"correlationId\\\": \\\"$CORRELATION_ID\\\", \\\"despachadorId\\\": \\\"USER#worker-002\\\"}\"
    }]" > /dev/null
    
    if [ $? -eq 0 ]; then
        print_success "Evento publicado"
    else
        print_error "Error publicando evento"
        return 1
    fi
    
    wait_for_execution 8
    
    # Verificar registro
    local result=$(aws dynamodb query \
        --table-name Pedidos \
        --key-condition-expression "pedido_id = :pid AND entity = :entity" \
        --expression-attribute-values "{\":pid\": {\"S\": \"Pedido#$ORDER_ID\"}, \":entity\": {\"S\": \"EnCamino\"}}" \
        --query 'Count' \
        --output text)
    
    if [ "$result" -gt 0 ]; then
        print_success "Registro EnCamino creado"
    else
        print_error "No se encontró registro EnCamino"
        return 1
    fi
    
    print_success "✓ Flujo Despachado completado"
}

test_entregado() {
    print_header "Prueba 4/4: Entregado → Completado"
    
    print_info "Publicando evento Entregado..."
    aws events put-events --entries "[{
        \"Source\": \"driver.service\",
        \"DetailType\": \"Entregado\",
        \"Detail\": \"{\\\"orderId\\\": \\\"$ORDER_ID\\\", \\\"sucursalId\\\": \\\"$SUCURSAL\\\", \\\"customerId\\\": \\\"$CUSTOMER\\\", \\\"customerEmail\\\": \\\"$EMAIL\\\", \\\"correlationId\\\": \\\"$CORRELATION_ID\\\", \\\"confirmationCode\\\": \\\"CODE-ABC123\\\", \\\"deliveryTimestamp\\\": \\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\"}\"
    }]" > /dev/null
    
    if [ $? -eq 0 ]; then
        print_success "Evento publicado"
    else
        print_error "Error publicando evento"
        return 1
    fi
    
    wait_for_execution 8
    
    # Verificar registro
    local result=$(aws dynamodb query \
        --table-name Pedidos \
        --key-condition-expression "pedido_id = :pid AND entity = :entity" \
        --expression-attribute-values "{\":pid\": {\"S\": \"Pedido#$ORDER_ID\"}, \":entity\": {\"S\": \"Entregado\"}}" \
        --query 'Count' \
        --output text)
    
    if [ "$result" -gt 0 ]; then
        print_success "Registro Entregado creado"
    else
        print_error "No se encontró registro Entregado"
        return 1
    fi
    
    print_success "✓ Flujo Entregado completado"
}

# ============================================================================
# Función de Resumen
# ============================================================================

show_final_report() {
    print_header "Resumen de Pruebas"
    
    echo -e "${BLUE}Order ID:${NC} $ORDER_ID"
    echo -e "${BLUE}Email de prueba:${NC} $EMAIL"
    echo -e "${BLUE}Correlation ID:${NC} $CORRELATION_ID"
    echo ""
    
    print_info "Estados del pedido en DynamoDB:"
    aws dynamodb query \
        --table-name Pedidos \
        --key-condition-expression "pedido_id = :pid" \
        --expression-attribute-values "{\":pid\": {\"S\": \"Pedido#$ORDER_ID\"}}" \
        --output table \
        --query 'Items[*].[entity.S, Estado.S, DesEstado.S]'
    
    echo ""
    print_info "Últimas ejecuciones de Step Function:"
    local sm_arn=$(aws stepfunctions list-state-machines --query 'stateMachines[?contains(name, `DeliveryStateMachine`)].stateMachineArn' --output text)
    aws stepfunctions list-executions \
        --state-machine-arn "$sm_arn" \
        --max-results 5 \
        --output table \
        --query 'executions[*].[name, status, startDate]'
    
    echo ""
    print_warning "IMPORTANTE:"
    echo "  - Revisa el inbox del email: $EMAIL"
    echo "  - Deberías haber recibido 4 emails (uno por cada estado)"
    echo "  - Verifica los logs de CloudWatch si algo falló"
    echo ""
    
    print_info "Para ver logs de Lambda sendEmail:"
    echo "  aws logs tail /aws/lambda/delivery-ms-dev-sendEmail --follow"
    echo ""
}

# ============================================================================
# Función de Limpieza
# ============================================================================

cleanup_test_data() {
    print_header "Limpieza de Datos de Prueba"
    
    read -p "¿Deseas eliminar los datos de prueba? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Eliminando registros de pedido..."
        
        for entity in "EnPreparacion" "EnDespacho" "EnCamino" "Entregado"; do
            aws dynamodb delete-item \
                --table-name Pedidos \
                --key "{\"pedido_id\": {\"S\": \"Pedido#$ORDER_ID\"}, \"entity\": {\"S\": \"$entity\"}}" \
                2>/dev/null && print_success "Eliminado: $entity" || print_warning "No encontrado: $entity"
        done
        
        print_success "Limpieza completada"
    else
        print_info "Datos de prueba conservados"
    fi
}

# ============================================================================
# Script Principal
# ============================================================================

main() {
    print_header "Suite de Pruebas - Microservicio de Delivery"
    
    echo -e "${BLUE}Configuración de prueba:${NC}"
    echo -e "  Order ID: $ORDER_ID"
    echo -e "  Email: $EMAIL"
    echo -e "  Sucursal: $SUCURSAL"
    echo ""
    
    # Verificar pre-requisitos
    check_prerequisites
    
    # Verificar/crear workers
    if ! verify_workers_exist; then
        print_warning "Creando workers de prueba..."
        create_test_workers
        sleep 2
    fi
    
    # Ejecutar pruebas
    local failed=0
    
    test_pago_confirmado || ((failed++))
    test_comida_preparada || ((failed++))
    test_despachado || ((failed++))
    test_entregado || ((failed++))
    
    # Mostrar resumen
    show_final_report
    
    # Resultado final
    echo ""
    if [ $failed -eq 0 ]; then
        print_success "═══════════════════════════════════════"
        print_success "   TODAS LAS PRUEBAS PASARON ✓"
        print_success "═══════════════════════════════════════"
    else
        print_error "═══════════════════════════════════════"
        print_error "   $failed PRUEBA(S) FALLARON ✗"
        print_error "═══════════════════════════════════════"
    fi
    
    # Opción de limpieza
    echo ""
    cleanup_test_data
    
    exit $failed
}

# Ejecutar script principal
main