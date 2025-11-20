import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME ?? "DB Inventario";
const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const DEFAULT_LIMIT = 50;

function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  };
}

function encodeNextToken(token: any | undefined): string | undefined {
  if (!token) return undefined;
  return Buffer.from(JSON.stringify(token)).toString("base64");
}

function decodeNextToken(tok?: string): any | undefined {
  if (!tok) return undefined;
  try {
    return JSON.parse(Buffer.from(tok, "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const qs = event.queryStringParameters ?? {};

    const branchId = qs.branchId;
    const q = qs.q?.trim(); // search term
    const limit = Math.min(Math.max(Number(qs.limit ?? DEFAULT_LIMIT), 1), 500); // clamp 1..500
    const nextToken = decodeNextToken(qs.nextToken);

    // Base filter: quantityAvailable > 0
    let filterExpressions: string[] = ["quantityAvailable > :zero"];
    const expressionValues: Record<string, any> = { ":zero": 0 };
    const expressionNames: Record<string, string> = {};

    if (branchId) {
      filterExpressions.push("#branchId = :branchId");
      expressionValues[":branchId"] = branchId;
      expressionNames["#branchId"] = "branchId";
    }

    if (q && q.length > 0) {
      // simple contains on name or sku
      filterExpressions.push("(contains(#name, :q) OR contains(#sku, :q))");
      expressionValues[":q"] = q;
      expressionNames["#name"] = "name";
      expressionNames["#sku"] = "sku";
    }

    const params: any = {
      TableName: TABLE_NAME,
      FilterExpression: filterExpressions.join(" AND "),
      ExpressionAttributeValues: expressionValues,
      Limit: limit,
      ReturnConsumedCapacity: "NONE",
    };

    if (Object.keys(expressionNames).length > 0) {
      params.ExpressionAttributeNames = expressionNames;
    }

    if (nextToken) {
      params.ExclusiveStartKey = nextToken;
    }

    const cmd = new ScanCommand(params);
    const res = await ddb.send(cmd);

    const items = res.Items ?? [];
    const rawNext = res.LastEvaluatedKey;
    const encodedNext = encodeNextToken(rawNext);

    const body = {
      items,
      nextToken: encodedNext, // cliente debe reenviar este token para la siguiente página
      count: items.length,
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        ...buildCorsHeaders(),
      },
      body: JSON.stringify(body),
    };
  } catch (err: any) {
    console.error("ListarStock error:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        ...buildCorsHeaders(),
      },
      body: JSON.stringify({ message: "Error interno al listar stock", detail: err?.message ?? String(err) }),
    };
  }
};