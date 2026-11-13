from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from slowapi.util import get_remote_address

from app.core.limiter import limiter
from app.services.database import users_collection
from app.core.security import get_password_hash, verify_password, create_access_token

router = APIRouter(prefix="/auth", tags=["Authentication"])


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)  # bcrypt ignores bytes past 72
    full_name: str


@router.post("/register")
@limiter.limit("5/minute", key_func=get_remote_address)
def register(request: Request, user: UserRegister):
    email = user.email.strip().lower()
    if users_collection.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_password = get_password_hash(user.password)
    users_collection.insert_one({
        "email": email, 
        "password": hashed_password, 
        "full_name": user.full_name
    })
    return {"message": "User registered successfully"}


@router.post("/login")
@limiter.limit("10/minute", key_func=get_remote_address)
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()):
    typed = form_data.username.strip()
    # lower-cased match first; exact match keeps accounts created before this fix working
    db_user = users_collection.find_one({"email": {"$in": [typed.lower(), typed]}})
    
    if not db_user or not verify_password(form_data.password, db_user["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token = create_access_token(data={"sub": str(db_user["email"])})
    return {"access_token": access_token, "token_type": "bearer"}