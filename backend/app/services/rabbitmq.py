import json
import aio_pika
from app.core.config import settings

class RabbitMQManager:
    def __init__(self):
        self.connection: aio_pika.RobustConnection | None = None
        self.channel: aio_pika.RobustChannel | None = None

    async def connect(self):
        try:
            self.connection = await aio_pika.connect_robust(settings.RABBITMQ_URL)
            self.channel = await self.connection.channel()
            # Declare the queue so it exists if not created yet
            await self.channel.declare_queue(settings.REPORT_QUEUE_NAME, durable=True)
            print(f"[RabbitMQ] Connected successfully to {settings.RABBITMQ_URL}")
        except Exception as e:
            print(f"[RabbitMQ Connection Error]: {e}")
            self.connection = None
            self.channel = None

    async def close(self):
        if self.connection and not self.connection.is_closed:
            await self.connection.close()
            print("[RabbitMQ] Connection closed.")

    async def publish_task(self, queue_name: str, payload: dict) -> bool:
        if not self.channel or self.channel.is_closed:
            await self.connect()

        if not self.channel:
            print(f"[RabbitMQ Warning] Failed to publish message. RabbitMQ channel unavailable.")
            return False

        try:
            message_body = json.dumps(payload).encode("utf-8")
            message = aio_pika.Message(
                body=message_body,
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT
            )
            await self.channel.default_exchange.publish(
                message,
                routing_key=queue_name
            )
            print(f"📬 [RabbitMQ] Published task to queue: '{queue_name}' for interview: {payload.get('interview_id')}")
            return True
        except Exception as e:
            print(f"[RabbitMQ Publish Error]: {e}")
            return False


rabbitmq_client = RabbitMQManager()