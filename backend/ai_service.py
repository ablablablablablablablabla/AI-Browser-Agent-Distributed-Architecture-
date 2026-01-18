import os
import json
import urllib.parse
import asyncio
from openai import AsyncOpenAI
from dotenv import load_dotenv

from prompts import (
    GMAIL_AGENT,
    HH_AGENT,
    SHOPPING_AGENT,
    GENERAL_AGENT,
    DYNAMIC_BATCH_LOGIC
)

load_dotenv()

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))


tools = [
    {
        "type": "function",
        "function": {
            "name": "perform_browser_action",
            "description": "Execute a safe browser action or request security confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "thought_process": {"type": "string", "description": "Reasoning behind the action."},
                    "action": {
                        "type": "string",
                        "enum": ["click", "type", "scroll", "open_url", "finish", "save_memory", "press_enter",
                                 "ask_user_confirmation"]
                    },
                    "scroll_direction": {"type": "string", "enum": ["up", "down", "top", "bottom"]},
                    "element_id": {"type": "integer",
                                   "description": "The ID of the interactive element to interact with."},
                    "text": {"type": "string", "description": "Text to type, or scroll direction ('up'/'down')."},
                    "url": {"type": "string"}
                },
                "required": ["thought_process", "action"],
                "additionalProperties": False
            }
        }
    }
]


def format_dom_for_llm(dom_snippet: str) -> str:

    try:
        elements = json.loads(dom_snippet)
        lines = []

        MAX_ITEMS = 300

        for i, el in enumerate(elements):
            if i >= MAX_ITEMS:
                lines.append(f"... and {len(elements) - i} more items (SCROLL to see them)")
                break

            attrs_parts = []


            if el['attributes'].get('role'): attrs_parts.append(f"role='{el['attributes']['role']}'")
            if el['attributes'].get('placeholder'): attrs_parts.append(f"ph='{el['attributes']['placeholder']}'")
            if el['attributes'].get('ariaLabel'): attrs_parts.append(f"label='{el['attributes']['ariaLabel']}'")
            if el['attributes'].get('name'): attrs_parts.append(f"name='{el['attributes']['name']}'")


            href = el['attributes'].get('href')
            if href and len(href) > 2:
                short_href = href if len(href) < 30 else f"...{href[-25:]}"
                attrs_parts.append(f"href='{short_href}'")

            attrs_str = f"({', '.join(attrs_parts)})" if attrs_parts else ""


            tag = el.get('tag', 'UNK').upper()
            text = el.get('text', '').replace('\n', ' ').strip()

            if len(text) > 60: text = text[:60] + "..."

            line = f"[{el['id']}] {tag} \"{text}\" {attrs_str}"
            lines.append(line)

        return "\n".join(lines)

    except Exception as e:
        print(f"Error formatting DOM: {e}")
        return "Error parsing DOM data."


async def select_agent(task: str) -> str:

    router_prompt = f"""
    CLASSIFY TASK: "{task}"
    CATEGORIES: RECRUITER (jobs, resume, vacancy), GMAIL (email, outlook, spam), SHOPPER (buy, price, cart, amazon), GENERALIST (other).
    OUTPUT: Just the category name.
    """
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": router_prompt}],
            temperature=0.0
        )
        category = response.choices[0].message.content.strip().upper()

        if "RECRUITER" in category: return HH_AGENT
        if "GMAIL" in category: return GMAIL_AGENT
        if "SHOPPER" in category: return SHOPPING_AGENT
        return GENERAL_AGENT
    except:
        return GENERAL_AGENT


async def get_ai_action(task: str, dom_snippet: str, history: list, chat_history: list = [],
                        screenshot: str = None) -> dict:

    formatted_dom = format_dom_for_llm(dom_snippet)

    memories = [m.content.replace('MEMORY_SAVE:', '').strip() for m in chat_history if
                m.role == 'assistant' and "MEMORY_SAVE:" in m.content]
    memory_context = "\n".join(memories[-5:]) if memories else "Memory empty."


    selected_system_prompt = await select_agent(task)


    final_system_prompt = f"""
    {selected_system_prompt}

    === GLOBAL CONTEXT ===
    Global Memory (Saved Items): {memory_context}
    Current Goal: "{task}"
    """

    messages = [{"role": "system", "content": final_system_prompt}]


    history_text = "\n".join(
        [
            f"Step {i + 1}: {h.get('action')} on ID {h.get('element_id')} ('{h.get('text')}') - Reason: {h.get('reasoning')}"
            for i, h in enumerate(history[-5:])]
    )


    user_msg_content = f"""
    PREVIOUS ACTIONS (Last 5 steps):
    {history_text}

    CURRENT VISIBLE INTERACTIVE ELEMENTS (DOM):
    {formatted_dom}

    INSTRUCTIONS:
    - Analyse the DOM list. 
    - Select the ID that best matches the next logical step for the task: "{task}".
    - If you need to confirm a dangerous action, use 'ask_user_confirmation'.
    """

    content_payload = [{"type": "text", "text": user_msg_content}]


    if screenshot:
        content_payload.append({
            "type": "image_url",
            "image_url": {"url": screenshot, "detail": "low"}  #
        })

    messages.append({"role": "user", "content": content_payload})

    max_retries = 2
    for attempt in range(max_retries):
        try:

            response = await client.chat.completions.create(
                model="gpt-5-chat-latest",
                messages=messages,
                tools=tools,
                tool_choice="required",

            )

            message = response.choices[0].message
            if not message.tool_calls:
                return {"action": "finish", "reasoning": "AI did not call any tool. Finished."}

            tool_call = message.tool_calls[0]
            args = json.loads(tool_call.function.arguments)

            action_type = args.get("action")
            element_id = args.get("element_id")
            text_param = args.get("text")


            if action_type == "ask_user_confirmation":
                return {
                    "action": "wait",
                    "reasoning": args.get("thought_process", "Security Check Required"),
                    "needs_confirmation": True
                }


            final_text = text_param
            if action_type == "scroll":

                final_text = text_param if text_param in ["up", "down", "top", "bottom"] else "down"


            raw_url = args.get("url")
            final_url = raw_url
            if raw_url and not raw_url.startswith("http"):
                if "." in raw_url and " " not in raw_url:
                    final_url = f"https://{raw_url}"
                else:
                    final_url = f"https://www.google.com/search?q={urllib.parse.quote(raw_url)}"

            return {
                "action": action_type,
                "element_id": element_id,
                "text": final_text,
                "url": final_url,
                "reasoning": args.get("thought_process"),
                "needs_confirmation": False
            }

        except Exception as e:
            print(f"AI Error (attempt {attempt}): {e}")
            await asyncio.sleep(1)

    return {"action": "finish", "reasoning": "AI Service Error or Rate Limit."}
