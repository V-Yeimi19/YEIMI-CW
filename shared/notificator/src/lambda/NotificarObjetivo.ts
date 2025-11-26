import { Context, SQSEvent } from "aws-lambda";


export const handler = async (event: SQSEvent, _: Context) => {
    event.Records
    console.log('Event received:', JSON.stringify(event, null, 2));
    return {
        statusCode: 200,
        body: JSON.stringify('Hello from Lambda!'),
    };
};