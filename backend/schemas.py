# schemas.py
from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel

class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str

class ActionResponse(BaseModel):
    action: str
    element_id: Optional[int] = None
    text: Optional[str] = None
    reasoning: Optional[str] = None
    url: Optional[str] = None
    # NEW: Флаг для Security Layer (требует ли действие одобрения человека)
    needs_confirmation: bool = False

class AnalyzeRequest(BaseModel):
    task: str
    dom: str
    screenshot: Optional[str] = None
    action_history: List[Dict[str, Any]] = []
    chat_history: List[ChatMessage] = []