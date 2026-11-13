import os
from pymongo import MongoClient, ASCENDING
from app.core.config import settings

# Retrieve MongoDB URI from settings or environment
mongo_uri = getattr(settings, "MONGO_URI", None) or getattr(settings, "MONGODB_URL", None) or os.getenv("MONGO_URI") or "mongodb://localhost:27017"
db_name = getattr(settings, "DATABASE_NAME", "glitchx_db")

client = MongoClient(mongo_uri)
db = client[db_name]

# Collections
users_collection = db["users"]
resumes_collection = db["resumes"]
interviews_collection = db["interviews"]
past_interviews_collection = db["past_interviews"]

def init_db_indexes():
    """Ensure database indexes exist for performance and unique constraints."""
    try:
        users_collection.create_index([("email", ASCENDING)], unique=True)
        resumes_collection.create_index([("user_id", ASCENDING)], unique=True)
        interviews_collection.create_index([("interview_id", ASCENDING)], unique=True)
        past_interviews_collection.create_index([("interview_id", ASCENDING)], unique=True)
        past_interviews_collection.create_index([("user_id", ASCENDING)])
    except Exception as e:
        print(f"⚠️ Index initialization warning: {e}")

init_db_indexes()