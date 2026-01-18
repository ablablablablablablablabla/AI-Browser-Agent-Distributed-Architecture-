from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from schemas import AnalyzeRequest, ActionResponse
from ai_service import get_ai_action

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/analyze", response_model=ActionResponse)
async def analyze_endpoint(request: AnalyzeRequest):
    ai_result = await get_ai_action(
        task=request.task,
        dom_snippet=request.dom,
        history=request.action_history,
        chat_history=request.chat_history,
        screenshot=request.screenshot
    )
    return ActionResponse(**ai_result)



if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)