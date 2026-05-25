from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Dict
import hashlib

router = APIRouter()

# In-memory user store (for demo only)
users: Dict[str, str] = {}

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

class AuthRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    email: str
    token: str

@router.post("/register", response_model=AuthResponse)
def register(auth: AuthRequest):
    if auth.email in users:
        raise HTTPException(status_code=400, detail="Email already registered.")
    users[auth.email] = hash_password(auth.password)
    return {"email": auth.email, "token": f"demo-token-{auth.email}"}

@router.post("/login", response_model=AuthResponse)
def login(auth: AuthRequest):
    if auth.email not in users or users[auth.email] != hash_password(auth.password):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    return {"email": auth.email, "token": f"demo-token-{auth.email}"}
